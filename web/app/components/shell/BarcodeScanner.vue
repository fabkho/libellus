<script setup lang="ts">
// The barcode scanner (issue #92): a full-screen camera view opened from the
// search overlay's query row, only on browsers that can read an EAN-13 (Chrome
// on Android). It is always night, like a photo viewer: the stage and its
// controls take the dark tokens whatever the theme is (`data-theme="dark"`).
//
// The back camera fills the screen behind a framing guide; a book's barcode
// found inside (utils/barcode.ts: an ISBN-13, or an ISBN-10 converted) ticks the
// phone, and the scanner looks the ISBN up like a typed one (search store,
// `findByIsbn`): a Book found opens its page (`/book/<key>`), nothing found
// (or no connection, or no source answering) opens the search with the ISBN as
// the query, so the member can add it by hand.
//
// States: asking (the permission prompt is up) · scanning · denied (explains,
// and closes) · no camera. Offline the scan still works; it says the Library
// is all that can be searched. Closed by its ✕, Escape, the system Back
// (useBackDismiss.ts), a change of page, or the app going to the background —
// and then the camera is off: every track is stopped. Reduce Motion: the scan
// line holds still.
//
// With `pick` (a sheet's ISBN field: Change edition's "My edition isn't
// listed") the scanner only reads: the ISBN found goes to `pick` and the
// scanner closes, nothing is looked up. It is then a layer of its own over the
// sheet (useModalLayer.ts), and Escape closes only the scanner.
import { tick } from '~/utils/haptics'
import { useSearchStore } from '~/stores/search'

const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{ pick?: (isbn13: string) => void }>()

const { t } = useI18n()
const route = useRoute()
const search = useSearchStore()
const online = useOnline()

const video = useTemplateRef<HTMLVideoElement>('video')
const looking = ref<string | null>(null)
const notBook = ref(false)
let lookup: AbortController | null = null

function close() {
  lookup?.abort()
  lookup = null
  open.value = false
}
const stage = useTemplateRef<HTMLElement>('stage')
// Over a sheet it is a layer of its own (the sheet goes inert under it); over the search, part of the search's.
if (props.pick) useModalLayer(open, { elements: () => [stage.value], initialFocus: () => stage.value, close })
else useBackDismiss(() => open.value, close)

async function found(isbn13: string) {
  scanner.pause()
  tick()
  if (props.pick) {
    close()
    props.pick(isbn13)
    return
  }
  looking.value = isbn13
  lookup = new AbortController()
  const mine = lookup
  let hit: Awaited<ReturnType<typeof search.findByIsbn>> = null
  if (online.value) {
    try {
      hit = await search.findByIsbn(isbn13, mine.signal)
    } catch {
      hit = null
    }
  }
  if (mine.signal.aborted) return
  lookup = null
  close()
  if (hit) await navigateTo(`/book/${hit.key}`)
  else search.query = isbn13
}

const scanner = useBarcodeScanner({
  video: () => video.value,
  onIsbn: (isbn13) => void found(isbn13),
  onOther: () => (notBook.value = true),
})

watch(
  open,
  async (isOpen) => {
    if (!isOpen) {
      scanner.stop()
      looking.value = null
      notBook.value = false
      return
    }
    await nextTick()
    if (open.value) void scanner.start()
  },
  { immediate: true, flush: 'post' },
)

// A change of page, or the app out of sight, switches the camera off.
watch(() => route.fullPath, () => open.value && close())
function onVisibility() {
  if (document.visibilityState === 'hidden' && open.value) close()
}
function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !open.value) return
  // Over a sheet, Escape is the scanner's alone (it listens first, in the capture phase).
  if (props.pick) event.stopImmediatePropagation()
  close()
}
onMounted(() => {
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('keydown', onKeydown, Boolean(props.pick))
})
onUnmounted(() => {
  document.removeEventListener('visibilitychange', onVisibility)
  window.removeEventListener('keydown', onKeydown, Boolean(props.pick))
})

const blocked = computed(() => ['denied', 'none'].includes(scanner.state.value))
</script>

