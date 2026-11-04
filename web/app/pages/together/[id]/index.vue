<script setup lang="ts">
// A buddy read's room (docs/plans/buddy-read-shared.md part B, 3 and parts 5.4, 5.5; docs/parity.md, "Buddy read: the room"): one Book read
// by 2 to 12 members, lit by its cover. From the top: the hero (the cover, the Book, "with Anna, Ben and Lea"), the track (one bar, every
// member's avatar in her Section: nothing finer than a Section is ever shown), "Where are you?", then the threads as rows: "Before we
// start" (the room, always open), the Sections and "The whole book" last. A Section her marker has not reached is **veiled**: the row
// shows its number, the count and that it is hidden, never its title, the people in it or a new-message dot, and opening it asks
// first ("Show it anyway?", the answer is kept on this device as a peek, her Section does not move). The ⋯ has "Where are you?" and,
// for the host, Finish and Archive; Invite, Readers (Remove, Leave) are the setup work's sheets (components/together/{InviteSheet,MembersSheet}.vue, in the menu's slot).
//
// Behind the build's flag and her switch (utils/buddyRoute.ts, middleware/buddy-reads.ts): a build without buddy reads draws the app's 404
// and asks nothing. The screen `retain`s the store's live channel while it is open and lets it go when it closes; a change of a Section,
// a member or the status arrives live and the read is read again. Offline: what was read stays, writes say Offline.
import type { BuddyErrorCode } from '~/data/buddyReads'
import { isReadId, threadPath } from '~/utils/buddyRoute'
import { roomRows, titleSaysNumber, type RoomRow } from '~/utils/buddyRoom'
import { sectionTitle } from '~/utils/buddySectionTitle'
import { friendsNameParts } from '~/utils/friendsNames'
import { buddyErrorKey } from '~/utils/buddyRead'
import { useBuddyReadStore } from '~/stores/buddyRead'
import { useSessionStore } from '~/stores/session'

definePageMeta({
  layout: 'tabs',
  screen: 'together',
  pushed: true,
  // Runs in the app's entry, before this page's chunk loads: the build's flag and the address only.
  validate: (route) => useBuddyReadsFlag() && isReadId(route.params.id),
  middleware: 'buddy-reads',
})

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const store = useBuddyReadStore()
const session = useSessionStore()
const online = useOnline()
// Direct, as the other screens that draw a Book from a social answer (docs/plans/owned-covers.md §5).
const coverHosts = { ...useCoverHosts(), proxy: false }

const id = computed(() => String(route.params.id))
const me = computed(() => session.member?.id ?? null)
const read = computed(() => store.reads[id.value] ?? null)
const book = computed(() => (read.value ? shownBook(read.value.bookCard, t('book.outsideCatalogue')) : null))

useHead({ title: () => `${book.value?.title ?? t('together.title')} · ${t('app.name')}` })

// ------------------------------------------------------------------ loading

const error = ref<BuddyErrorCode | null>(null)
const loading = ref(true)
let release: (() => void) | null = null
let gone = false

async function load() {
  loading.value = true
  error.value = await store.load(id.value)
  loading.value = false
}

onMounted(async () => {
  // Never throws: a channel that cannot be had is `store.liveStuck`, and the store reads on its own meanwhile.
  const stop = await store.retain(id.value)
  // The screen closed while the channel was being asked for: let it go at once.
  if (gone) stop()
  else release = stop
})
onMounted(load)
onBeforeUnmount(() => {
  gone = true
  release?.()
})
watch(id, load)
// Back online with nothing to show, or the room may have changed while the device was away.
watch(online, (now) => now && void load())

// Gone for good: this screen's own answer was `not_found`, or the store forgot the read (a live refresh answers inside the store, not to
// the page, so the page's own `error` stays null: it was removed, or left on another device, while the room was open).
const missing = computed(() => !read.value && (error.value === 'not_found' || store.forgotten[id.value] === true))
const failed = computed(() => !read.value && !!error.value && error.value !== 'not_found')
// Entered with the keyboard, the focus would stay on <body>: it goes to the Book's title (or to what stands in its place).
useFocusHeading(() => !!read.value || missing.value || failed.value)

// ------------------------------------------------------------------ the rows

// A Section's name is the viewer's own words for what the host's setup wrote ("Section 3", "The whole book"): the host's language is not hers.
const sectionWords = { whole: () => t('together.wholeBook'), label: (n: string) => t('together.sectionLabel', { n }) }
const rows = computed(() => (read.value ? roomRows(read.value, (sectionId) => store.view(id.value, sectionId), (chapter) => sectionTitle(chapter, sectionWords)) : []))

