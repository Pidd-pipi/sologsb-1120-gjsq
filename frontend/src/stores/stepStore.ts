import { defineStore } from 'pinia';
import { db, toPlain } from '../utils/db';
import { newId } from '../utils/id';
import { cascadeRollbackIds, currentTodo } from '../utils/stepFlow';
import type { RepairStep, RepairStepDraft } from '../types/step';
import type { TimekeepingTest, TimekeepingTestDraft } from '../types/test';

interface StepState {
  items: RepairStep[];
  tests: TimekeepingTest[];
  loaded: boolean;
}

export const useStepStore = defineStore('step', {
  state: (): StepState => ({ items: [], tests: [], loaded: false }),
  getters: {
    byClock: (state) => (clockId: string) =>
      state.items.filter((it) => it.clockId === clockId).sort((a, b) => a.seq - b.seq),
    testsByClock: (state) => (clockId: string) =>
      state.tests.filter((it) => it.clockId === clockId).sort((a, b) => b.testedAt - a.testedAt),
  },
  actions: {
    async load() {
      const steps = await db.steps.toArray();
      steps.sort((a, b) => a.seq - b.seq || a.startedAt - b.startedAt);
      this.items = steps;
      const tests = await db.tests.toArray();
      this.tests = tests.sort((a, b) => b.testedAt - a.testedAt);
      this.loaded = true;
    },
    async add(draft: RepairStepDraft) {
      const record: RepairStep = { ...toPlain(draft), id: newId('stp') };
      await db.steps.put(toPlain(record));
      this.items = [...this.items, record];
      return record;
    },
    /**
     * 完成步骤：只允许完成「当前待办」（按顺序第一个未完成步骤），
     * 防止跳步完成导致进度失真。重新完成被回退的步骤时保留 redoCount。
     */
    async finish(id: string) {
      const target = this.items.find((it) => it.id === id);
      if (!target) throw new Error('步骤不存在');
      if (target.state === 'done') return;
      const siblings = this.items.filter((it) => it.clockId === target.clockId);
      const todo = currentTodo(siblings);
      if (todo?.id !== id) {
        throw new Error(`需先完成当前待办 #${todo?.seq} ${todo?.stepType ?? ''}，工序须按顺序推进`);
      }
      const patch: Partial<RepairStep> = { state: 'done', finishedAt: Date.now() };
      await db.steps.update(id, patch);
      this.items = this.items.map((it) => (it.id === id ? { ...it, ...patch } : it));
    },
    /**
     * 级联回退：目标步骤与其后所有已完成记录一起回到待重做，
     * 每条受影响记录 redoCount +1；未完成的后续步骤不受影响。
     */
    async rollback(id: string) {
      const target = this.items.find((it) => it.id === id);
      if (!target) return 0;
      const siblings = this.items.filter((it) => it.clockId === target.clockId);
      const ids = cascadeRollbackIds(siblings, id);
      if (!ids || ids.length === 0) return 0;
      const idSet = new Set(ids);
      await db.transaction('rw', db.steps, async () => {
        await db.steps
          .where('id')
          .anyOf(ids)
          .modify((row) => {
            row.state = 'rolledback';
            row.finishedAt = undefined;
            row.redoCount = (row.redoCount ?? 0) + 1;
          });
      });
      this.items = this.items.map((it) =>
        idSet.has(it.id)
          ? { ...it, state: 'rolledback' as const, finishedAt: undefined, redoCount: (it.redoCount ?? 0) + 1 }
          : it,
      );
      return ids.length;
    },
    /** 上下移动排序：交换两个相邻步骤的 seq */
    async swapSeq(aId: string, bId: string) {
      const a = this.items.find((it) => it.id === aId);
      const b = this.items.find((it) => it.id === bId);
      if (!a || !b) return;
      const aSeq = a.seq;
      await db.steps.update(a.id, { seq: b.seq });
      await db.steps.update(b.id, { seq: aSeq });
      this.items = this.items.map((it) => {
        if (it.id === a.id) return { ...it, seq: b.seq };
        if (it.id === b.id) return { ...it, seq: aSeq };
        return it;
      });
    },
    async addTest(draft: TimekeepingTestDraft) {
      const record: TimekeepingTest = { ...toPlain(draft), id: newId('tst') };
      await db.tests.put(toPlain(record));
      this.tests = [record, ...this.tests];
      return record;
    },
    async removeTest(id: string) {
      await db.tests.delete(id);
      this.tests = this.tests.filter((it) => it.id !== id);
    },
  },
});
