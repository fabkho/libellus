<script setup lang="ts">
// The Aa sheet: the page's type and room, applied as they change (the page
// behind the scrim reflows at once). The room first (light, dark, sepia: each
// swatch drawn in its own room's tokens), the app's two families (Newsreader,
// Geist), seven sizes, four margins (down to edge to edge, for the most text a
// screen holds at a readable size), four line spacings, justification, and
// keeping the screen on while reading. Kept on this device.
import ProtoIcon from './ProtoIcon.vue'
import { FONT_SIZES, type ReaderSettings, type ReaderTheme } from './settings'

const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{ settings: ReaderSettings; wakeNote: string | null }>()

const THEMES: { key: ReaderTheme; label: string }[] = [
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
  { key: 'sepia', label: 'Sepia' },
]
const appDark = typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
const current = computed(() => props.settings.theme ?? (document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && appDark) ? 'dark' : 'light'))

const MARGIN_NAMES = ['Edge to edge', 'Narrow', 'Normal', 'Wide']
const LEADING_NAMES = ['Tight', 'Snug', 'Normal', 'Airy']

function size(step: number) {
  props.settings.size = Math.max(0, Math.min(FONT_SIZES.length - 1, props.settings.size + step))
}
</script>

<template>
  <UiSheet v-model:open="open" title="Text" testid="readerType">
    <!-- Pages or scroll: b lives here now, as a way of reading a and c. -->
    <div class="seg mb-md flex h-(--size-row) rounded-md bg-fill p-xxs edge-faint" role="radiogroup" aria-label="Layout">
      <button
        v-for="f in (['pages', 'scroll'] as const)"
        :key="f"
        type="button"
        role="radio"
        :aria-checked="settings.flow === f"
        class="flex flex-1 items-center justify-center gap-sm rounded-sm text-caption text-ink-muted"
        :class="settings.flow === f && 'on'"
        :data-testid="`readerType.flow.${f}`"
        @click="settings.flow = f"
      >
        <ProtoIcon :name="f" :size="18" />{{ f === 'pages' ? 'Pages' : 'Scroll' }}
      </button>
    </div>
    <div class="grid grid-cols-3 gap-ms" role="radiogroup" aria-label="Room">
      <button
        v-for="room in THEMES"
        :key="room.key"
        type="button"
        role="radio"
        :aria-checked="current === room.key"
        class="swatch flex h-(--size-query) flex-col items-center justify-center gap-xxs rounded-md bg-surface text-ink edge"
        :class="current === room.key && 'on'"
        :data-theme="room.key"
        :data-testid="`readerType.theme.${room.key}`"
        @click="settings.theme = room.key"
      >
        <span class="book-title text-callout">Aa</span>
        <span class="text-meta text-ink-muted">{{ room.label }}</span>
      </button>
    </div>

    <div class="mt-md grid grid-cols-2 gap-ms" role="radiogroup" aria-label="Typeface">
      <button
        v-for="face in (['serif', 'sans'] as const)"
        :key="face"
        type="button"
        role="radio"
        :aria-checked="settings.font === face"
        class="option flex h-(--size-query) items-center gap-ms rounded-md px-inset text-left"
        :class="settings.font === face && 'on'"
        :data-testid="`readerType.font.${face}`"
        @click="settings.font = face"
      >
        <span class="text-title" :class="face === 'serif' ? 'font-serif' : 'font-sans'">Aa</span>
        <span>
          <span class="block text-caption text-ink">{{ face === 'serif' ? 'Newsreader' : 'Geist' }}</span>
          <span class="block text-meta text-ink-faint">{{ face === 'serif' ? 'Serif' : 'Sans' }}</span>
        </span>
      </button>
    </div>

    <div class="mt-md flex h-(--size-row) items-center rounded-md bg-fill edge-faint" data-testid="readerType.size">
      <button type="button" class="flex h-full w-(--size-query) items-center justify-center text-ink disabled:text-ink-ghost" :disabled="settings.size === 0" aria-label="Smaller text" @click="size(-1)">
        <span class="book-title text-caption">A</span>
      </button>
      <span class="flex flex-1 items-center justify-center gap-sm" aria-hidden="true">
        <span v-for="(_, i) in FONT_SIZES" :key="i" class="step rounded-pill" :class="i <= settings.size ? 'bg-ink' : 'bg-ink-ghost'" />
      </span>
      <span class="sr-only" aria-live="polite">Text size {{ settings.size + 1 }} of {{ FONT_SIZES.length }}</span>
      <button type="button" class="flex h-full w-(--size-query) items-center justify-center text-ink disabled:text-ink-ghost" :disabled="settings.size === FONT_SIZES.length - 1" aria-label="Larger text" @click="size(1)">
        <span class="book-title text-title">A</span>
      </button>
    </div>

    <!-- Margins first: edge to edge is how a phone holds the most text at a size that stays readable. -->
    <p class="mt-md mb-xs flex items-baseline justify-between px-xs text-caption">
      <span class="text-ink-muted">Margins</span><span class="text-ink-faint">{{ MARGIN_NAMES[settings.margins] }}</span>
    </p>
    <div class="seg flex h-(--size-row) rounded-md bg-fill p-xxs edge-faint" role="radiogroup" aria-label="Margins">
      <button
        v-for="i in [0, 1, 2, 3]"
        :key="i"
        type="button"
        role="radio"
        :aria-checked="settings.margins === i"
        :aria-label="MARGIN_NAMES[i]"
        class="flex flex-1 items-center justify-center rounded-sm text-ink-muted"
        :class="settings.margins === i && 'on'"
        :data-testid="`readerType.margins.${i}`"
        @click="settings.margins = i"
      >
        <ProtoIcon :name="(`margins${i}` as 'margins0')" :size="20" />
      </button>
    </div>

    <p class="mt-md mb-xs flex items-baseline justify-between px-xs text-caption">
      <span class="text-ink-muted">Line spacing</span><span class="text-ink-faint">{{ LEADING_NAMES[settings.leading] }}</span>
    </p>
    <div class="seg flex h-(--size-row) rounded-md bg-fill p-xxs edge-faint" role="radiogroup" aria-label="Line spacing">
      <button
        v-for="i in [0, 1, 2, 3]"
        :key="i"
        type="button"
        role="radio"
        :aria-checked="settings.leading === i"
        :aria-label="LEADING_NAMES[i]"
        class="flex flex-1 items-center justify-center rounded-sm text-ink-muted"
        :class="settings.leading === i && 'on'"
        :data-testid="`readerType.leading.${i}`"
        @click="settings.leading = i"
      >
        <ProtoIcon :name="(`leading${i}` as 'leading0')" :size="20" />
      </button>
    </div>

    <UiRowGroup class="mt-md">
      <UiRow as="button" role="switch" :aria-checked="settings.justify" label="Justify" data-testid="readerType.justify" @click="settings.justify = !settings.justify">
        <span class="switch flex w-(--size-switch) shrink-0 rounded-pill p-xxs" :class="settings.justify ? 'bg-accent' : 'bg-fill-strong'" aria-hidden="true">
          <span class="knob size-(--size-switch-thumb) rounded-pill bg-surface-raised shadow-button" :class="settings.justify && 'on'" />
        </span>
      </UiRow>
      <UiRow as="button" role="switch" :aria-checked="settings.keepAwake" label="Keep the screen on" data-testid="readerType.awake" @click="settings.keepAwake = !settings.keepAwake">
        <span class="switch flex w-(--size-switch) shrink-0 rounded-pill p-xxs" :class="settings.keepAwake ? 'bg-accent' : 'bg-fill-strong'" aria-hidden="true">
          <span class="knob size-(--size-switch-thumb) rounded-pill bg-surface-raised shadow-button" :class="settings.keepAwake && 'on'" />
        </span>
      </UiRow>
      <!-- The reader's style, quietly last: on is the printed page (c, the default), off the classic one (a). -->
      <UiRow
        as="button"
        role="switch"
        :aria-checked="settings.style === 'printed'"
        label="Printed page"
        data-testid="readerType.printed"
        @click="settings.style = settings.style === 'printed' ? 'classic' : 'printed'"
      >
        <span class="switch flex w-(--size-switch) shrink-0 rounded-pill p-xxs" :class="settings.style === 'printed' ? 'bg-accent' : 'bg-fill-strong'" aria-hidden="true">
          <span class="knob size-(--size-switch-thumb) rounded-pill bg-surface-raised shadow-button" :class="settings.style === 'printed' && 'on'" />
        </span>
      </UiRow>
    </UiRowGroup>
    <p class="mt-sm mb-xs px-xs text-caption text-ink-faint">
      {{ settings.keepAwake ? 'While a book is open the screen stays on.' : 'The screen turns off as usual.' }}
      <template v-if="wakeNote"> {{ wakeNote }}</template>
      {{ settings.style === 'printed' ? 'Printed page: the chapter and page number in the margins, a small capsule.' : 'Classic: a bar at the top and one at the bottom.' }}
    </p>
  </UiSheet>
</template>

<style scoped>
.swatch {
  transition: box-shadow var(--duration-quick) var(--ease-standard);
}
.swatch.on {
  box-shadow: inset 0 0 0 var(--stroke-focus) var(--color-accent);
}
.option {
  background: var(--color-fill);
  box-shadow: inset 0 0 0 var(--stroke-hairline) var(--color-hairline);
}
.option.on {
  box-shadow: inset 0 0 0 var(--stroke-focus) var(--color-accent);
  background: var(--color-accent-soft);
}
.step {
  width: var(--spacing-xs);
  height: var(--spacing-xs);
}
.seg button.on {
  background: var(--color-surface-raised);
  color: var(--color-ink);
  box-shadow: var(--elevation-button);
}
.switch {
  transition: background-color var(--duration-quick) var(--ease-standard);
}
.knob {
  transition: transform var(--duration-quick) var(--ease-standard);
}
.knob.on {
  transform: translateX(calc(var(--size-switch) - var(--size-switch-thumb) - 2 * var(--spacing-xxs)));
}
</style>
