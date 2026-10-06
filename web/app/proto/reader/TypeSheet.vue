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

const FLOWS = [
  { value: 'pages', label: 'Pages' },
  { value: 'scroll', label: 'Scroll' },
] as const
const classic = computed({
  get: () => props.settings.style === 'classic',
  set: (on: boolean) => (props.settings.style = on ? 'classic' : 'printed'),
})
const MARGIN_NAMES = ['Edge to edge', 'Narrow', 'Normal', 'Wide']
const LEADING_NAMES = ['Tight', 'Snug', 'Normal', 'Airy']

function size(step: number) {
  props.settings.size = Math.max(0, Math.min(FONT_SIZES.length - 1, props.settings.size + step))
}
</script>

<template>
  <UiSheet v-model:open="open" title="Text" testid="readerType">
    <!-- Pages or scroll: b lives here now, as a way of reading a and c. -->
    <UiSegmented v-model="settings.flow" class="mb-md" :options="FLOWS" label="Layout" testid="readerType.flow">
      <template #option="{ option }">
        <ProtoIcon :name="option.value" :size="18" />{{ option.label }}
      </template>
    </UiSegmented>
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
    <UiSegmented v-model="settings.margins" :options="MARGIN_NAMES.map((label, value) => ({ value, label }))" label="Margins" testid="readerType.margins">
      <template #option="{ option }">
        <ProtoIcon :name="(`margins${option.value}` as 'margins0')" :size="20" />
      </template>
    </UiSegmented>

    <p class="mt-md mb-xs flex items-baseline justify-between px-xs text-caption">
      <span class="text-ink-muted">Line spacing</span><span class="text-ink-faint">{{ LEADING_NAMES[settings.leading] }}</span>
    </p>
    <UiSegmented v-model="settings.leading" :options="LEADING_NAMES.map((label, value) => ({ value, label }))" label="Line spacing" testid="readerType.leading">
      <template #option="{ option }">
        <ProtoIcon :name="(`leading${option.value}` as 'leading0')" :size="20" />
      </template>
    </UiSegmented>

    <UiRowGroup class="mt-md">
      <UiSwitchRow v-model="settings.justify" label="Justify" testid="readerType.justify" />
      <UiSwitchRow v-model="settings.keepAwake" label="Keep the screen on" testid="readerType.awake" />
      <!-- The reader's style, quietly last: off is the printed page (c, the default), on the classic one (a). -->
      <UiSwitchRow v-model="classic" label="Classic mode" testid="readerType.classic" />
    </UiRowGroup>
    <p class="mt-sm mb-xs px-xs text-caption text-ink-faint">
      {{ settings.keepAwake ? 'While a book is open the screen stays on.' : 'The screen turns off as usual.' }}
      <template v-if="wakeNote"> {{ wakeNote }}</template>
      {{ settings.style === 'classic' ? 'Classic mode: a bar at the top and one at the bottom.' : 'Turn on Classic mode for a bar at the top and one at the bottom instead of the capsule.' }}
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
</style>
