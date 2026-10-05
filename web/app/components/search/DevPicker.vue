<script setup lang="ts">
// Dev only (design round on the first-results loading state): a row of chips at
// the top of the screen to pick the loading idea (o = today's, a–e) and the
// artificial wait (seconds), for trying the five on a phone without typing
// `?loading=c&delay=2000`. Never rendered in a build (SearchOverlay gates it on
// `import.meta.dev`). Plain letters and numbers, no copy to translate.
import { DELAYS_MS, LOADING_VARIANTS, useSearchDev } from '~/composables/useSearchDev'

const dev = useSearchDev()
</script>

<template>
  <div
    class="bar-top pointer-events-none fixed inset-x-0 top-0 z-50 flex flex-col items-center gap-xs"
    data-testid="search.dev"
  >
    <div class="pointer-events-auto flex gap-xxs rounded-pill bg-surface-raised p-xxs edge">
      <button
        v-for="variant in LOADING_VARIANTS"
        :key="variant"
        type="button"
        class="figures size-ml rounded-pill text-meta"
        :class="dev.loading.value === variant ? 'bg-ink text-on-ink' : 'text-ink-muted'"
        :data-testid="`search.dev.loading.${variant}`"
        @pointerdown.prevent
        @click="dev.setLoading(variant)"
      >
        {{ variant }}
      </button>
      <span class="mx-xs my-xs w-(--stroke-hairline) bg-hairline-strong" aria-hidden="true" />
      <button
        v-for="ms in DELAYS_MS"
        :key="ms"
        type="button"
        class="figures h-ml min-w-ml rounded-pill px-xs text-meta"
        :class="dev.delay.value === ms ? 'bg-ink text-on-ink' : 'text-ink-muted'"
        :data-testid="`search.dev.delay.${ms}`"
        @pointerdown.prevent
        @click="dev.setDelay(ms)"
      >
        {{ ms / 1000 }}s
      </button>
    </div>
  </div>
</template>
