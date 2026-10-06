<script setup lang="ts">
// Design round #131 phase 2: the built-in reader. A stand-in for the book page
// (cover, title, Read now as the primary action, as the owner decided) and,
// under it, the round's switches. Read now opens the reader prototype picked
// here: a Quiet pages, b Scroll, c Printed page. Dev only
// (modules/reader-proto.ts); nothing here talks to Supabase: the Book, its
// status and its saved page are this page's state.
import { describeCover, loadPixelsInBrowser } from '~/data/covers'
import type { CoverColors } from '~/utils/cover'
import peterEpub from './books/peter-rabbit.epub?url'
import peterCover from './books/peter-rabbit.jpg?url'
import kafkaEpub from './books/metamorphosis.epub?url'
import kafkaCover from './books/metamorphosis.jpg?url'
import Reader from './Reader.vue'
import ProtoIcon from './ProtoIcon.vue'
import './themes.css'

definePageMeta({ layout: false })
useHead({ title: 'Reader · Design round' })

type Variant = 'a' | 'b' | 'c'
type MenuDesign = 'bubble' | 'dock' | 'peek'
type BookKey = 'peter' | 'kafka' | 'file'
type Status = 'want_to_read' | 'reading'

const VARIANTS: { key: Variant; name: string; pitch: string }[] = [
  { key: 'a', name: 'Quiet pages', pitch: 'Pages, nothing on them but the text. Tap the edges or swipe to turn; tap the middle for a slim top and bottom bar.' },
  { key: 'c', name: 'Printed page', pitch: 'A printed book: running head and folio in the margins, two pages side by side on a wide screen, a calm fade to turn. Tap the middle for a small capsule.' },
]
const MENUS: { key: MenuDesign; name: string; pitch: string }[] = [
  { key: 'bubble', name: 'Bubble', pitch: 'An ink card by the words, under them on a phone (Android puts its own Copy bar above).' },
  { key: 'dock', name: 'Dock', pitch: 'The same actions in a glass bar at the bottom edge: never on the words, always under the thumb.' },
  { key: 'peek', name: 'Peek', pitch: 'A low panel that already shows the answer (a word’s meaning, a phrase’s translation), the actions under it.' },
]

const BOOKS = {
  peter: { title: 'The Tale of Peter Rabbit', authors: ['Beatrix Potter'], year: 1902, pages: 72, epub: peterEpub, cover: peterCover, file: 'peter-rabbit.epub' },
  kafka: { title: 'Metamorphosis', authors: ['Franz Kafka'], year: 1915, pages: 96, epub: kafkaEpub, cover: kafkaCover, file: 'metamorphosis.epub' },
} as const

const route = useRoute()
const router = useRouter()
const q = (name: string) => (typeof route.query[name] === 'string' ? (route.query[name] as string) : null)

const variant = ref<Variant>((['a', 'b', 'c'] as const).find((v) => v === q('v')) ?? 'a')
const bookKey = ref<BookKey>(q('book') === 'kafka' ? 'kafka' : 'peter')
const status = ref<Status>(q('status') === 'want' ? 'want_to_read' : 'reading')
const savedPage = ref(Number(q('saved') ?? (status.value === 'reading' ? 0 : 0)) || 0)
const quickWrites = ref(q('writes') !== 'spec')
const menu = ref<MenuDesign>((['bubble', 'dock', 'peek'] as const).find((m) => m === q('menu')) ?? 'bubble')
const reduceMotion = ref(q('motion') === 'reduce' ? true : null as boolean | null)
const appTheme = ref<'light' | 'dark' | null>(q('app') === 'dark' ? 'dark' : q('app') === 'light' ? 'light' : null)

// Keep the address in step, so a reload (or a link sent to the phone) opens the same set-up.
watch([variant, bookKey, status, menu], () => {
  // The address only, quietly: a router navigation would close the reader and its sheets (useBackDismiss).
  const url = new URL(window.location.href)
  url.searchParams.set('v', variant.value)
  url.searchParams.set('menu', menu.value)
  url.searchParams.set('status', status.value === 'want_to_read' ? 'want' : 'reading')
  if (bookKey.value === 'file') url.searchParams.delete('book')
  else url.searchParams.set('book', bookKey.value)
  window.history.replaceState(window.history.state, '', url)
})
watch(
  appTheme,
  (theme) => {
    if (theme) document.documentElement.dataset.theme = theme
    else delete document.documentElement.dataset.theme
  },
  { immediate: true },
)

