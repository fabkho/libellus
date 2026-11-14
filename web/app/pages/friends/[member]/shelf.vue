<script setup lang="ts">
// Her shelf (wave E, E2): the Books she has finished, as Regal's 3D Stack, built on the device from what
// her profile carries (data/memberShelf.ts `memberShelfFromFinished`) — a mirror of her year in review
// (this folder's `[year].vue`): the same pushed screen in the tab layout, the same top bar and Back
// (her own page when there is nowhere to go back to), the same store read — her profile, loaded each
// time the page shows, and read first when the address is opened straight (stores/memberProfile.ts) —
// and the same quiet notes for a member who is not there or whose profile could not be read.
//
// Where the year page shows a year, this one shows her shelf: the finished reads her profile carries,
// and nothing else of her Library, each Book's Spine in its cover's colour. The options are the
// Library's own Regal page's (stores/shelf.ts `buildDocument`): the device's zone for the days, the
// covers' hosts, and the page's origin, so our stored copies load. Her profile carries no blurb, so no
// `descriptionOf` is passed: a Book's back is drawn without one.
//
// Nothing finished (or her *Finished* switch off): a quiet line, no empty room. Regal's chunk could not
// be had (offline before it was ever fetched): a quiet word, no crash.
import { describeError, isChunkError } from '~/data/errorLog'
import { memberShelfFromFinished } from '~/data/memberShelf'
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
// Back online while the page is open: a profile it missed may be there now.
const online = useOnline()
watch(online, (now) => now && showing && void members.load(id.value))

// The covers' hosts and the page's origin, exactly as the Library's own shelf asks for them (stores/shelf.ts
// `buildDocument`): the hosts direct, our stored copies made absolute against the origin.
const covers = { ...useCoverHosts(), proxy: false }
const origin = useRequestURL().origin
/** Her profile's finished reads, newest first; her *Finished* switch off means the caller is shown none. */
const books = computed(() => (open.value?.sections.finished ? open.value.finished : []))
/** Her finished Books as her shelf's library document, built on the device and never fetched (null: nothing to draw). */
const library = computed(() =>
  books.value.length ? memberShelfFromFinished(books.value, { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', covers, origin }) : null,
)
const countText = computed(() => t('shelf.count', { count: count(books.value.length) }, books.value.length))

// The 3D has the document and is drawing it.
const ready = ref(false)
// Regal's chunk could not be had (offline before it was ever fetched): a quiet word instead of the 3D.
const noChunk = ref(false)
onErrorCaptured((error) => {
  if (!isChunkError(describeError(error).message)) return true
  noChunk.value = true
  return false
})

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
      <div class="safe-bottom relative min-h-0 flex-1" :aria-busy="!ready || undefined">
        <div class="relative h-full">
          <div v-if="!noChunk" class="lift absolute inset-x-0 bottom-0">
            <LazyShelfStage :library="library" :class="ready && 'ready'" data-testid="memberShelf.stage" @ready="ready = true" />
          </div>
          <p v-else class="absolute inset-0 flex items-center justify-center px-xl text-center text-subhead text-ink-muted" data-testid="memberShelf.noChunk">
            {{ t('shelf.noChunk') }}
          </p>
          <span v-if="!ready && !noChunk" class="sr-only" aria-live="polite" data-testid="memberShelf.loading">{{ t('shelf.loading') }}</span>
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
