import type { RepairState } from '../types/clock';
import type { RepairStep } from '../types/step';

/** 按顺序号排序（顺序号相同再按开工时间），保持视图口径一致 */
export function sortBySeq<T>(items: T[]): T[] {
  return [...items].sort(
    (a, b) =>
      ((a as { seq?: number }).seq ?? 0) - ((b as { seq?: number }).seq ?? 0) ||
      ((a as { startedAt?: number }).startedAt ?? 0) - ((b as { startedAt?: number }).startedAt ?? 0),
  );
}

/**
 * 当前待办：排序后第一个未完成的步骤。
 * 工序按顺序推进，只有它允许被标记完成。
 */
export function currentStep(steps: RepairStep[]): RepairStep | undefined {
  return sortBySeq(steps).find((it) => it.state !== 'done');
}

/** 该步骤是否为当前唯一允许完成的待办 */
export function canFinish(steps: RepairStep[], id: string): boolean {
  return currentStep(steps)?.id === id;
}

/** 回退目标是否合法：仅已完成步骤可回退 */
export function canRollback(step: RepairStep | undefined): boolean {
  return !!step && step.state === 'done';
}

/**
 * 级联回退：把目标步骤及其后所有「已完成」步骤一并置为待重做，
 * 每步 redoCount + 1，清空 finishedAt；已是待办/待重做的后续步骤原样保留。
 * 返回新数组（不修改入参），调用方负责持久化。
 */
export function cascadeRollback(steps: RepairStep[], id: string): RepairStep[] {
  const ordered = sortBySeq(steps);
  const target = ordered.find((it) => it.id === id && it.state === 'done');
  if (!target) return ordered;
  return ordered.map((it) =>
    it.seq >= target.seq && it.state === 'done'
      ? { ...it, state: 'rolledback' as const, finishedAt: undefined, redoCount: it.redoCount + 1 }
      : it,
  );
}

/** 同一块工序内交换顺序：只能在状态相同的相邻区间（已完成区 / 待完成区）内进行，避免破坏依赖顺序 */
export function canSwapSeq(steps: RepairStep[], aId: string, bId: string): boolean {
  const ordered = sortBySeq(steps);
  const a = ordered.find((it) => it.id === aId);
  const b = ordered.find((it) => it.id === bId);
  if (!a || !b || Math.abs(a.seq - b.seq) !== 1) return false;
  // 已完成 ⇄ 待完成 的交换会让先完成的工序排到待办之后，禁止
  return (a.state === 'done') === (b.state === 'done');
}

/**
 * 把（可能来自旧版本的）步骤数据归一化到新不变式：
 * 1. 缺 state / redoCount 补默认；
 * 2. 一旦前面出现未完成步骤，其后面的 done 记录一律回到待重做并各计一次重做
 *    （旧版本允许单独回退一步，这是唯一会产生不一致的路径）；
 * 3. 非 done 记录残留的 finishedAt 清空。
 * 用于 v2 → v3 数据库升级，保证旧数据升级后继续可用、台账不再误判。
 */
export function normalizeSteps(input: Array<Partial<RepairStep>>): RepairStep[] {
  const ordered = sortBySeq(input.filter((it) => !!it.id) as Array<Partial<RepairStep> & { id: string }>);
  let blocked = false;
  return ordered.map((row) => {
    const state = row.state === 'done' || row.state === 'rolledback' || row.state === 'pending' ? row.state : 'pending';
    const base: RepairStep = {
      id: row.id!,
      clockId: row.clockId ?? '',
      stepType: row.stepType ?? '拆解',
      seq: row.seq ?? 1,
      partIds: row.partIds ?? [],
      cleanSolvent: row.cleanSolvent ?? '',
      cleanMethod: row.cleanMethod ?? '',
      oilType: row.oilType ?? '',
      oilPoints: row.oilPoints ?? '',
      torque: row.torque ?? 0,
      troubleNote: row.troubleNote ?? '',
      operator: row.operator ?? '',
      startedAt: row.startedAt ?? Date.now(),
      finishedAt: row.finishedAt,
      state,
      redoCount: typeof row.redoCount === 'number' ? row.redoCount : 0,
    };
    if (state !== 'done') {
      blocked = true;
      if (base.finishedAt !== undefined) base.finishedAt = undefined;
      return base;
    }
    if (blocked) {
      // 前面已有未完成步骤，旧数据里它却仍显示已完成 → 级联回退，补记一次重做
      return { ...base, state: 'rolledback', finishedAt: undefined, redoCount: base.redoCount + 1 };
    }
    return base;
  });
}

/**
 * 由工序与走时测试推导台账修复状态。
 * 级联回退后 done 数必然小于总数 → 回到「维修中」；
 * 全部重做完成后 → 依是否已有走时测试恢复「已完成 / 待测试」。
 */
export function repairStateOf(steps: RepairStep[], testCount: number): RepairState {
  if (steps.length === 0) return '未开工';
  const done = steps.filter((s) => s.state === 'done').length;
  if (done === steps.length) return testCount > 0 ? '已完成' : '待测试';
  if (done > 0 || steps.some((s) => s.redoCount > 0)) return '维修中';
  return '未开工';
}
