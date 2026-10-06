<script setup lang="ts">
// What selected words (or a tapped highlight) can do: Translate, Define, Copy,
// Search, and the four highlight colours (plus Remove on a highlight). Three
// designs to compare, the same actions in each:
//
// - bubble: an ink card floating by the selection, its tail pointing at it —
//   below the words on a touch screen (Android draws its own Copy/Share bar
//   above them), above them with a mouse.
// - dock: the same actions in a glass bar risen at the bottom edge, like the
//   tab bar; never on the words, always under the thumb.
// - peek: Google Books' way, one step further: a low panel at the bottom that
//   already shows the answer — the definition of a single word, the
//   translation of a phrase — with the actions under it; its text opens the
//   full sheet.
import type { Box } from './engine'
import { HIGHLIGHTS } from './highlights'
import ProtoIcon from './ProtoIcon.vue'

export interface MenuTarget {
  text: string
  rect: Box
  first: Box
  last: Box
  /** The colour of the highlight tapped, if it is one. */
  color: string | null
}
export interface Peek {
  kind: 'define' | 'translate'
  loading: boolean
  title: string
  text: string | null
  meta: string
}

const props = defineProps<{ design: 'bubble' | 'dock' | 'peek'; target: MenuTarget | null; canDefine: boolean; peek: Peek | null }>()
defineEmits<{ translate: []; define: []; copy: []; search: []; color: [key: string]; remove: []; more: [kind: 'define' | 'translate'] }>()

const menu = useTemplateRef<HTMLElement>('menu')
const size = reactive({ width: 296, height: 112 })
const finePointer = typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches

watch(
  () => props.target,
  async () => {
    await nextTick()
    if (menu.value) {
      size.width = menu.value.offsetWidth
      size.height = menu.value.offsetHeight
    }
  },
)

/** Where the bubble stands: centred on the words, below them on touch (above with a mouse), flipped when there is no room. */
const place = computed(() => {
  const t = props.target
  if (!t) return { left: 0, top: 0, below: true, tail: 0 }
  const vw = window.innerWidth
  const vh = window.innerHeight
  const gap = 14
  const margin = 8
  const centre = t.rect.left + t.rect.width / 2
  const left = Math.min(Math.max(margin, centre - size.width / 2), vw - size.width - margin)
  const belowTop = t.last.top + t.last.height + gap
  const aboveTop = t.first.top - gap - size.height
  const roomBelow = belowTop + size.height < vh - margin
  const roomAbove = aboveTop > margin
  const below = finePointer ? !roomAbove : roomBelow || !roomAbove
  const top = below ? Math.min(belowTop, vh - size.height - margin) : Math.max(margin, aboveTop)
  return { left, top, below, tail: Math.min(Math.max(centre - left, 20), size.width - 20) }
})

const ACTIONS = [
  { key: 'translate', label: 'Translate', icon: 'translate' },
  { key: 'define', label: 'Define', icon: 'define' },
  { key: 'copy', label: 'Copy', icon: 'copy' },
  { key: 'search', label: 'Search', icon: 'search' },
] as const
</script>

