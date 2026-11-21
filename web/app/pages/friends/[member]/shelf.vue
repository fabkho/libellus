<script setup lang="ts">
// Her shelf (wave E, E2): the Books she has finished, as Regal's 3D Stack, built on the device from her
// finished history (data/memberShelf.ts `memberShelfFromFinished`) — a mirror of her year in review
// (this folder's `[year].vue`): the same pushed screen in the tab layout, the same top bar and Back
// (her own page when there is nowhere to go back to), the same store read — her profile, loaded each
// time the page shows, and read first when the address is opened straight (stores/memberProfile.ts) —
// and the same quiet notes for a member who is not there or whose profile could not be read.
//
// Where the year page shows a year, this one shows her shelf: her whole finished history, and nothing else of
// her Library, each Book's Spine in its cover's colour. Her profile carries her newest twelve only (it answers
// every profile load, the ones opened from a feed card included, so it must not grow with her history): the
// first `SHELF_PAGE` rows are read here when the page shows (`stores/memberProfile.ts` `loadShelf`) and the
// pages behind them as the pile comes near the end of what is held (`loadMoreShelf`), so the Stack is hers in
// full while nothing about a profile's payload changed. The options are the
// Library's own Regal page's (stores/shelf.ts `buildDocument`): the device's zone for the days, the
// covers' hosts, and the page's origin, so our stored copies load. Her profile carries no blurb, so no
// `descriptionOf` is passed: a Book's back is drawn without one.
//
// Nothing finished (or her *Finished* switch off): a quiet line, no empty room. Regal's chunk could not
// be had (offline before it was ever fetched): a quiet word, no crash.
import { describeError, isChunkError } from '~/data/errorLog'
import { memberShelfFromFinished } from '~/data/memberShelf'
import { onIdle } from '~/utils/idle'
import { useMemberProfileStore } from '~/stores/memberProfile'

definePageMeta({
  layout: 'tabs',
  screen: 'memberShelf',
  pushed: true,
  // Her id and nothing else in the address. A build without Regal has no shelf to draw
  // (`appConfig.regal`, regal.config.ts): the address is then a page that doesn't exist, as `/profile/shelf`'s is.
  validate: (route) =>
    useAppConfig().regal === true && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(route.params.member)),
})

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const members = useMemberProfileStore()
const { count } = useFigures()

const id = computed(() => String(route.params.member))
const view = computed(() => members.viewOf(id.value))
const name = computed(() => view.value.profile?.member.name?.trim() || t('member.someone'))
/** Her profile as the caller may see it, or null (a private account she does not follow, nobody, not known yet). */
const open = computed(() => {
  const p = view.value.profile
  return p && p.visible ? p : null
})
/** Her finish is not for the caller: a dead link, a private account, or her *Finished* switch (the quiet state). */
const missing = computed(() => view.value.loaded && !open.value)

useHead({ title: () => `${t('member.shelfTitle', { name: name.value })} · ${t('app.name')}` })

// Loaded each time the page shows (opened afresh, or shown again from the router's cache of pages), as her
// year page does: her profile is what her shelf is built from.
let showing = false
function show() {
  if (showing) return
  showing = true
  void members.load(id.value)
}
onMounted(show)
onActivated(show)
onDeactivated(() => (showing = false))
watch(id, () => void members.load(id.value))
// Back online while the page is open: a profile it missed may be there now, and her history with it.
const online = useOnline()
watch(online, (now) => now && showing && void members.load(id.value))

// Her history, page by page: the first page once her profile says it is hers to show, kept for the session.
// `immediate`: opened from her profile the store holds her already, so her switch never *changes* here, and a
// watch that only fired on a change would never ask (the pile would stay her profile's twelve).
watch(
  () => open.value?.sections.finished,
  (finished) => finished && void members.loadShelf(id.value),
  { immediate: true },
)
/** Her whole history is held: nothing behind it to ask for (null is the end, or no page read yet). */
const ended = computed(() => !view.value.shelf.next)
/** A page of it is on its way (the first, or one behind it): the screen says it is busy, not stuck. */
const morePending = computed(() => view.value.shelf.more || view.value.shelf.loading)
/**
 * The pages behind the first, one per idle turn, so the Stack fills with her whole history without ever making
 * her wait for it: the first page is what she sees, and Regal's 3D windows what it draws (books/Meshes.vue
 * shares one geometry and loads faces on a per-frame budget), so appending is cheap.
 *
 * One tick, one page, and the next is queued only when that page came back: a member with 800 finished reads
 * costs eight requests on eight idle turns, never eight at once on a phone that is still opening the screen.
 * Leaving the page stops the chain where it stands (the store keeps what it read, so coming back to the Stack
 * continues from there).
 */
let cancelMore: (() => void) | null = null
let stopped = false
function pullMore() {
  cancelMore = null
  if (stopped || ended.value || morePending.value) return
  void members.loadMoreShelf(id.value).then(() => {
    if (!stopped && !ended.value) cancelMore = onIdle(pullMore)
  })
}
watch(morePending, (busy) => {
  // The first page landed (or a page behind it did): the next one waits for an idle turn.
  if (busy || stopped) return
  if (ended.value) return
  cancelMore?.()
  cancelMore = onIdle(pullMore)
})
onDeactivated(() => {
  stopped = true
  cancelMore?.()
  cancelMore = null
})

// The covers' hosts and the page's origin, exactly as the Library's own shelf asks for them (stores/shelf.ts
// `buildDocument`): the hosts direct, our stored copies made absolute against the origin.
const covers = { ...useCoverHosts(), proxy: false }
const origin = useRequestURL().origin
/**
 * Her finished reads, newest first: the whole history once it is read, and meanwhile the twelve her profile
 * carries (so the pile stands at once, before the first page has landed). Her *Finished* switch off means the
 * caller is shown none of it.
 */