// The member's own file (Open an EPUB…): read in place, nothing kept.
const picked = shallowRef<File | null>(null)
const pickedMeta = ref<{ title: string; authors: string[]; cover: string | null } | null>(null)
const fileInput = useTemplateRef<HTMLInputElement>('fileInput')
function onPick(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  picked.value = file
  pickedMeta.value = { title: file.name.replace(/\.epub$/i, ''), authors: [], cover: null }
  bookKey.value = 'file'
  savedPage.value = 0
}

const book = computed(() => {
  if (bookKey.value === 'file' && pickedMeta.value) {
    return { title: pickedMeta.value.title, authors: pickedMeta.value.authors, year: null, pages: 300, cover: pickedMeta.value.cover, file: picked.value?.name ?? 'book.epub', epub: null }
  }
  const b = BOOKS[bookKey.value === 'file' ? 'peter' : bookKey.value]
  return { ...b, authors: [...b.authors] }
})

// The cover's light and its thumbhash, worked out from the image as the app does when a Book is added.
const coverColors = ref<CoverColors | null>(null)
const thumbhash = ref<string | null>(null)
watch(
  () => book.value.cover,
  async (src) => {
    coverColors.value = null
    thumbhash.value = null
    if (!src) return
    try {
      const described = describeCover(await loadPixelsInBrowser(src))
      coverColors.value = described.colors
      thumbhash.value = described.thumbhash
    } catch {
      // No light then: the page stays neutral.
    }
  },
  { immediate: true },
)

const fraction = computed(() => Math.min(1, savedPage.value / book.value.pages))
const heroCover = useTemplateRef<HTMLElement>('heroCover')

// The reader is a layer over this page here; in production it is its own route (/book/:key/read).
const reading = ref(false)
const file = shallowRef<File | null>(null)
const opening = ref(false)
async function openReader() {
  if (reading.value || opening.value) return
  opening.value = true
  try {
    if (bookKey.value === 'file' && picked.value) file.value = picked.value
    else {
      const b = BOOKS[bookKey.value === 'file' ? 'peter' : bookKey.value]
      const blob = await (await fetch(b.epub)).blob()
      file.value = new File([blob], b.file, { type: 'application/epub+zip' })
    }
    reading.value = true
  } finally {
    opening.value = false
  }
}
function onClosed() {
  reading.value = false
}
function onCover(cover: string | null, title: string, author: string) {
  if (bookKey.value !== 'file' || !pickedMeta.value) return
  pickedMeta.value = { title: title || pickedMeta.value.title, authors: author ? [author] : [], cover }
}

const lastSave = ref<string | null>(null)
function onProgress(page: number, why: string) {
  savedPage.value = page
  lastSave.value = `p. ${page} (${why})`
}
function onStart() {
  status.value = 'reading'
}
const finished = ref(false)
function onFinish() {
  finished.value = true
  savedPage.value = book.value.pages
}

const wake = ref('off')
const openTimings = ref<string | null>(null)

// Screenshots and links: `?open=1` opens the reader straight away.
onMounted(() => {
  if (q('open') === '1') void openReader()
})
</script>

