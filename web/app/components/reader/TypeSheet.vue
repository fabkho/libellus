<script setup lang="ts">
// The reader's Aa sheet (#131 phase 2): how the book is set, applied as it
// changes (the page reflows behind the scrim). Pages or scroll; the room
// (light, dark, sepia: each swatch drawn in its own room's tokens); the app's
// two families (Newsreader, Geist); seven sizes; four margins (down to edge to
// edge, the most text a screen holds at a readable size); four line spacings;
// then the switches: justify, keep the screen on, and last, quietly, Classic
// mode (the other style; the Profile has it too). Kept on this device.
import { FONT_SIZES, LEADINGS, MARGINS, type ReaderSettings, type ReaderTheme } from '~/data/reader/settings'

const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{ settings: ReaderSettings }>()

const { t } = useI18n()

const ROOMS: ReaderTheme[] = ['light', 'dark', 'sepia']
const appDark = window.matchMedia('(prefers-color-scheme: dark)').matches
/** The room showing: the setting, or the app's own theme while there is none. */
const current = computed<ReaderTheme>(() => props.settings.theme ?? (document.documentElement.dataset.theme === 'dark' || appDark ? 'dark' : 'light'))

const flows = computed(() => [
  { value: 'pages' as const, label: t('reader.type.pages') },
  { value: 'scroll' as const, label: t('reader.type.scroll') },
])
const margins = computed(() => MARGINS.map((_, value) => ({ value, label: t(`reader.type.marginNames.${value}`) })))
const spacings = computed(() => LEADINGS.map((_, value) => ({ value, label: t(`reader.type.spacingNames.${value}`) })))
const classic = computed({
  get: () => props.settings.style === 'classic',
  set: (on: boolean) => (props.settings.style = on ? 'classic' : 'printed'),
})

function size(step: number) {
  props.settings.size = Math.max(0, Math.min(FONT_SIZES.length - 1, props.settings.size + step))
}
</script>

<template>
  <UiSheet v-model:open="open" :title="t('reader.type.title')" testid="readerType">
    <UiSegmented v-model="settings.flow" class="mb-md" :options="flows" :label="t('reader.type.layout')" testid="readerType.flow">
      <template #option="{ option }">
        <UiIcon :name="option.value === 'pages' ? 'read' : 'ebook'" :size="18" />{{ option.label }}
      </template>
    </UiSegmented>

    <div class="grid grid-cols-3 gap-ms" role="radiogroup" :aria-label="t('reader.type.room')">
      <button
        v-for="room in ROOMS"
        :key="room"
        type="button"
        role="radio"
        :aria-checked="current === room"
        class="swatch flex h-(--size-query) flex-col items-center justify-center gap-xxs rounded-md bg-surface text-ink edge"
        :class="current === room && 'on'"
        :data-theme="room"
        :data-testid="`readerType.theme.${room}`"
        @click="settings.theme = room"
      >
        <span class="book-title text-callout" aria-hidden="true">Aa</span>
        <span class="text-meta text-ink-muted">{{ t(`reader.type.${room}`) }}</span>
      </button>
    </div>

    <div class="mt-md grid grid-cols-2 gap-ms" role="radiogroup" :aria-label="t('reader.type.typeface')">
      <button
        v-for="face in ['serif', 'sans'] as const"
        :key="face"
        type="button"
        role="radio"
        :aria-checked="settings.font === face"
        class="face flex h-(--size-query) items-center gap-ms rounded-md px-inset text-left"
        :class="settings.font === face && 'on'"
        :data-testid="`readerType.font.${face}`"
        @click="settings.font = face"
      >
        <span class="text-title" :class="face === 'serif' ? 'font-serif' : 'font-sans'" aria-hidden="true">Aa</span>
        <span>
          <span class="block text-caption text-ink">{{ face === 'serif' ? 'Newsreader' : 'Geist' }}</span>
          <span class="block text-meta text-ink-faint">{{ t(`reader.type.${face}`) }}</span>
        </span>
      </button>
    </div>

    <div class="mt-md flex h-(--size-row) items-center rounded-md bg-fill edge-faint" data-testid="readerType.size">
      <button
        type="button"
        class="flex h-full w-(--size-query) items-center justify-center text-ink disabled:text-ink-ghost"
        :disabled="settings.size === 0"
        :aria-label="t('reader.type.smaller')"
        data-testid="readerType.smaller"
        @click="size(-1)"
      >
        <span class="book-title text-caption" aria-hidden="true">A</span>
      </button>
      <span class="flex flex-1 items-center justify-center gap-sm" aria-hidden="true">
        <span v-for="(_, i) in FONT_SIZES" :key="i" class="step rounded-pill" :class="i <= settings.size ? 'bg-ink' : 'bg-ink-ghost'" />
      </span>
      <span class="sr-only" aria-live="polite">{{ t('reader.type.sizeOf', { size: settings.size + 1, count: FONT_SIZES.length }) }}</span>
      <button
        type="button"
        class="flex h-full w-(--size-query) items-center justify-center text-ink disabled:text-ink-ghost"
        :disabled="settings.size === FONT_SIZES.length - 1"
        :aria-label="t('reader.type.larger')"
        data-testid="readerType.larger"
        @click="size(1)"
      >
        <span class="book-title text-title" aria-hidden="true">A</span>
      </button>
    </div>

    <p class="mt-md mb-xs flex items-baseline justify-between px-xs text-caption">
      <span class="text-ink-muted">{{ t('reader.type.margins') }}</span><span class="text-ink-faint">{{ t(`reader.type.marginNames.${settings.margins}`) }}</span>
    </p>
    <UiSegmented v-model="settings.margins" :options="margins" :label="t('reader.type.margins')" testid="readerType.margins">
      <template #option="{ option }">
        <UiIcon :name="`margins${option.value}` as 'margins0'" :size="20" />
      </template>
    </UiSegmented>

    <p class="mt-md mb-xs flex items-baseline justify-between px-xs text-caption">
      <span class="text-ink-muted">{{ t('reader.type.spacing') }}</span><span class="text-ink-faint">{{ t(`reader.type.spacingNames.${settings.leading}`) }}</span>
    </p>
    <UiSegmented v-model="settings.leading" :options="spacings" :label="t('reader.type.spacing')" testid="readerType.leading">
      <template #option="{ option }">
        <UiIcon :name="`leading${option.value}` as 'leading0'" :size="20" />
      </template>
    </UiSegmented>

    <UiRowGroup class="mt-md">
      <UiSwitchRow v-model="settings.justify" :label="t('reader.type.justify')" testid="readerType.justify" />
      <UiSwitchRow v-model="settings.keepAwake" :label="t('reader.type.awake')" testid="readerType.awake" />
      <UiSwitchRow v-model="classic" :label="t('reader.type.classic')" testid="readerType.classic" />
    </UiRowGroup>
    <p class="mt-sm mb-xs px-xs text-caption text-ink-faint">
      {{ settings.keepAwake ? t('reader.type.awakeOn') : t('reader.type.awakeOff') }}
      {{ classic ? t('reader.type.classicOn') : t('reader.type.classicOff') }}
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
.face {
  background: var(--color-fill);
  box-shadow: inset 0 0 0 var(--stroke-hairline) var(--color-hairline);
}
.face.on {
  box-shadow: inset 0 0 0 var(--stroke-focus) var(--color-accent);
  background: var(--color-accent-soft);
}
.step {
  width: var(--spacing-xs);
  height: var(--spacing-xs);
}
</style>
