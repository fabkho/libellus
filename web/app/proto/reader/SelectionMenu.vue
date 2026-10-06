<script setup lang="ts">
// What selected words (or a tapped highlight) can do: Translate, Define, Copy,
// Search, and the four highlight colours (plus Remove on a highlight), in an
// ink bubble by the words with its tail pointing at them — above them, as the
// reader draws its own selection and Android's Copy / Share bar never shows
// (Reader.vue); below them only where there is no room above. (Owner's pick
// after round 2: the bubble is the only menu; dock and peek were dropped.)
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

const props = defineProps<{ target: MenuTarget | null; canDefine: boolean }>()
defineEmits<{ translate: []; define: []; copy: []; search: []; color: [key: string]; remove: [] }>()

const menu = useTemplateRef<HTMLElement>('menu')
const size = reactive({ width: 296, height: 112 })

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

/** Where the bubble stands: centred on the words, above them, below only when there is no room above. */
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
  const below = !roomAbove && roomBelow
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
      v-if="target"
      ref="menu"
      class="bubble fixed z-40 rounded-md bg-ink p-xs text-on-ink shadow-palette"
      :style="{ left: `${place.left}px`, top: `${place.top}px`, '--tail': `${place.tail}px` }"
      :class="place.below ? 'below' : 'above'"
      role="menu"
      aria-label="Selection"
      data-testid="reader.menu"
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
    0 0 0 var(--stroke-focus) var(--color-ink),
    0 0 0 calc(2 * var(--stroke-focus)) var(--color-on-ink);
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
</style>
