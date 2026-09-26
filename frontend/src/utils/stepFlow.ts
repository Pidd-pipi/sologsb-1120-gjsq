import type { RepairStep } from '../types/step';

/**
 * 工序顺序推进规则（纯函数，便于脱离 IndexedDB 验证）：
 * - 步骤按 seq 升序推进，同一钟表同一时刻只有「当前待办」可完成；
 * - 回退任意已完成步骤时，该步与其后所有已完成记录一起回到待重做。
 */

/** 同一台钟表的工序按顺序号排序（顺序号相同按开始时间兜底） */
export function sortBySeq(steps: RepairStep[]): RepairStep[] {
  return [...steps].sort((a, b) => a.seq - b.seq || a.startedAt - b.startedAt);
}

/** 当前待办：按顺序第一个未完成的步骤，全部完成时返回 undefined */
export function currentTodo(steps: RepairStep[]): RepairStep | undefined {
  return sortBySeq(steps).find((it) => it.state !== 'done');
}

/**
 * 级联回退范围：目标步骤本身 + 顺序号在其后的所有「已完成」步骤。
 * 目标必须处于已完成状态；否则返回 null 表示不可回退。
 * 未完成的后续步骤不受影响（它们还没有完成记录）。
 */
export function cascadeRollbackIds(steps: RepairStep[], id: string): string[] | null {
  const ordered = sortBySeq(steps);
  const index = ordered.findIndex((it) => it.id === id);
  if (index < 0 || ordered[index].state !== 'done') return null;
  return ordered
    .slice(index)
    .filter((it) => it.state === 'done')
    .map((it) => it.id);
}