/** The "with …" line: the others, by name. */
const withNames = computed(() => {
  const others = (read.value?.members ?? []).filter((m) => m.id !== me.value).map((m) => m.name?.trim() || t('member.someone'))
  if (!others.length) return null
  const names = friendsNameParts(others.slice(0, 3), Math.max(0, others.length - 3))
  return t('together.with', { names: t(`social.friends.names.${names.key}`, names.args, names.count) })
})

/**
 * What the row's number is called aloud. The row's name must begin with what is drawn (WCAG 2.5.3, Label in Name: the base's
 * `UiThreadRow` builds it as label, title, count, "hidden"), so a numbered row's label ends with its number: "Section 9". A veiled
 * Section is only ever "Section n" (its own title can spoil); an open one whose title already says its number ("Section 9",
 * "Abschnitt 9") is named by the number alone, so it is not said twice; the room has no number.
 */
function rowLabel(row: RoomRow): string | undefined {
  if (row.kind === 'room') return ''
  if (row.veiled) return t('together.sectionLabel', { n: row.number })
  return titleSaysNumber(row.title, row.number) ? undefined : t('together.sectionLabel', { n: row.number })
}
const rowTitle = (row: RoomRow) => (row.kind === 'room' ? t('together.room') : row.title)
const facesLabel = (row: RoomRow) =>
  row.faces.length ? t('together.hereNow', { names: row.faces.map((f) => f.name?.trim() || t('member.someone')).join(t('common.listSeparator')) }) : undefined
const faceOf = (face: RoomRow['faces'][number]) => ({ initials: initialsOf('', face.name?.trim() || t('member.someone')), photo: null, label: face.name?.trim() || t('member.someone') })

const asking = ref<RoomRow | null>(null)
const confirmOpen = ref(false)
function openRow(row: RoomRow) {
  if (row.veiled) {
    asking.value = row
    confirmOpen.value = true
    return
  }
  void navigateTo(threadPath(id.value, row.id))
}
function showAnyway() {
  const row = asking.value
  if (!row?.id) return
  store.peek(row.id)
  void navigateTo(threadPath(id.value, row.id))
}

// ------------------------------------------------------------------ the sheets

const menuOpen = ref(false)
const markerOpen = ref(false)
const inviteOpen = ref(false)
const membersOpen = ref(false)
const said = ref('')
function done(what: 'finished' | 'archived') {
  said.value = t(`together.${what === 'finished' ? 'finish' : 'archive'}.done`)
}

/** She left the read (the members sheet): the room is gone for her, so Home. */
function leftTheRead() {
  void navigateTo('/', { replace: true })
}

function back() {
  if (window.history.state?.back) router.back()
  else void navigateTo('/')
}

/** The status line under the Book: finished or archived, with the day. */
const statusLine = computed(() => {
  const r = read.value
  if (!r || r.status === 'active') return null
  const at = r.status === 'archived' ? (r.archivedAt ?? r.finishedAt) : r.finishedAt
  const day = at ? new Intl.DateTimeFormat(locale.value, { day: 'numeric', month: 'short' }).format(new Date(at)) : ''
  return t(`together.status.${r.status}`, { date: day })
})
const alone = computed(() => read.value?.status === 'active' && (read.value.members.length ?? 0) <= 1)
</script>