<template>
  <!-- bubble -->
  <Transition name="pop">
    <div
      v-if="target && design === 'bubble'"
      ref="menu"
      class="bubble fixed z-40 rounded-md bg-ink p-xs text-on-ink shadow-palette"
      :style="{ left: `${place.left}px`, top: `${place.top}px`, '--tail': `${place.tail}px` }"
      :class="place.below ? 'below' : 'above'"
      role="menu"
      aria-label="Selection"
      data-testid="reader.menu"
      @pointerdown.prevent
    >
      <div class="flex">
        <button
          v-for="a in ACTIONS"
          :key="a.key"
          type="button"
          role="menuitem"
          class="flex min-h-(--size-touch) w-(--size-tab) flex-col items-center justify-center gap-xxs rounded-sm text-meta hover:bg-fill disabled:opacity-35"
          :disabled="a.key === 'define' && !canDefine"
          :data-testid="`reader.menu.${a.key}`"
          @click="$emit(a.key)"
        >
          <ProtoIcon :name="a.icon" :size="20" />{{ a.label }}
        </button>
      </div>
      <div class="rule mx-xs" aria-hidden="true" />
      <div class="flex items-center justify-between px-xs">
        <span class="flex">
          <button
            v-for="h in HIGHLIGHTS"
            :key="h.key"
            type="button"
            role="menuitemradio"
            :aria-checked="target.color === h.key"
            :aria-label="`Highlight ${h.name}`"
            class="flex size-(--size-touch) items-center justify-center"
            :data-testid="`reader.menu.color.${h.key}`"
            @click="$emit('color', h.key)"
          >
            <span class="swatch" :class="target.color === h.key && 'on'" :style="{ background: h.color }" />
          </button>
        </span>
        <button v-if="target.color" type="button" class="flex min-h-(--size-touch) items-center gap-xs px-xs text-caption" data-testid="reader.menu.remove" @click="$emit('remove')">
          <UiIcon name="trash" :size="16" />Remove
        </button>
        <span v-else class="pr-xs text-meta opacity-60">Highlight</span>
      </div>
    </div>
  </Transition>

  <!-- dock -->
  <Transition name="rise">
    <div v-if="target && design === 'dock'" class="dock fixed inset-x-0 z-40 flex justify-center px-ml" data-testid="reader.menu" @pointerdown.prevent>
      <div class="glass edge w-full max-w-(--size-max-content) rounded-xl p-xs shadow-float" role="menu" aria-label="Selection">
        <p class="book-title truncate px-ms pt-xs text-caption text-ink-muted">“{{ target.text }}”</p>
        <div class="flex">
          <button
            v-for="a in ACTIONS"
            :key="a.key"
            type="button"
            role="menuitem"
            class="flex min-h-(--size-button) flex-1 flex-col items-center justify-center gap-xxs rounded-md text-meta text-ink hover:bg-fill disabled:opacity-35"
            :disabled="a.key === 'define' && !canDefine"
            :data-testid="`reader.menu.${a.key}`"
            @click="$emit(a.key)"
          >
            <ProtoIcon :name="a.icon" :size="22" />{{ a.label }}
          </button>
        </div>
        <div class="flex items-center justify-between border-t-(length:--stroke-hairline) border-hairline px-xs">
          <span class="flex">
            <button
              v-for="h in HIGHLIGHTS"
              :key="h.key"
              type="button"
              role="menuitemradio"
              :aria-checked="target.color === h.key"
              :aria-label="`Highlight ${h.name}`"
              class="flex size-(--size-touch) items-center justify-center"
              :data-testid="`reader.menu.color.${h.key}`"
              @click="$emit('color', h.key)"
            >
              <span class="swatch" :class="target.color === h.key && 'on'" :style="{ background: h.color }" />
            </button>
          </span>
          <button v-if="target.color" type="button" class="flex min-h-(--size-touch) items-center gap-xs px-xs text-caption text-ink-muted" data-testid="reader.menu.remove" @click="$emit('remove')">
            <UiIcon name="trash" :size="16" />Remove
          </button>
          <span v-else class="pr-xs text-meta text-ink-faint">Highlight</span>
        </div>
      </div>
    </div>
  </Transition>

  <!-- peek -->
  <Transition name="rise">
    <section
      v-if="target && design === 'peek'"
      class="peek safe-bottom fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-(--size-max-content) rounded-t-sheet bg-surface-sheet shadow-sheet"
      role="menu"
      aria-label="Selection"
      data-testid="reader.menu"
      @pointerdown.prevent
    >
      <span class="mx-auto mt-(--spacing-grabber) block h-(--size-grabber-height) w-(--size-grabber) rounded-pill bg-ink-ghost" aria-hidden="true" />
      <button
        v-if="peek"
        type="button"
        class="block w-full px-ml pt-ms pb-sm text-left"
        :data-testid="`reader.peek.${peek.kind}`"
        @click="$emit('more', peek.kind)"
      >
        <span class="flex items-baseline justify-between gap-sm">
          <span class="book-title truncate text-callout text-ink">{{ peek.title }}</span>
          <span class="eyebrow shrink-0">{{ peek.meta }}</span>
        </span>
        <span class="peek-text mt-xs block text-subhead" :class="peek.loading ? 'text-ink-faint' : 'text-ink-muted'">
          {{ peek.loading ? (peek.kind === 'define' ? 'Looking it up…' : 'Translating…') : (peek.text ?? 'Nothing found.') }}
        </span>
        <span v-if="!peek.loading && peek.text" class="mt-xs flex items-center gap-xxs text-caption font-medium text-accent">
          {{ peek.kind === 'define' ? 'Full definition' : 'Translation' }}<UiIcon name="chevron" :size="13" bold />
        </span>
      </button>
      <div class="flex border-t-(length:--stroke-hairline) border-hairline px-sm">
        <button
          v-for="a in ACTIONS"
          :key="a.key"
          type="button"
          role="menuitem"
          class="flex min-h-(--size-button) flex-1 flex-col items-center justify-center gap-xxs text-meta text-ink disabled:opacity-35"
          :disabled="a.key === 'define' && !canDefine"
          :data-testid="`reader.menu.${a.key}`"
          @click="$emit(a.key)"
        >
          <ProtoIcon :name="a.icon" :size="20" />{{ a.label }}
        </button>
      </div>
      <div class="flex items-center justify-between px-ml pb-xs">
        <span class="-ml-ms flex">
          <button
            v-for="h in HIGHLIGHTS"
            :key="h.key"
            type="button"
            role="menuitemradio"
            :aria-checked="target.color === h.key"
            :aria-label="`Highlight ${h.name}`"
            class="flex size-(--size-touch) items-center justify-center"
            :data-testid="`reader.menu.color.${h.key}`"
            @click="$emit('color', h.key)"
          >
            <span class="swatch" :class="target.color === h.key && 'on'" :style="{ background: h.color }" />
          </button>
        </span>
        <button v-if="target.color" type="button" class="flex min-h-(--size-touch) items-center gap-xs text-caption text-ink-muted" data-testid="reader.menu.remove" @click="$emit('remove')">
          <UiIcon name="trash" :size="16" />Remove
        </button>
        <span v-else class="text-meta text-ink-faint">Highlight</span>
      </div>
    </section>
  </Transition>
