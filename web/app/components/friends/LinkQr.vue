<script setup lang="ts">
// The follow link as a QR code (social v2b, Profile → Friends → Your follow link): one scan in person (a book
// club, a reading retreat) instead of sending a link. Drawn here, in the browser (utils/qr.ts), never by a
// service: the link does not leave the device. Inline SVG, crisp at any size; the name says what it is, and the
// link itself is the text under it in the sheet. Ink on paper; in the dark theme the tile is inverted (light
// paper, dark modules), which every scanner reads, where a light code on a dark room is not read by all.
// Props: `url` (the link; nothing is drawn without one). Test ids: `<testid>` (the figure, default
// `followLink.qr`), `<testid>.code` (the SVG).
import { QR_QUIET_ZONE, qrCode } from '~/utils/qr'

const props = withDefaults(defineProps<{ url: string | null; testid?: string }>(), { testid: 'followLink.qr' })
const { t } = useI18n()
const code = computed(() => (props.url ? qrCode(props.url) : null))
const box = computed(() => (code.value ? code.value.size + QR_QUIET_ZONE * 2 : 0))
</script>

<template>
  <figure v-if="code" class="flex flex-col items-center gap-sm" :data-testid="testid">
    <div class="qr-tile rounded-md edge p-xs">
      <svg
        :viewBox="`0 0 ${box} ${box}`"
        class="block size-(--size-qr)"
        role="img"
        :aria-label="t('followLink.qrLabel')"
        shape-rendering="crispEdges"
        :data-testid="`${testid}.code`"
      >
        <rect width="100%" height="100%" class="qr-paper" />
        <path :d="code.path" :transform="`translate(${QR_QUIET_ZONE} ${QR_QUIET_ZONE})`" class="qr-modules" />
      </svg>
    </div>
    <figcaption class="text-center text-footnote text-ink-muted">{{ t('followLink.qrHint') }}</figcaption>
  </figure>
</template>

<style>
/* Not scoped: the dark theme's rules below need the theme's own selectors in front of the tile. */
.qr-tile {
  --qr-paper: var(--color-surface-raised);
  --qr-ink: var(--color-ink);
  background: var(--qr-paper);
}
.qr-paper {
  fill: var(--qr-paper);
}
.qr-modules {
  fill: var(--qr-ink);
}
/* Dark: an inverted tile, light paper with dark modules. */
[data-theme='dark'] .qr-tile {
  --qr-paper: var(--color-ink);
  --qr-ink: var(--color-surface);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) .qr-tile {
    --qr-paper: var(--color-ink);
    --qr-ink: var(--color-surface);
  }
}
</style>
