import { defineStore } from 'pinia';
import { db, toPlain } from '../utils/db';
import { newId } from '../utils/id';
import { canFinish, canSwapSeq, cascadeRollback } from '../utils/repair';
import type { RepairStep, RepairStepDraft } from '../types/step';
import type { TimekeepingTest, TimekeepingTestDraft } from '../types/test';

interface StepState {
  items: RepairStep[];
  tests: TimekeepingTest[];
  loaded: boolean;
}

export class StepRuleError extends Error {}

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
      const record: RepairStep = { ...toPlain(draft), id: newId('stp'), redoCount: draft.redoCount ?? 0 };
      await db.steps.put(toPlain(record));
      this.items = [...this.items, record];
      return record;
    },
    /**
     * 完成步骤：工序按顺序推进，只允许完成当前待办（前序全部 done 的第一个未完成步骤）。
     * 重做完成同样走这里，redoCount 保留累计值。
     */
    async finish(id: string) {
      const target = this.items.find((it) => it.id === id);
      if (!target) throw new StepRuleError('步骤不存在');
      if (target.state === 'done') throw new StepRuleError('该步骤已完成，无需重复操作');
      const siblings = this.items.filter((it) => it.clockId === target.clockId);
      if (!canFinish(siblings, id)) {
        throw new StepRuleError('工序必须按顺序推进，请先完成前面的待办步骤');
      }
      const patch: Partial<RepairStep> = { state: 'done', finishedAt: Date.now() };
      await db.steps.update(id, toPlain(patch));
      this.items = this.items.map((it) => (it.id === id ? { ...it, ...patch } : it));
    },
    /**
     * 回退步骤：只能回退已完成步骤；目标步骤及其后所有已完成步骤一并回到待重做，
     * 每步重做次数 + 1，清空 finishedAt。整体在一个事务里完成。
     * 返回实际被回退的步骤数（含目标本身）。
     */
    async rollback(id: string): Promise<number> {
      const target = this.items.find((it) => it.id === id);
      if (!target) throw new StepRuleError('步骤不存在');
      if (target.state !== 'done') throw new StepRuleError('只能回退已完成的步骤');
      const siblings = this.items.filter((it) => it.clockId === target.clockId);
      const nextOrder = cascadeRollback(siblings, id);
      const affected = nextOrder.filter((n) => n.state === 'rolledback').filter((n) =>
        siblings.some((o) => o.id === n.id && o.state === 'done'),
      );
      await db.transaction('rw', db.steps, async () => {
        for (const step of affected) {
          await db.steps.update(step.id, {
            state: 'rolledback',
            finishedAt: undefined,
            redoCount: step.redoCount,
          });
        }
      });
      const affectedIds = new Set(affected.map((it) => it.id));
      this.items = this.items.map((it) => {
        const hit = affected.find((a) => a.id === it.id);
        return hit ? { ...it, state: 'rolledback' as const, finishedAt: undefined, redoCount: hit.redoCount } : it;
      });
      return affectedIds.size;
    },
    /** 上下移动排序：仅允许在同状态区间（已完成区/待完成区）内交换相邻步骤的 seq */
    async swapSeq(aId: string, bId: string) {
      const a = this.items.find((it) => it.id === aId);
      const b = this.items.find((it) => it.id === bId);
      if (!a || !b) return;
      if (!canSwapSeq(this.items.filter((it) => it.clockId === a.clockId), aId, bId)) {
        throw new StepRuleError('不能跨越「已完成 / 待办」边界调整顺序，以免破坏工序依赖');
      }
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
