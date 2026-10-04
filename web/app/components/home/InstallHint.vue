<script setup lang="ts">
// The install hint on Home (issue #94): iOS has no install prompt, so in
// Safari on an iPhone or iPad, until Libellus is on the Home Screen, a quiet
// card says how — a line, and a tiny drawing of what Safari shows: the Share
// button, then its "Add to Home Screen" row. Its × hides it for a week
// (utils/installHint.ts has the rules); installed, it is gone for good. The
// drawing is plain strokes in the text colours, so it follows both themes.
const { t } = useI18n()
const hint = useInstallHint()

onMounted(hint.refresh)
onActivated(hint.refresh)
</script>

<template>
  <section
    v-if="hint.visible.value"
    class="flex items-start gap-ms rounded-md bg-fill py-ms pr-xs pl-inset edge-faint"
    :aria-label="t('home.installHint.title')"
    data-testid="home.installHint"
  >
    <div class="flex min-w-0 flex-1 flex-col gap-ms py-xs">
      <div class="flex flex-col gap-xxs">
        <h2 class="text-body text-ink" data-testid="home.installHintTitle">{{ t('home.installHint.title') }}</h2>
        <p class="text-subhead text-ink-muted" data-testid="home.installHintText">{{ t('home.installHint.text') }}</p>
      </div>

      <!-- What Safari shows, drawn small: the Share button, then its menu row. -->
      <div class="flex items-center gap-ms text-ink-muted" aria-hidden="true" data-testid="home.installHintArt">
        <span class="flex size-(--size-button-md) shrink-0 items-center justify-center rounded-pill edge">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" class="share" style="stroke-width: var(--stroke-icon)">
            <path d="M12 14.5V4M8.5 7.5 12 4l3.5 3.5" />
            <path d="M8.5 10.5H7.5a1.5 1.5 0 0 0-1.5 1.5v6.5A1.5 1.5 0 0 0 7.5 20h9a1.5 1.5 0 0 0 1.5-1.5V12a1.5 1.5 0 0 0-1.5-1.5h-1" />
          </svg>
        </span>
        <UiIcon name="chevron" :size="16" class="text-ink-ghost" />
        <span class="flex h-(--size-button-md) min-w-0 items-center gap-sm rounded-pill px-md text-caption text-ink edge">
          <span class="truncate">{{ t('home.installHint.addToHome') }}</span>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" class="shrink-0" style="stroke-width: var(--stroke-icon)">
            <rect x="4.5" y="4.5" width="15" height="15" rx="3" />
            <path d="M12 8.5v7M8.5 12h7" />
          </svg>
        </span>
      </div>
    </div>

    <button
      type="button"
      :aria-label="t('home.installHint.dismiss')"
      class="flex size-(--size-touch) shrink-0 items-center justify-center text-ink-faint active:text-ink"
      data-testid="home.installHintDismiss"
      @click="hint.dismiss"
    >
      <UiIcon name="close" :size="18" />
    </button>
  </section>
</template>
