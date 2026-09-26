import { computed, unref, type Ref } from 'vue';
import { useStepStore } from '../stores/stepStore';
import { findSeqGaps } from '../utils/id';
import { currentStep, sortBySeq } from '../utils/repair';
import type { RepairStep } from '../types/step';

export interface RepairProgress {
  steps: RepairStep[];
  total: number;
  done: number;
  rolledback: number;
  /** 全部步骤累计重做次数 */
  redoTotal: number;
  percent: number;
  /** 当前卡点步骤（第一个未完成步骤） */
  current: RepairStep | undefined;
  /** 顺序号缺口 */
  gaps: number[];
}

/**
 * 统计某台钟表的工序完成比例与当前卡点步骤。
 * 被钟表详情页与工序录入页消费。
 */
export function useRepairProgress(clockId: string | Ref<string>) {
  const stepStore = useStepStore();
  const id = computed(() => unref(clockId));

  const steps = computed<RepairStep[]>(() =>
    sortBySeq(stepStore.items.filter((it) => it.clockId === id.value)),
  );
  const total = computed(() => steps.value.length);
  const done = computed(() => steps.value.filter((it) => it.state === 'done').length);
  const rolledback = computed(() => steps.value.filter((it) => it.state === 'rolledback').length);
  const redoTotal = computed(() => steps.value.reduce((sum, it) => sum + (it.redoCount || 0), 0));
  const percent = computed(() => (total.value === 0 ? 0 : Math.round((done.value / total.value) * 100)));
  const current = computed(() => currentStep(steps.value));
  const gaps = computed(() => findSeqGaps(steps.value.map((it) => it.seq)));

  const progress = computed<RepairProgress>(() => ({
    steps: steps.value,
    total: total.value,
    done: done.value,
    rolledback: rolledback.value,
    redoTotal: redoTotal.value,
    percent: percent.value,
    current: current.value,
    gaps: gaps.value,
  }));

  return { progress, steps, total, done, rolledback, redoTotal, percent, current, gaps };
}
