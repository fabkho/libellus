<script setup lang="ts">
// Direction B, "Counter": a compact Update progress sheet built around one
// number. What you did last time first ("Fri · p. 188 → 212 · 24 pages"),
// then the wheel with − / + (hold to run) and smart steps: the size of your
// last session, +10, +25, the end. "of 608" is a button: tapped, the same
// wheel sets the page count of your copy instead (#60), then hands back. At
// the last page the sheet asks "Finished it?" and offers Finish outright.
// Save sits in the title row, D's place for a sheet's action.
import {
  dayWords,
  haptic,
  lastSessionOf,
  maxOf,
  n,
  percentOf,
  positionOf,
  setPosition,
  setTotal,
  totalOf,
  useHoldRepeat,
  usesPages,
  type ProtoRead,
} from '../model'

const props = defineProps<{ read: ProtoRead | null; start?: 'total' | 'end' | null }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ saved: [read: ProtoRead, from: number]; finish: [read: ProtoRead] }>()

const kept = ref<ProtoRead | null>(props.read)
watch(
  () => props.read,
  (value) => value && (kept.value = value),
)

const mode = ref<'page' | 'percent'>('page')
const editing = ref<'progress' | 'total'>('progress')
const value = ref(0)
const total = ref(0)

const pages = computed(() => (kept.value ? usesPages(kept.value) : false))
const inPercent = computed(() => !pages.value || mode.value === 'percent')
const max = computed(() => (kept.value ? (inPercent.value ? 100 : maxOf(kept.value)) : 100))
const from = computed(() => (kept.value ? (inPercent.value ? percentOf(kept.value) : positionOf(kept.value)) : 0))
const last = computed(() => (kept.value ? lastSessionOf(kept.value) : null))
const lastAmount = computed(() => (last.value ? last.value.to - last.value.from : 0))
const atEnd = computed(() => editing.value === 'progress' && value.value >= max.value)
const delta = computed(() => value.value - from.value)

watch(open, (isOpen) => {
  if (!isOpen || !kept.value) return
  mode.value = 'page'
  editing.value = props.start === 'total' ? 'total' : 'progress'
  value.value = props.start === 'end' ? max.value : from.value
  total.value = totalOf(kept.value) ?? 300
})
watch(mode, () => (value.value = from.value))

function add(by: number) {
  const to = Math.min(Math.max(value.value + by, 0), max.value)
  haptic(to === max.value || to === 0 ? 'edge' : 'step', { fromClick: true })
  value.value = to
}
const minus = useHoldRepeat((times) => (editing.value === 'total' ? (total.value = Math.max(1, total.value - times)) : add(-times)))
const plus = useHoldRepeat((times) => (editing.value === 'total' ? (total.value += times) : add(times)))

/** Steps that fit this read: your last session, a round ten, a quarter-hundred (or 5 / 10 %). */
const steps = computed(() => {
  if (inPercent.value) return [5, 10]
  return [10, 25]
})

function save() {
  const read = kept.value
  if (!read) return
  if (editing.value === 'total') return doneTotal()
  const before = positionOf(read)
  const to = inPercent.value && pages.value ? Math.round((value.value / 100) * maxOf(read)) : value.value
  setPosition(read, to)
  haptic(atEnd.value ? 'done' : 'step', { fromClick: true })
  open.value = false
  emit('saved', read, before)
}
function finish() {
  const read = kept.value
  if (!read) return
  setPosition(read, maxOf(read))
  open.value = false
  emit('finish', read)
}
function editTotal() {
  if (!kept.value) return
  total.value = totalOf(kept.value) ?? 300
  editing.value = 'total'
}
function doneTotal() {
  if (!kept.value) return
  setTotal(kept.value, total.value)
  mode.value = 'page'
  value.value = positionOf(kept.value)
  editing.value = 'progress'
  haptic('step', { fromClick: true })
}
function editionTotal() {
  if (!kept.value) return
  setTotal(kept.value, null)
  value.value = positionOf(kept.value)
  editing.value = 'progress'
}
</script>

