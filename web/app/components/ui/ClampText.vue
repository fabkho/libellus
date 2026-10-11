<script setup lang="ts">
// A member's own words (a review, a reason) cut to two lines, with a quiet "more" under them when,
// and only when, the text is actually cut (measured: scrollHeight past clientHeight). "more" opens it
// in place and "less" folds it again. The height glides from the clamped height to the full one over
// `standard` (docs/MOTION.md), at once with Reduce Motion. Attributes (classes for the type, margins)
// land on the root; `testid` names the text, the button is `<testid>.more`. A click on the button
// stops there, so a row that opens something does not open it too.
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { heightKeyframes, isCut } from '~/utils/clampText'
import { durationToken, easingToken, prefersReducedMotion } from '~/utils/motion'

const props = withDefaults(defineProps<{ text: string; testid?: string }>(), { testid: 'clamp' })

const { t } = useI18n()
const root = ref<HTMLElement | null>(null)
const body = ref<HTMLElement | null>(null)
const expanded = ref(false)
const truncated = ref(false)
const id = `clamp-${Math.random().toString(36).slice(2, 9)}`
let animation: Animation | null = null

/** Only while folded can the cut be seen: an open text has no clamp to measure against. */
function measure() {
  const el = body.value
  if (!el || expanded.value) return
  truncated.value = isCut(el.scrollHeight, el.clientHeight)
}

async function toggle() {
  const el = body.value
  if (!el) return
  const from = el.getBoundingClientRect().height
  expanded.value = !expanded.value
  await nextTick()
  animation?.cancel()
  animation = null
  const to = el.getBoundingClientRect().height
  const keyframes = heightKeyframes(from, to, prefersReducedMotion())
  if (!keyframes || typeof el.animate !== 'function') return
  animation = el.animate(keyframes, {
    duration: durationToken('standard'),
    easing: easingToken('standard'),
  })
  el.style.overflow = 'hidden'
  animation.onfinish = animation.oncancel = () => {
    el.style.overflow = ''
    animation = null
  }
}

let observer: ResizeObserver | null = null

onMounted(() => {
  measure()
  if (root.value && typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(measure)
    observer.observe(root.value)
  }
  void document.fonts?.ready.then(measure)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  animation?.cancel()
})

watch(
  () => props.text,
  () => nextTick(measure),
)
</script>

<template>
  <div ref="root">
    <p
      ref="body"
      :class="{ 'clamp-folded': !expanded }"
      :id="id"
      :data-testid="testid"
    >{{ text }}</p>
    <button
      v-if="truncated || expanded"
      type="button"
      class="more mt-xs block text-left not-italic font-sans text-subhead text-ink-muted focus-visible:outline-(length:--stroke-focus) focus-visible:outline-accent-ink focus-visible:rounded-sm"
      :aria-expanded="expanded"
      :aria-controls="id"
      :data-testid="`${testid}.more`"
      @click.stop="toggle"
    >
      {{ expanded ? t('review.less') : t('review.more') }}
    </button>
  </div>
</template>

<style scoped>
/* Two lines, then the rest is cut: the same clamp the history always had. */
.clamp-folded {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

/* A 44 px target around a small word, as every text button (the box does not grow). */
.more {
  position: relative;
  padding-block: var(--spacing-ms);
  margin-block: calc(var(--spacing-xs) - var(--spacing-ms));
}
</style>
