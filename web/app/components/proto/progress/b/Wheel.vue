<script setup lang="ts">
// Direction B's number wheel: a drum of numbers the finger spins, the
// platform picker's gesture (native scrolling, so an Android fling has its
// momentum and it snaps row by row). The centre row is the value, large in
// figures between two hairlines; the rows above and below turn away and fade.
// A tick for every number that passes the centre. Only the rows near the
// centre exist, so a 1,204-page book costs the same as a 100 % one. A
// spinbutton for the keyboard (arrows, Page Up/Down by ten, Home/End); a tap
// on the centre types the number instead.
import { haptic, n } from '../model'

const props = withDefaults(defineProps<{ min?: number; max: number; suffix?: string; label: string }>(), { min: 0, suffix: '' })
const model = defineModel<number>({ required: true })

const scroller = useTemplateRef<HTMLElement>('scroller')
const ROWS = 5
const row = ref(44)
const pos = ref(model.value - props.min)
let emitted = model.value
let programmatic = false
let settle: ReturnType<typeof setTimeout> | undefined

onMounted(() => {
  row.value = Number.parseFloat(getComputedStyle(scroller.value!).getPropertyValue('--size-touch')) || 44
  scroller.value!.scrollTop = (model.value - props.min) * row.value
  pos.value = model.value - props.min
})

let frame = 0
function onScroll() {
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    const el = scroller.value
    if (!el) return
    pos.value = el.scrollTop / row.value
    const value = Math.min(Math.max(Math.round(pos.value) + props.min, props.min), props.max)
    if (value !== emitted) {
      emitted = value
      model.value = value
      if (!programmatic) haptic(value === props.min || value === props.max ? 'edge' : 'tick')
    }
    if (programmatic) {
      clearTimeout(settle)
      settle = setTimeout(() => (programmatic = false), 140)
    }
  })
}

/** A value set from outside (a chip, − / +, typing) rolls the drum there. */
watch(model, (value) => {
  if (value === emitted || !scroller.value) return
  emitted = value
  programmatic = true
  const distance = Math.abs(value - props.min - pos.value)
  scroller.value.scrollTo({ top: (value - props.min) * row.value, behavior: distance > 400 ? 'instant' : 'smooth' })
})
watch(
  () => [props.min, props.max],
  () => nextTick(() => scroller.value && (scroller.value.scrollTop = (model.value - props.min) * row.value)),
)

const visible = computed(() => {
  const from = Math.max(0, Math.floor(pos.value) - 3)
  const to = Math.min(props.max - props.min, Math.ceil(pos.value) + 3)
  return Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i)
})
function rowStyle(i: number) {
  const d = i - pos.value
  const a = Math.min(Math.abs(d), 2.6)
  return {
    top: `${i * row.value + 2 * row.value}px`,
    opacity: String(1 - a * 0.34),
    transform: `perspective(400px) rotateX(${-d * 22}deg) scale(${1 - a * 0.2})`,
  }
}

// ----------------------------------------------------------------- typing

const typing = ref(false)
const field = ref('')
const input = useTemplateRef<HTMLInputElement>('input')
function startTyping() {
  field.value = String(model.value)
  typing.value = true
  void nextTick(() => {
    input.value?.focus()
    input.value?.select()
  })
}
function stopTyping() {
  if (!typing.value) return
  typing.value = false
  const value = Number(field.value)
  if (/^\d+$/.test(field.value.trim())) model.value = Math.min(Math.max(value, props.min), props.max)
}
function onClick(event: MouseEvent) {
  // Only a tap on the centre row types; a tap above or below steps there.
  const rect = scroller.value!.getBoundingClientRect()
  const offset = Math.round((event.clientY - rect.top - rect.height / 2) / row.value)
  if (offset === 0) return startTyping()
  model.value = Math.min(Math.max(model.value + offset, props.min), props.max)
  haptic('tick', { fromClick: true })
}