<template>
  <div class="relative min-h-dvh pb-xl" data-testid="together">
    <UiAmbient :colors="book?.coverColors ?? null" />
    <UiTopBar :back-label="t('together.back')" back-testid="together.back" @back="back">
      <template v-if="read" #trailing>
        <UiRoundButton icon="more" :label="t('together.menu.label')" data-testid="together.more" @click="menuOpen = true" />
      </template>
    </UiTopBar>

    <p class="sr-only" role="status" data-testid="together.status">{{ said }}</p>

    <!-- She is not in it (any more), or there is no such read: one answer for both. -->
    <FriendsNote v-if="missing" heading :title="t('together.missingTitle')" :text="t('together.missingText')" data-testid="together.missing">
      <UiButton tone="secondary" size="md" data-testid="together.missingHome" @click="navigateTo('/')">{{ t('together.home') }}</UiButton>
    </FriendsNote>

    <FriendsNote v-else-if="failed" heading :text="error === 'offline' ? t('together.offline') : t(buddyErrorKey(error!))" data-testid="together.loadError">
      <UiButton v-if="error !== 'offline'" tone="secondary" size="md" data-testid="together.retry" @click="load">{{ t('together.retry') }}</UiButton>
    </FriendsNote>

    <!-- The first answer on its way: the hero's place is held, nothing moves when it comes. -->
    <section v-else-if="!read" class="relative flex flex-col items-center px-xl pt-sm" aria-busy="true" aria-hidden="true">
      <span class="skeleton wave cover-hold rounded-cover" />
      <span class="line mt-ml w-2/3"><span class="skeleton wave w-full" :style="{ '--wave': 0.05 }" /></span>
    </section>

    <template v-else>
      <section class="relative flex flex-col items-center px-xl pt-sm text-center" data-testid="together.hero">
        <UiCover
          v-if="book"
          decorative
          :title="book.title"
          :authors="book.authors"
          v-bind="coverImage(book, 'md', coverHosts)"
          :thumbhash="book.coverThumbhash"
          :colors="book.coverColors"
          size="md"
          glow
          eager
        />
        <h1 class="book-title mt-ml max-w-full text-headline text-balance wrap-anywhere" data-testid="together.title">{{ book?.title }}</h1>
        <p v-if="book?.authors.length" class="mt-xs max-w-full text-subhead text-ink-muted wrap-anywhere">{{ book.authors.join(t('common.listSeparator')) }}</p>
        <p v-if="withNames" class="mt-sm max-w-full text-subhead text-ink-muted wrap-anywhere" data-testid="together.with">{{ withNames }}</p>
        <p v-if="statusLine" class="eyebrow mt-sm" data-testid="together.statusLine">{{ statusLine }}</p>
      </section>

      <div class="relative flex flex-col gap-lg px-screen pt-lg">
        <p v-if="alone" class="text-center text-subhead text-ink-muted" data-testid="together.alone">{{ t('together.alone') }}</p>

        <TogetherTrack :read="read" :me="me" @marker="markerOpen = true" />

        <section aria-labelledby="together-sections">
          <h2 id="together-sections" class="eyebrow mb-sm px-inset">{{ t('together.sectionsTitle') }}</h2>
          <UiRowGroup>
            <ul data-testid="together.rows">
              <li v-for="row in rows" :key="row.segment" class="border-hairline not-first:border-t">
                <UiThreadRow
                  :number="row.number"
                  :label="rowLabel(row)"
                  :title="rowTitle(row)"
                  :count="row.count"
                  :unread="row.unread"
                  :veiled="row.veiled"
                  :faces="row.faces.map(faceOf)"
                  :faces-label="facesLabel(row)"
                  :testid="row.kind === 'room' ? 'together.room' : 'together.section'"
                  @open="openRow(row)"
                />
              </li>
            </ul>
          </UiRowGroup>
          <p class="mt-sm px-inset text-footnote text-ink-faint">{{ t('together.veilHint') }}</p>
        </section>
      </div>

      <TogetherMarkerSheet v-model:open="markerOpen" :read="read" />
      <TogetherRoomMenu v-model:open="menuOpen" :read="read" @marker="markerOpen = true" @done="done">
        <!-- Who is in, who may be invited, and the way out (W3: the members, invite and leave sheets). -->
        <template #members>
          <UiRowGroup>
            <UiRow
              v-if="read.canManage && read.status === 'active'"
              as="button"
              icon="link"
              :label="t('together.menu.invite')"
              data-testid="together.menu.invite"
              @click="(menuOpen = false), (inviteOpen = true)"
            />
            <UiRow as="button" icon="people" :label="t('together.menu.members')" data-testid="together.menu.members" @click="(menuOpen = false), (membersOpen = true)" />
          </UiRowGroup>
        </template>
      </TogetherRoomMenu>

    </template>

    <!-- Outside the read's own branch: leaving forgets the read, and the sheet must still be there to tell the page (`left`). -->
    <TogetherInviteSheet v-model:open="inviteOpen" :read-id="id" />
    <TogetherMembersSheet v-model:open="membersOpen" :read-id="id" @left="leftTheRead" />

    <TogetherShowAnyway v-model:open="confirmOpen" :number="asking?.number ?? ''" :end="asking?.kind === 'end'" @show="showAnyway" />
  </div>
</template>

<style scoped>
.cover-hold {
  width: var(--size-cover-md);
  aspect-ratio: 2 / 3;
}
.line {
  display: block;
  height: var(--spacing-ml);
}
</style>
