<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElMessage } from 'element-plus';
import type { RepairStep } from '../../types/step';
import { findSeqGaps } from '../../utils/id';
import { canSwapSeq, currentStep } from '../../utils/repair';
import StateBadge from './StateBadge.vue';

const props = defineProps<{
  items: RepairStep[];
  /** 是否展示上下移动/拖拽排序 */
  sortable?: boolean;
}>();

const emit = defineEmits<{
  (e: 'finish', id: string): void;
  (e: 'rollback', id: string): void;
  (e: 'move', payload: { id: string; direction: 'up' | 'down' }): void;
  (e: 'reorder', payload: { fromId: string; toId: string }): void;
}>();

const dragId = ref<string>('');

const gaps = computed(() => findSeqGaps(props.items.map((it) => it.seq)));
const conflict = computed(() => gaps.value.length > 0);
/** 当前唯一允许完成的待办 */
const currentId = computed(() => currentStep(props.items)?.id ?? '');

function canMove(id: string, direction: 'up' | 'down'): boolean {
  const index = props.items.findIndex((it) => it.id === id);
  const target = direction === 'up' ? props.items[index - 1] : props.items[index + 1];
  return !!target && canSwapSeq(props.items, id, target.id);
}

function onDragStart(id: string) {
  dragId.value = id;
}
function onDrop(toId: string) {
  if (dragId.value && dragId.value !== toId) {
    if (!canSwapSeq(props.items, dragId.value, toId)) {
      ElMessage.warning('不能跨越「已完成 / 待办」边界调整顺序，以免破坏工序依赖');
    } else {
      emit('reorder', { fromId: dragId.value, toId });
    }
  }
  dragId.value = '';
}
</script>

<template>
  <div class="seq-wrap" data-testid="step-sequence">
    <el-alert
      v-if="conflict"
      type="error"
      :closable="false"
      show-icon
      :title="`顺序号存在缺口：${gaps.join('、')}（不得跳号，请用上下移动补齐）`"
      style="margin-bottom: 10px"
    />
    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="工序按顺序推进：只有当前待办能标记完成；回退任意已完成步骤时，该步及其后的完成记录会一并回到待重做。"
      style="margin-bottom: 10px"
    />
    <el-table :data="items" size="small" border>
      <el-table-column label="顺序" width="80">
        <template #default="{ row }">
          <span :class="{ gap: conflict && gaps.includes(row.seq) }">#{{ row.seq }}</span>
        </template>
      </el-table-column>
      <el-table-column label="步骤" width="110">
        <template #default="{ row }">{{ row.stepType }}</template>
      </el-table-column>
      <el-table-column label="状态" width="110">
        <template #default="{ row }">
          <div class="state-cell">
            <StateBadge :state="row.state" />
            <el-tag v-if="row.redoCount > 0" size="small" type="danger" effect="plain">
              重做 ×{{ row.redoCount }}
            </el-tag>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="清洗/润滑" min-width="200">
        <template #default="{ row }">
          <div v-if="row.cleanSolvent">清洗液：{{ row.cleanSolvent }}（{{ row.cleanMethod }}）</div>
          <div v-if="row.oilType">油脂：{{ row.oilType }} · 点位 {{ row.oilPoints }}</div>
          <div v-if="row.torque">力矩：{{ row.torque }} N·m</div>
          <div v-if="!row.cleanSolvent && !row.oilType && !row.torque">—</div>
        </template>
      </el-table-column>
      <el-table-column label="异常说明" min-width="160">
        <template #default="{ row }">{{ row.troubleNote || '—' }}</template>
      </el-table-column>
      <el-table-column label="责任人" width="100">
        <template #default="{ row }">{{ row.operator }}</template>
      </el-table-column>
      <el-table-column label="操作" width="260">
        <template #default="{ row, $index }">
          <el-tooltip
            v-if="row.state !== 'done'"
            :disabled="row.id === currentId"
            content="前序步骤全部完成后才能做这一步"
            placement="top"
          >
            <span>
              <el-button
                size="small"
                type="primary"
                :disabled="row.id !== currentId"
                @click="emit('finish', row.id)"
              >
                {{ row.state === 'rolledback' ? '重做完成' : '完成' }}
              </el-button>
            </span>
          </el-tooltip>
          <el-button v-else size="small" type="warning" @click="emit('rollback', row.id)">回退</el-button>
          <template v-if="sortable">
            <el-button
              size="small"
              :disabled="$index === 0 || !canMove(row.id, 'up')"
              @click="emit('move', { id: row.id, direction: 'up' })"
            >
              上移
            </el-button>
            <el-button
              size="small"
              :disabled="$index === items.length - 1 || !canMove(row.id, 'down')"
              @click="emit('move', { id: row.id, direction: 'down' })"
            >
              下移
            </el-button>
          </template>
          <span
            class="drag-handle"
            draggable="true"
            title="拖拽到目标行可交换顺序"
            @dragstart="onDragStart(row.id)"
            @dragover.prevent
            @drop="onDrop(row.id)"
            >⣿</span
          >
        </template>
      </el-table-column>
    </el-table>
    <el-empty v-if="items.length === 0" description="暂无工序，请到「新建维修工序」登记" />
  </div>
</template>

<style scoped>
.gap {
  color: #d93025;
  font-weight: 700;
}
.state-cell {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}
.drag-handle {
  margin-left: 8px;
  cursor: grab;
  color: #97a0ad;
  user-select: none;
}
</style>