const books = computed(() => {
  if (!open.value?.sections.finished) return []
  const shelf = view.value.shelf
  return shelf.items.length ? shelf.items : open.value.finished
})
/** How many Books the count says: her whole history's total, not the part that is drawn yet. */
const total = computed(() => view.value.shelf.total ?? books.value.length)
/** Her finished Books as her shelf's library document, built on the device and never fetched (null: nothing to draw). */
const library = computed(() =>
  books.value.length ? memberShelfFromFinished(books.value, { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', covers, origin }) : null,
)
const countText = computed(() => t('shelf.count', { count: count(total.value) }, total.value))

// The 3D has the document and is drawing it.
const ready = ref(false)
// Regal's chunk could not be had (offline before it was ever fetched): a quiet word instead of the 3D.
const noChunk = ref(false)
onErrorCaptured((error) => {
  if (!isChunkError(describeError(error).message)) return true
  noChunk.value = true
  return false
})

// A page of her history that could not be read, with the pile standing on the twelve her profile carries: said
// quietly above the Stack, and asked for again on a tap (never a screen without a way on).
const shelfFailed = computed(() => !!view.value.shelf.error && !ended.value)
function retryShelf() {
  void members.loadShelf(id.value, { again: true })
}

// Back to her page, where she came from (or to it, opened from an address), as her year page's Back.
function back() {
  if (canGoBack(window.history.state)) router.back()
  else void navigateTo(`/friends/${id.value}`)
}
</script>

<template>
  <div class="fixed inset-0 mx-auto flex max-w-(--size-max-content) flex-col overflow-hidden bg-surface text-ink" data-testid="memberShelf">
    <UiAmbient :colors="books[0]?.book.coverColors ?? null" />
    <UiTopBar :back-label="t('member.back')" back-testid="memberShelf.back" @back="back" />

    <FriendsNote v-if="missing" heading :title="t('follow.missingTitle')" data-testid="memberShelf.missing" />

    <!-- Her page came, her profile could not be read (offline, or it failed): not a dead link. -->
    <FriendsNote
      v-else-if="view.error && !view.loaded"
      heading
      :text="view.error === 'offline' ? t('member.offline') : t('member.loadError')"
      data-testid="memberShelf.loadError"
    >
      <UiButton v-if="view.error !== 'offline'" tone="secondary" size="md" data-testid="memberShelf.retry" @click="members.load(id)">{{ t('member.retry') }}</UiButton>
    </FriendsNote>

    <!-- Nothing finished, or her *Finished* switch is off: the quiet state, never an empty room. -->
    <FriendsNote v-else-if="!library" heading :text="t('member.shelfEmpty', { name })" data-testid="memberShelf.empty" />

    <template v-else>
      <section class="relative flex flex-col items-center px-xl pt-md text-center">
        <!-- The h1 carries her name too (hidden), so the page is named in full; the drawn eyebrow is not read twice. -->
        <p class="eyebrow" aria-hidden="true" data-testid="memberShelf.eyebrow">{{ t('member.shelfTitle', { name }) }}</p>
        <h1 class="title mt-sm" data-testid="memberShelf.title"><span class="sr-only">{{ t('member.shelfTitle', { name }) }}, </span>{{ t('member.shelf') }}</h1>
        <p class="figures mt-xs text-meta text-ink-muted" data-testid="memberShelf.count">{{ countText }}</p>
      </section>

      <!-- The Stack fills what is left of the phone, as the Library's own shelf has it (pages/profile/shelf.vue):
           its view reaches up behind the heading and the bar, so the pile fills the screen and a Book taken out
           stands clear of the bar. -->
      <div class="safe-bottom relative min-h-0 flex-1" :aria-busy="!ready || morePending || undefined">
        <div class="relative h-full">
          <div v-if="!noChunk" class="lift absolute inset-x-0 bottom-0">
            <LazyShelfStage :library="library" :class="ready && 'ready'" data-testid="memberShelf.stage" @ready="ready = true" />
          </div>
          <p v-else class="absolute inset-0 flex items-center justify-center px-xl text-center text-subhead text-ink-muted" data-testid="memberShelf.noChunk">
            {{ t('shelf.noChunk') }}
          </p>
          <span v-if="!ready && !noChunk" class="sr-only" aria-live="polite" data-testid="memberShelf.loading">{{ t('shelf.loading') }}</span>
          <!-- Part of her history could not be read: the pile stands on what is held, and says so (a tap asks again). -->
          <p v-if="shelfFailed" class="absolute inset-x-0 top-0 flex justify-center px-xl" data-testid="memberShelf.moreError">
            <UiButton tone="quiet" size="sm" :disabled="morePending" data-testid="memberShelf.moreRetry" @click="retryShelf">
              {{ view.shelf.error === 'offline' ? t('member.offline') : t('member.shelfMore', { name }) }}
            </UiButton>
          </p>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* Her shelf's name where the year page draws its year: the same large, light figure. */
.title {
  font-size: calc(var(--text-figure) * 2);
  line-height: 1;
  font-weight: var(--font-weight-light);
  letter-spacing: var(--text-figure--letter-spacing);
}
/* Regal starts with the top of the pile in the middle of its view. Its view reaches up behind the heading and the bar,
   so the pile starts above the middle and fills the rest, as on the Library's own shelf (pages/profile/shelf.vue). */
.lift {
  top: -20%;
}
</style>