<template>
  <UiSheet v-model:open="open" title="Update progress" testid="bSheet" :action="editing === 'total' ? 'Done' : 'Save'" @action="save">
    <template v-if="kept">
      <UiBookLine
        :title="kept.book.title"
        :authors="kept.book.authors"
        :src="coverSrc(kept.book.coverUrl, 'xs')"
        :thumbhash="kept.book.coverThumbhash"
        :colors="kept.book.coverColors"
      />

      <!-- Last time, or what the wheel is for while it sets the page count. -->
      <div class="flex min-h-(--size-touch) items-center justify-between gap-ms">
        <template v-if="editing === 'progress'">
          <p v-if="last" class="figures min-w-0 truncate text-meta text-ink-faint" data-testid="b.last">
            <span class="eyebrow mr-sm">Last time</span>{{ dayWords(last.day) }} · {{ n(lastAmount) }}{{ pages ? ' pages' : ' %' }}
          </p>
        </template>
        <template v-else>
          <p class="eyebrow text-accent">Pages in your copy</p>
          <UiButton v-if="kept.total" tone="plain" size="sm" class="-mr-sm" data-testid="b.edition" @click="editionTotal">
            {{ kept.book.pageCount ? `Edition's ${n(kept.book.pageCount)}` : 'Use percent' }}
          </UiButton>
        </template>
      </div>

      <div class="mt-xs flex items-center gap-sm">
        <button
          type="button"
          class="step edge"
          aria-label="Less"
          data-testid="b.minus"
          @pointerdown="minus.start"
          @pointerup="minus.stop"
          @pointerleave="minus.stop"
          @pointercancel="minus.stop"
        >
          <span class="minus" aria-hidden="true" />
        </button>
        <div class="relative min-w-0 flex-1">
          <ProtoProgressBWheel
            v-if="editing === 'progress'"
            v-model="value"
            :max="max"
            :suffix="inPercent ? '%' : ''"
            :label="inPercent ? 'Percent read' : 'Page'"
          />
          <ProtoProgressBWheel v-else v-model="total" :min="1" :max="3000" label="Pages in your copy" />
        </div>
        <button
          type="button"
          class="step edge"
          aria-label="More"
          data-testid="b.plus"
          @pointerdown="plus.start"
          @pointerup="plus.stop"
          @pointerleave="plus.stop"
          @pointercancel="plus.stop"
        >
          <UiIcon name="plus" :size="18" />
        </button>
      </div>

      <!-- Under the wheel: of how many (the way to the page count), and what this adds. -->
      <div class="mt-xs flex min-h-(--size-touch) items-center gap-sm" :class="editing === 'progress' ? 'justify-between' : 'justify-center'">
        <template v-if="editing === 'progress'">
          <span class="flex min-w-0 items-center gap-sm">
          <button v-if="!inPercent" type="button" class="total figures text-caption text-ink-muted" data-testid="b.total" @click="editTotal">
            of {{ n(totalOf(kept)!) }}<UiIcon name="pencil" :size="12" class="ml-xs inline text-ink-faint" />
          </button>
          <button v-else-if="!pages" type="button" class="total text-caption text-ink-muted" data-testid="b.addTotal" @click="editTotal">
            Count in pages instead
          </button>
          <span v-if="delta" class="figures text-caption" :class="delta > 0 ? 'text-accent' : 'text-ink-faint'" data-testid="b.delta">
            {{ delta > 0 ? '+' : '−' }}{{ n(Math.abs(delta)) }}{{ inPercent ? ' %' : '' }}
          </span>
          </span>
          <div v-if="pages" role="group" aria-label="Count by" class="flex shrink-0 gap-xs">
            <button
              v-for="m in (['page', 'percent'] as const)"
              :key="m"
              type="button"
              :aria-pressed="mode === m"
              class="pill inline-flex h-(--size-button-sm) items-center rounded-pill px-ms text-caption"
              :class="mode === m ? 'bg-ink text-on-ink' : 'edge text-ink-muted'"
              :data-testid="`b.mode.${m}`"
              @click="mode = m"
            >
              {{ m === 'page' ? 'Pages' : 'Percent' }}
            </button>
          </div>
        </template>
        <p v-else class="text-center text-caption text-ink-faint">
          {{ kept.book.format === 'ebook' ? 'Your reader counts pages by font size. Use its total.' : 'Count the pages of the copy you hold.' }}
        </p>
      </div>

      <div v-if="editing === 'progress' && !atEnd" class="mt-sm flex flex-wrap justify-center gap-sm">
        <UiButton v-if="lastAmount" tone="quiet" size="sm" data-testid="b.sheetAgain" @click="add(lastAmount)">
          <UiIcon name="repeat" :size="14" />+{{ n(lastAmount) }}{{ inPercent ? ' %' : '' }}
        </UiButton>
        <UiButton v-for="s in steps" :key="s" tone="quiet" size="sm" :data-testid="`b.plus${s}`" @click="add(s)">
          +{{ s }}{{ inPercent ? ' %' : '' }}
        </UiButton>
        <UiButton tone="quiet" size="sm" data-testid="b.end" @click="add(max - value)">The end</UiButton>
      </div>

      <div
        v-if="atEnd"
        class="mt-sm flex items-center justify-between gap-ms rounded-md bg-fill px-inset py-ms edge-faint"
        data-testid="b.reached"
      >
        <span class="flex min-w-0 flex-col gap-xxs">
          <span class="text-body">Finished it?</span>
          <span class="text-caption text-ink-faint">That's the last page.</span>
        </span>
        <UiButton size="sm" data-testid="b.finish" @click="finish"><UiIcon name="check" :size="14" bold />Finish</UiButton>
      </div>
      <div class="h-md" />
    </template>
  </UiSheet>
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
.total {
  min-height: var(--size-touch);
  text-decoration: underline dotted var(--color-ink-ghost);
  text-underline-offset: var(--spacing-xs);
}
.pill {
  position: relative;
}
.pill::after {
  position: absolute;
  inset: 50% 0 auto;
  height: var(--size-touch);
  content: '';
  transform: translateY(-50%);
}
</style>