<template>
  <div class="relative min-h-dvh overflow-x-hidden bg-surface text-ink">
    <div class="safe-x relative mx-auto w-full max-w-(--size-max-content)">
      <UiAmbient :colors="coverColors" />
      <UiTopBar back-label="Back" back-testid="proto.back" @back="() => {}">
        <template #trailing>
          <UiRoundButton icon="more" label="Options" />
        </template>
      </UiTopBar>

      <section class="relative flex flex-col items-center px-xl pt-sm text-center">
        <div ref="heroCover">
          <UiCover :key="book.cover ?? book.title" :title="book.title" :authors="book.authors" :src="book.cover" :thumbhash="thumbhash" :colors="coverColors" size="xl" glow eager />
        </div>
        <h1 class="book-title mt-ml max-w-full text-headline text-balance">{{ book.title }}</h1>
        <p class="mt-xs text-body text-ink-muted">{{ book.authors.join(', ') || '—' }}</p>
        <p class="eyebrow mt-sm flex items-center gap-sm">
          <template v-if="book.year">{{ book.year }}<span class="dot" aria-hidden="true" /></template>{{ book.pages }} pages
        </p>
      </section>

      <div class="relative px-ml">
        <p class="mt-ms mb-md flex flex-wrap items-center justify-center gap-sm text-caption">
          <span v-if="status === 'reading' && !finished" class="lamp" aria-hidden="true" />
          <UiIcon v-if="finished" name="check" :size="14" class="text-ink-faint" />
          <span>{{ finished ? 'Finished' : status === 'reading' ? 'Currently reading' : 'Want to read' }}</span>
          <span class="dot text-ink-ghost" aria-hidden="true" />
          <span class="figures text-meta text-ink-faint">{{ status === 'reading' ? 'since 2 Oct' : 'added 28 Sep' }}</span>
        </p>

        <div v-if="status === 'reading'" class="mb-ml">
          <UiProgress :fraction="fraction" label="Progress" :value-text="`p. ${savedPage} of ${book.pages}`" />
          <p class="mt-sm flex items-center justify-between">
            <span class="figures text-meta text-ink-muted">p. {{ savedPage }} of {{ book.pages }}</span>
            <span class="figures text-meta text-ink-faint">{{ Math.round(fraction * 100) }} %</span>
          </p>
        </div>

        <!-- Owner decision: with a linked ebook, Read now is the one lit action; the rest steps back. -->
        <UiButton block :disabled="opening" data-testid="book.read" @click="openReader">
          <ProtoIcon name="read" :size="19" />Read now
        </UiButton>
        <div class="mt-ms flex gap-ms">
          <UiButton v-if="status === 'reading'" class="flex-1" tone="secondary" size="md">Update progress</UiButton>
          <UiButton v-if="status === 'reading'" class="flex-1" tone="quiet" size="md">Finish</UiButton>
          <UiButton v-else class="flex-1" tone="secondary" size="md" @click="status = 'reading'">Start reading</UiButton>
        </div>
        <p class="mt-ms flex items-center justify-center gap-xs text-caption text-ink-faint">
          <ProtoIcon name="read" :size="14" />Ebook · on this device
        </p>
      </div>

      <!-- The round's switches: not part of the design. -->
      <section class="relative mx-ml mt-xxl mb-xxl rounded-lg bg-fill p-inset edge-faint" data-testid="proto.panel">
        <h2 class="eyebrow mb-ms">Design round · reader (#131)</h2>
        <div class="grid gap-xs">
          <button
            v-for="v in VARIANTS"
            :key="v.key"
            type="button"
            class="rounded-md px-ms py-sm text-left"
            :class="variant === v.key ? 'bg-surface-raised shadow-raised' : 'hover:bg-fill'"
            :data-testid="`proto.variant.${v.key}`"
            @click="variant = v.key"
          >
            <span class="flex items-center gap-sm text-body font-medium">
              <span class="figures text-meta text-ink-faint">{{ v.key }}</span>{{ v.name }}
              <span v-if="variant === v.key" class="lamp ml-auto" aria-hidden="true" />
            </span>
            <span class="mt-xxs block text-caption text-ink-muted">{{ v.pitch }}</span>
          </button>
        </div>

        <p class="mt-xs px-ms text-caption text-ink-faint">
          Scroll (b) is now a setting of both: Aa → Pages / Scroll.<template v-if="variant === 'b'"> This link opens b directly.</template>
        </p>

        <h3 class="eyebrow mt-md mb-xs">Select words: menu</h3>
        <div class="grid gap-xs">
          <button
            v-for="m in MENUS"
            :key="m.key"
            type="button"
            class="rounded-md px-ms py-sm text-left"
            :class="menu === m.key ? 'bg-surface-raised shadow-raised' : 'hover:bg-fill'"
            :data-testid="`proto.menu.${m.key}`"
            @click="menu = m.key"
          >
            <span class="flex items-center gap-sm text-body font-medium">
              {{ m.name }}
              <span v-if="menu === m.key" class="lamp ml-auto" aria-hidden="true" />
            </span>
            <span class="mt-xxs block text-caption text-ink-muted">{{ m.pitch }}</span>
          </button>
        </div>

        <div class="mt-md grid grid-cols-[auto_1fr] items-center gap-x-md gap-y-sm text-caption">
          <span class="text-ink-faint">Book</span>
          <span class="flex flex-wrap gap-xs">
            <button type="button" class="chip" :class="bookKey === 'peter' && 'on'" @click="bookKey = 'peter'">Peter Rabbit</button>
            <button type="button" class="chip" :class="bookKey === 'kafka' && 'on'" @click="bookKey = 'kafka'">Metamorphosis</button>
            <button type="button" class="chip" :class="bookKey === 'file' && 'on'" data-testid="proto.pick" @click="fileInput?.click()">Your EPUB…</button>
            <input ref="fileInput" type="file" accept=".epub,application/epub+zip" class="sr-only" data-testid="proto.file" @change="onPick" />
          </span>
          <span class="text-ink-faint">Status</span>
          <span class="flex gap-xs">
            <button type="button" class="chip" :class="status === 'want_to_read' && 'on'" @click="(status = 'want_to_read'), (finished = false)">Want to read</button>
            <button type="button" class="chip" :class="status === 'reading' && 'on'" @click="status = 'reading'">Reading</button>
          </span>
          <span class="text-ink-faint">Saved</span>
          <span class="flex items-center gap-xs">
            <span class="figures text-meta">p. {{ savedPage }}</span>
            <button type="button" class="chip" @click="(savedPage = 0), (finished = false)">Reset</button>
          </span>
          <span class="text-ink-faint">Writes</span>
          <span class="flex gap-xs">
            <button type="button" class="chip" :class="quickWrites && 'on'" @click="quickWrites = true">Quick (2.5 s)</button>
            <button type="button" class="chip" :class="!quickWrites && 'on'" @click="quickWrites = false">Spec (10 s, 1/min)</button>
          </span>
          <span class="text-ink-faint">Motion</span>
          <span class="flex gap-xs">
            <button type="button" class="chip" :class="reduceMotion === null && 'on'" @click="reduceMotion = null">System</button>
            <button type="button" class="chip" :class="reduceMotion === true && 'on'" @click="reduceMotion = true">Reduced</button>
          </span>
          <span class="text-ink-faint">App</span>
          <span class="flex gap-xs">
            <button type="button" class="chip" :class="appTheme === null && 'on'" @click="appTheme = null">Phone</button>
            <button type="button" class="chip" :class="appTheme === 'light' && 'on'" @click="appTheme = 'light'">Light</button>
            <button type="button" class="chip" :class="appTheme === 'dark' && 'on'" @click="appTheme = 'dark'">Dark</button>
          </span>
        </div>
        <p class="figures mt-md text-meta text-ink-faint">
          Last write: {{ lastSave ?? '—' }} · wake lock: {{ wake }}<br />
          Last open: {{ openTimings ?? '—' }}
        </p>
      </section>
    </div>

    <Reader
      v-if="reading && file"
      :variant="variant"
      :file="file"
      :book="{ title: book.title, authors: book.authors, cover: book.cover, pages: book.pages, colors: coverColors, thumbhash }"
      :status="status"
      :saved-page="savedPage"
      :hero="heroCover"
      :quick-writes="quickWrites"
      :menu="menu"
      :reduce-motion="reduceMotion"
      :initial="{ theme: q('theme'), flow: q('flow'), margins: q('margins'), leading: q('leading'), size: q('size'), chrome: q('chrome') === '1', sheet: q('sheet'), at: q('at') ? Number(q('at')) : null, flight: q('flight') !== '0' }"
      @closed="onClosed"
      @progress="onProgress"
      @start="onStart"
      @finish="onFinish"
      @cover="onCover"
      @wake="wake = $event"
      @timings="openTimings = $event"
      @menu="menu = $event"
    />
  </div>
</template>

<style scoped>
.dot {
  width: var(--spacing-xxs);
  height: var(--spacing-xxs);
  border-radius: var(--radius-pill);
  background: currentColor;
}
.lamp {
  width: var(--spacing-sm);
  height: var(--spacing-sm);
  border-radius: var(--radius-pill);
  background: var(--color-accent);
  box-shadow: 0 0 var(--spacing-ms) var(--spacing-xxs) color-mix(in srgb, var(--color-accent) 50%, transparent);
}
.chip {
  min-height: var(--size-button-sm);
  padding: 0 var(--spacing-ms);
  border-radius: var(--radius-pill);
  background: var(--color-fill);
  color: var(--color-ink-muted);
}
.chip.on {
  background: var(--color-ink);
  color: var(--color-on-ink);
}
</style>
