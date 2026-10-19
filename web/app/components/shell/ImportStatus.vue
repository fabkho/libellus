<script setup lang="ts">
// The import, from every other screen: a small pill above the tab bar (raised surface, `edge`, like the note after
// Find book linked a file) says what it is doing while it runs, "Looking up books · 120 of 340", "Waiting in
// line · 2 ahead", "Adding books …", the cover fill after the lookups, and "Import ready to check" once the preview waits; a
// thin bar along its foot shows how far it is. A tap goes back to the import page. When the books are written it says
// "Import done · 12 books added" for a few seconds (a tap opens the summary, the × clears it). Not on the import
// page itself, which shows all of this larger, nor while search has the bar's place. Closing the app pauses the
// import; stores/import.ts resumes it on the next start.
//
// For assistive tech: one polite status that names the phase (never the counts, which change every second), so
// a screen reader hears the import start, wait, add and finish once each. The pill itself is a link whose name
// is what it shows. With Reduce Motion it appears and goes without moving, and the bar does not slide.
import { useImportStore } from '~/stores/import'
import { ambientFraction, type ImportAmbient } from '~/utils/importProgress'
import { withoutSlash } from '~/utils/signedOutRoute'

/** How long "Import done" stays when nobody touches it. */
const DONE_MS = 12_000

const { t } = useI18n()
const route = useRoute()
const store = useImportStore()
const chrome = useSearchChrome()

const dismissed = ref(false)
let dismissTimer: ReturnType<typeof setTimeout> | null = null
watch(
  () => store.phase,
  (phase) => {
    if (dismissTimer) clearTimeout(dismissTimer)
    dismissTimer = null
    dismissed.value = false
    if (phase === 'done') dismissTimer = setTimeout(() => (dismissed.value = true), DONE_MS)
  },
)
onUnmounted(() => dismissTimer && clearTimeout(dismissTimer))

const onImportPage = computed(() => withoutSlash(route.path) === '/import')
const ambient = computed(() => store.ambient)
const shown = computed(() => Boolean(ambient.value) && !onImportPage.value && chrome.value === 'tabs' && !(ambient.value?.kind === 'done' && dismissed.value))
// Kept while it fades away.
const last = shallowRef<ImportAmbient | null>(null)
watch(ambient, (now) => now && (last.value = now), { immediate: true })

function words(now: ImportAmbient): string {
  switch (now.kind) {
    case 'queued':
      return t('import.ambient.queued', { count: now.ahead })
    case 'matching':
    case 'importing':
    case 'covers':
      return t(`import.ambient.${now.kind}`, { done: now.done, total: now.total })
    case 'done':
      return t('import.ambient.done', { count: now.added }, now.added)
    default:
      return t(`import.ambient.${now.kind}`)
  }
}
const label = computed(() => (last.value ? words(last.value) : ''))
const fraction = computed(() => (last.value ? ambientFraction(last.value) : null))
// Said once per phase: the kind, not the counts.
const said = computed(() => (shown.value && ambient.value ? t(`import.ambient.say.${ambient.value.kind}`) : ''))
</script>

<template>
  <div class="place pointer-events-none fixed inset-x-ms z-30 mx-auto flex max-w-(--size-max-content) justify-center">
    <span class="sr-only" role="status" data-testid="shell.import.say">{{ said }}</span>
    <Transition name="note">
      <div
        v-if="shown && last"
        class="pointer-events-auto relative flex min-h-(--size-button) max-w-full items-center overflow-hidden rounded-pill bg-surface-raised text-subhead shadow-raised edge"
        :data-kind="last.kind"
        data-testid="shell.import"
      >
        <NuxtLink to="/import" class="flex min-h-(--size-button) min-w-0 items-center gap-sm py-xs pr-md pl-md" data-testid="shell.import.open">
          <UiIcon :name="last.kind === 'done' ? 'check' : 'import'" :size="15" class="shrink-0 text-ink-faint" />
          <span class="min-w-0 truncate text-ink tabular-nums" data-testid="shell.import.label">{{ label }}</span>
        </NuxtLink>
        <button
          v-if="last.kind === 'done'"
          type="button"
          class="-ml-xs flex size-(--size-touch) shrink-0 items-center justify-center text-ink-faint"
          :aria-label="t('import.ambient.dismiss')"
          data-testid="shell.import.dismiss"
          @click="dismissed = true"
        >
          <UiIcon name="close" :size="14" />
        </button>
        <span v-if="fraction !== null" class="track absolute inset-x-0 bottom-0 bg-fill-strong" aria-hidden="true">
          <span class="fill block h-full bg-accent" :style="{ transform: `scaleX(${fraction})` }" />
        </span>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* Above the tab bar, where it floats (or would). */
.place {
  bottom: calc(var(--float-bottom) + var(--size-tab-bar) + var(--spacing-sm));
}

.track {
  height: var(--stroke-focus);
}

.fill {
  transform-origin: left center;
  transition: transform var(--duration-standard) var(--ease-standard);
}

.note-enter-active {
  transition:
    opacity var(--duration-standard) var(--ease-standard),
    translate var(--duration-standard) var(--ease-standard);
}
.note-leave-active {
  transition: opacity var(--duration-exit) var(--ease-exit);
}
.note-enter-from {
  opacity: 0;
  translate: 0 var(--spacing-sm);
}
.note-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .fill,
  .note-enter-active,
  .note-leave-active {
    transition: none;
  }
}
</style>