<template>
  <Teleport to="body" :disabled="!pick">
  <div
    v-if="open"
    ref="stage"
    tabindex="-1"
    data-theme="dark"
    role="dialog"
    aria-modal="true"
    :aria-label="t('search.scan.title')"
    class="stage fixed inset-0 z-80 flex flex-col overflow-hidden bg-surface-stage text-ink"
    data-testid="scan.overlay"
  >
    <video
      v-show="scanner.state.value === 'scanning'"
      ref="video"
      class="absolute inset-0 size-full object-cover"
      autoplay
      muted
      playsinline
      aria-hidden="true"
      data-testid="scan.video"
    />

    <header class="bar-top safe-x relative flex items-center justify-between px-screen">
      <UiRoundButton icon="close" :label="t('search.scan.close')" data-testid="scan.close" @click="close" />
      <span class="eyebrow text-ink-muted">{{ t('search.scan.title') }}</span>
      <UiRoundButton
        v-if="scanner.torchSupported.value"
        icon="torch"
        :label="scanner.torchOn.value ? t('search.scan.torchOff') : t('search.scan.torchOn')"
        :aria-pressed="scanner.torchOn.value"
        class="torch"
        :class="scanner.torchOn.value && 'text-accent!'"
        data-testid="scan.torch"
        @click="scanner.toggleTorch()"
      />
      <span v-else class="size-(--size-touch)" aria-hidden="true" />
    </header>

    <main class="safe-x relative flex flex-1 flex-col items-center justify-center gap-lg px-xl">
      <template v-if="scanner.state.value === 'scanning' || looking">
        <div class="frame relative aspect-3/2 w-full max-w-(--size-menu)" aria-hidden="true" data-testid="scan.frame">
          <span class="corner corner-tl" />
          <span class="corner corner-tr" />
          <span class="corner corner-bl" />
          <span class="corner corner-br" />
          <span v-if="!looking" class="line" />
        </div>
        <p
          v-if="looking"
          class="figures rounded-pill bg-scrim px-ms py-xs text-callout text-ink"
          role="status"
          data-testid="scan.looking"
        >
          {{ t('search.scan.looking', { isbn: looking }) }}
        </p>
        <p v-else-if="notBook" class="rounded-pill bg-scrim px-ms py-xs text-center text-caption text-ink" role="status" data-testid="scan.notBook">
          {{ t('search.scan.notBook') }}
        </p>
        <p v-else class="max-w-(--size-menu) rounded-pill bg-scrim px-ms py-xs text-center text-caption text-ink" data-testid="scan.hint">
          {{ t('search.scan.hint') }}
        </p>
      </template>

      <div v-else-if="scanner.state.value === 'asking'" class="flex flex-col items-center gap-sm text-center" data-testid="scan.asking">
        <UiIcon name="camera" :size="32" class="text-ink-muted" />
        <h2 class="text-headline">{{ t('search.scan.askingTitle') }}</h2>
        <p class="max-w-(--size-menu) text-body text-ink-muted">{{ t('search.scan.asking') }}</p>
      </div>

      <div v-else-if="blocked" class="flex flex-col items-center gap-ms text-center" data-testid="scan.blocked">
        <UiIcon name="slash" :size="32" class="text-ink-muted" />
        <h2 class="text-headline" :data-testid="scanner.state.value === 'denied' ? 'scan.denied' : 'scan.none'">
          {{ scanner.state.value === 'denied' ? t('search.scan.deniedTitle') : t('search.scan.noneTitle') }}
        </h2>
        <p class="max-w-(--size-menu) text-body text-ink-muted">
          {{ scanner.state.value === 'denied' ? t('search.scan.denied') : t('search.scan.none') }}
        </p>
        <UiButton tone="secondary" size="md" data-testid="scan.dismiss" @click="close">{{ t('search.scan.dismiss') }}</UiButton>
      </div>
    </main>

    <footer class="safe-bottom safe-x relative flex min-h-(--size-touch) items-start justify-center px-screen pb-lg">
      <p
        v-if="!online"
        class="flex items-center gap-xs rounded-pill bg-fill-strong px-ms py-xs text-caption text-ink-muted"
        data-testid="scan.offline"
      >
        <UiIcon name="offline" :size="14" />{{ t('search.scan.offline') }}
      </p>
    </footer>
  </div>
  </Teleport>
</template>

<style scoped>
/* A hairline dims everything outside the frame, not the frame itself. */
.frame {
  box-shadow: 0 0 0 100vmax var(--color-scrim);
  border-radius: var(--radius-md);
}

.corner {
  position: absolute;
  width: var(--spacing-xl);
  height: var(--spacing-xl);
  border: 0 solid var(--color-accent);
}
.corner-tl {
  top: 0;
  left: 0;
  border-top-width: var(--stroke-focus);
  border-left-width: var(--stroke-focus);
  border-top-left-radius: var(--radius-md);
}
.corner-tr {
  top: 0;
  right: 0;
  border-top-width: var(--stroke-focus);
  border-right-width: var(--stroke-focus);
  border-top-right-radius: var(--radius-md);
}
.corner-bl {
  bottom: 0;
  left: 0;
  border-bottom-width: var(--stroke-focus);
  border-left-width: var(--stroke-focus);
  border-bottom-left-radius: var(--radius-md);
}
.corner-br {
  right: 0;
  bottom: 0;
  border-bottom-width: var(--stroke-focus);
  border-right-width: var(--stroke-focus);
  border-bottom-right-radius: var(--radius-md);
}

/* The scan line sweeps the frame; with Reduce Motion it rests in the middle. */
.line {
  position: absolute;
  inset-inline: var(--spacing-ms);
  top: 50%;
  height: var(--stroke-rule);
  background: var(--color-accent);
  opacity: 0.7;
  animation: sweep calc(var(--duration-standard) * 9) var(--ease-standard) infinite alternate;
}
@keyframes sweep {
  from {
    top: 12%;
  }
  to {
    top: 88%;
  }
}
@media (prefers-reduced-motion: reduce) {
  .line {
    animation: none;
  }
}
</style>