function onKeydown(event: KeyboardEvent) {
  const moves: Record<string, number> = {
    ArrowUp: model.value - 1,
    ArrowDown: model.value + 1,
    PageUp: model.value - 10,
    PageDown: model.value + 10,
    Home: props.min,
    End: props.max,
  }
  const to = moves[event.key]
  if (to === undefined) return
  event.preventDefault()
  model.value = Math.min(Math.max(to, props.min), props.max)
}
</script>

<template>
  <div
    class="wheel relative"
    role="spinbutton"
    tabindex="0"
    :aria-label="label"
    :aria-valuemin="min"
    :aria-valuemax="max"
    :aria-valuenow="model"
    data-no-swipe
    data-testid="b.wheel"
    @keydown="onKeydown"
  >
    <span class="band" aria-hidden="true" />
    <div ref="scroller" class="scroller" :style="{ height: `${ROWS * row}px` }" @scroll.passive="onScroll" @click="onClick">
      <div class="relative" :style="{ paddingBlock: `${2 * row}px` }">
        <!-- One snap point per number (empty and cheap); the drawn rows are only the few near the centre. -->
        <span v-for="i in max - min + 1" :key="`s${i}`" class="snap" aria-hidden="true" />
        <span
          v-for="i in visible"
          :key="i"
          class="row figures"
          :class="Math.round(pos) === i ? 'text-ink' : 'text-ink-muted'"
          :style="rowStyle(i)"
          aria-hidden="true"
        >
          {{ n(i + min) }}<span v-if="suffix" class="suffix">{{ suffix }}</span>
        </span>
      </div>
    </div>
    <input
      v-if="typing"
      ref="input"
      v-model="field"
      class="typing figures text-figure"
      inputmode="numeric"
      enterkeyhint="done"
      :aria-label="label"
      data-testid="b.wheelInput"
      @blur="stopTyping"
      @keydown.enter="stopTyping"
    />
    <span class="fade" aria-hidden="true" />
  </div>
</template>

<style scoped>
.wheel {
  outline: none;
  user-select: none;
  -webkit-user-select: none;
}
.wheel:focus-visible {
  border-radius: var(--radius-md);
  outline: var(--stroke-focus) solid var(--color-accent);
}
.scroller {
  overflow-y: auto;
  overscroll-behavior: contain;
  scroll-snap-type: y mandatory;
  scrollbar-width: none;
  cursor: ns-resize;
}
.scroller::-webkit-scrollbar {
  display: none;
}
/* Snap points: one per row, the row's centre on the drum's. */
.snap {
  display: block;
  height: var(--size-touch);
  scroll-snap-align: center;
}
.row {
  position: absolute;
  right: 0;
  left: 0;
  display: flex;
  height: var(--size-touch);
  align-items: center;
  justify-content: center;
  font-size: var(--text-figure);
  font-weight: 300;
  letter-spacing: var(--text-figure--letter-spacing);
  line-height: var(--size-touch);
  pointer-events: none;
  backface-visibility: hidden;
}
.suffix {
  margin-left: var(--spacing-xs);
  font-size: var(--text-title);
}
.band {
  position: absolute;
  top: 50%;
  right: 0;
  left: 0;
  height: calc(var(--size-touch) + var(--spacing-sm));
  border-block: var(--stroke-hairline) solid var(--color-hairline-strong);
  border-radius: var(--radius-sm);
  background: var(--color-fill);
  transform: translateY(-50%);
  pointer-events: none;
}
.fade {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    to bottom,
    var(--color-surface-sheet),
    transparent 30%,
    transparent 70%,
    var(--color-surface-sheet)
  );
  pointer-events: none;
}
.typing {
  position: absolute;
  top: 50%;
  right: 0;
  left: 0;
  z-index: 1;
  height: var(--size-touch);
  background: var(--color-surface-sheet);
  color: var(--color-accent);
  text-align: center;
  caret-color: var(--color-accent);
  outline: none;
  transform: translateY(-50%);
}
</style>
