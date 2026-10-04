<script setup lang="ts">
// Direction C's logger, opened in place (in the card, on the book page): you
// say how much you read today, not where you are. "+30" with − / + (hold to
// run) and the usual amounts as chips; where that puts you is worked out
// beside it ("→ p. 242 · 40 %"). A correction is one tap away: "I'm on page…"
// turns the number into the page itself. An amount that reaches the end says
// so, and logging it opens the finish.
import { haptic, maxOf, n, paceOf, percentOf, positionOf, todayOf, useHoldRepeat, usesPages, type ProtoRead } from '../model'

const props = defineProps<{ read: ProtoRead }>()
const amount = defineModel<number>('amount', { required: true })
const emit = defineEmits<{ log: [to: number]; cancel: [] }>()

const pages = computed(() => usesPages(props.read))
const at = computed(() => positionOf(props.read))
const left = computed(() => maxOf(props.read) - at.value)
const absolute = ref(false)
const to = computed(() => Math.min(at.value + amount.value, maxOf(props.read)))
const reachesEnd = computed(() => to.value >= maxOf(props.read))
const already = computed(() => todayOf(props.read))

const chips = computed(() => {
  if (!pages.value) return [5, 10, 15, 25]
  // Round amounts around your pace, the way people count what they read.
  const pace = paceOf(props.read) ?? 20
  if (pace < 15) return [5, 10, 15, 25]
  if (pace < 40) return [10, 20, 30, 50]
  return [25, 50, 75, 100]
})

function set(value: number) {
  const next = Math.min(Math.max(value, absolute.value ? -at.value : 0), left.value)
  if (next === amount.value) return haptic('edge', { fromClick: true })
  amount.value = next
  haptic(next === left.value ? 'edge' : 'tick', { fromClick: true })
}
const minus = useHoldRepeat((times) => set(amount.value - times))
const plus = useHoldRepeat((times) => set(amount.value + times))

const big = computed(() => (absolute.value ? (pages.value ? `p. ${n(to.value)}` : `${to.value} %`) : `+${n(amount.value)}${pages.value ? '' : ' %'}`))
</script>

<template>
  <div class="flex flex-col gap-sm" data-testid="c.log">
    <div class="flex items-baseline justify-between gap-ms">
      <span class="eyebrow">{{ absolute ? "I'm on" : already ? 'More today' : 'Read today' }}</span>
      <span class="figures text-meta" :class="reachesEnd ? 'text-accent' : 'text-ink-faint'" data-testid="c.logTo">
        <template v-if="reachesEnd">→ the end</template>
        <template v-else-if="absolute">{{ amount >= 0 ? '+' : '−' }}{{ n(Math.abs(amount)) }}{{ pages ? ' pages' : ' %' }} today</template>
        <template v-else>→ {{ pages ? `p. ${n(to)} · ${percentOf(read, to)} %` : `${to} %` }}</template>
      </span>
    </div>

    <div class="flex items-center justify-between gap-sm">
      <button
        type="button"
        class="step edge"
        aria-label="Less"
        data-testid="c.minus"
        @pointerdown="minus.start"
        @pointerup="minus.stop"
        @pointerleave="minus.stop"
        @pointercancel="minus.stop"
      >
        <span class="minus" aria-hidden="true" />
      </button>
      <span class="figures text-figure" :class="amount ? 'text-ink' : 'text-ink-ghost'" data-testid="c.amount">{{ big }}</span>
      <button
        type="button"
        class="step edge"
        aria-label="More"
        data-testid="c.plus"
        @pointerdown="plus.start"
        @pointerup="plus.stop"
        @pointerleave="plus.stop"
        @pointercancel="plus.stop"
      >
        <UiIcon name="plus" :size="18" />
      </button>
    </div>

    <div v-if="!absolute" class="flex justify-between gap-xs">
      <UiButton
        v-for="c in chips"
        :key="c"
        tone="quiet"
        size="sm"
        class="flex-1"
        :class="amount === c && 'chosen'"
        :data-testid="`c.chip${c}`"
        @click="set(c)"
      >
        {{ c }}{{ pages ? '' : ' %' }}
      </UiButton>
    </div>

    <div class="flex items-center justify-between gap-sm">
      <UiButton tone="plain" size="sm" class="-ml-sm" data-testid="c.absolute" @click="absolute = !absolute">
        {{ absolute ? 'Count what I read' : pages ? "I'm on page…" : "I'm at…" }}
      </UiButton>
      <span class="flex gap-xs">
        <UiButton tone="plain" size="sm" data-testid="c.cancel" @click="emit('cancel')">Cancel</UiButton>
        <UiButton size="sm" :disabled="!amount" data-testid="c.save" @click="emit('log', to)">
          <UiIcon name="check" :size="14" bold />{{ reachesEnd ? 'Log the end' : 'Log' }}
        </UiButton>
      </span>
    </div>
  </div>
</template>

<style scoped>
.step {
  display: flex;
  width: var(--size-touch);
  height: var(--size-touch);
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-pill);
  color: var(--color-ink);
  touch-action: manipulation;
  user-select: none;
  -webkit-user-select: none;
}
.step:active {
  background: var(--color-fill-strong);
}
.minus {
  width: var(--spacing-ms);
  height: var(--stroke-icon);
  border-radius: var(--radius-pill);
  background: currentColor;
}
.chosen {
  box-shadow: inset 0 0 0 var(--stroke-rule) var(--color-accent);
  color: var(--color-accent);
}
</style>
