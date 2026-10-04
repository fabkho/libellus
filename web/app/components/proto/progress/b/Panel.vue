<script setup lang="ts">
// Direction B on the book page: the progress block as it is (bar, "p. 212
// of 608 · 35 %", Update progress, which opens the wheel sheet), and under it
// the memory line the sheet starts from: when you last read and how much,
// with the same one-tap "+24".
import { dayWords, haptic, lastSessionOf, maxOf, n, percentOf, positionOf, setPosition, usesPages, valueWords, fractionOf, type ProtoRead } from '../model'

const props = defineProps<{ read: ProtoRead }>()
const emit = defineEmits<{ update: [] }>()

const last = computed(() => lastSessionOf(props.read))
const again = computed(() => (last.value ? last.value.to - last.value.from : 0))
const unit = computed(() => (usesPages(props.read) ? ' pages' : ' %'))
function repeat() {
  const to = Math.min(positionOf(props.read) + again.value, maxOf(props.read))
  setPosition(props.read, to)
  haptic('step', { fromClick: true })
}
</script>

<template>
  <div class="mb-ml flex flex-col gap-sm" data-testid="b.panel">
    <UiProgress :fraction="fractionOf(read)" label="Reading progress" :value-text="valueWords(read)" />
    <div class="flex items-center justify-between gap-ms">
      <p class="figures flex items-center gap-sm text-caption text-ink">
        <span>{{ valueWords(read) }}</span>
        <template v-if="usesPages(read)">
          <span class="dot text-ink-ghost" aria-hidden="true" />
          <span class="text-ink-faint">{{ percentOf(read) }} %</span>
        </template>
      </p>
      <UiButton tone="quiet" size="sm" data-testid="b.update" @click="emit('update')">Update progress</UiButton>
    </div>
    <div v-if="last" class="flex items-center justify-between gap-ms border-t-(length:--stroke-hairline) border-hairline pt-xs">
      <p class="figures min-w-0 truncate text-meta text-ink-faint">
        <span class="eyebrow mr-xs">Last time</span>{{ dayWords(last.day) }} · +{{ n(again) }}{{ unit }}
      </p>
      <UiButton tone="plain" size="sm" class="-mr-sm" data-testid="b.panelAgain" @click="repeat">
        <UiIcon name="repeat" :size="14" />+{{ n(again) }}{{ usesPages(read) ? '' : ' %' }}
      </UiButton>
    </div>
  </div>
</template>

<style scoped>
.dot {
  width: var(--spacing-xxs);
  height: var(--spacing-xxs);
  border-radius: var(--radius-pill);
  background: currentColor;
}
</style>