</template>

<style scoped>
.bubble .rule {
  height: var(--stroke-hairline);
  background: color-mix(in srgb, var(--color-on-ink) 16%, transparent);
}
/* The tail: a small diamond of the card's own ink, pointing at the words. */
.bubble::after {
  position: absolute;
  left: calc(var(--tail) - var(--spacing-xs));
  width: var(--spacing-sm);
  height: var(--spacing-sm);
  content: '';
  background: var(--color-ink);
  transform: rotate(45deg);
}
.bubble.below::after {
  top: calc(-1 * var(--spacing-xs));
}
.bubble.above::after {
  bottom: calc(-1 * var(--spacing-xs));
}
.bubble button:hover {
  background: color-mix(in srgb, var(--color-on-ink) 10%, transparent);
}
.swatch {
  width: var(--size-star-lg);
  height: var(--size-star-lg);
  border-radius: var(--radius-pill);
  box-shadow: inset 0 0 0 var(--stroke-hairline) color-mix(in srgb, black 20%, transparent);
  transition: transform var(--duration-quick) var(--ease-standard);
}
.swatch.on {
  box-shadow:
    0 0 0 var(--stroke-focus) var(--color-surface-sheet),
    0 0 0 calc(2 * var(--stroke-focus)) currentColor;
}
.bubble .swatch.on {
  box-shadow:
    0 0 0 var(--stroke-focus) var(--color-ink),
    0 0 0 calc(2 * var(--stroke-focus)) var(--color-on-ink);
}
.dock {
  bottom: var(--float-bottom);
}
.peek-text {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}
.pop-enter-active {
  transition:
    opacity var(--duration-quick) var(--ease-standard),
    transform var(--duration-quick) var(--ease-standard);
}
.pop-leave-active {
  transition: opacity var(--duration-instant) var(--ease-exit);
}
.pop-enter-from {
  opacity: 0;
  transform: scale(0.96);
}
.pop-leave-to {
  opacity: 0;
}
.rise-enter-active {
  transition: transform var(--duration-sheet) var(--ease-sheet);
}
.rise-leave-active {
  transition: transform var(--duration-sheet-exit) var(--ease-exit);
}
.rise-enter-from,
.rise-leave-to {
  transform: translateY(calc(100% + var(--float-bottom)));
}
</style>
