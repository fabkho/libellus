<script setup lang="ts">
// "Potential buddy reads" on a friend's profile: Books she and this friend could read together, a sideways row of covers, each a link to the Book's
// page (which carries the Read together action) with this friend already picked as invitee (`?with=`, utils/buddyPreselect.ts). Worked out here, on her phone, from what she may already see (utils/buddySuggestions.ts: her Library,
// her active buddy reads, and what this profile shows of the friend under the friend's switches), so it can never show more of the friend than the
// page does and asks the database for nothing new. Nothing is asked while the profile hides what it needs (no want-to-read, reading or finished
// list); a section with nothing to suggest is not drawn at all, no empty state. Each cover is named by its title and its reason ("On both your
// want-to-read lists"), and it is a list of links.
// Test ids: `member.buddy` (the section), `member.buddy.books` (the list), `member.buddy.book` (a link; `data-reason` says why).
import type { Book } from '~/data/books'
import type { MemberRecord } from '~/data/memberStats'
import type { MemberProfile, SocialBook } from '~/data/social'
import { useBuddyTogetherStore } from '~/stores/buddyTogether'
import { useBookStore } from '~/stores/book'
import { useLibraryStore } from '~/stores/library'
import { bookWith } from '~/utils/buddyPreselect'
import {
  friendShowsAnything,
  suggestBuddyReads,
  type FriendShown,
  type SuggestionBook,
  type SuggestionReason,
} from '~/utils/buddySuggestions'

const props = defineProps<{
  profile: Extract<MemberProfile, { visible: true }>
  /** Her whole Want to read once it was asked for (the profile carries the newest only); null: the profile's own. */
  want: { book: SocialBook }[] | null
  /** Her reading record (her finished and put-down Books), when her figures are shown and it has come. */
  record: MemberRecord | null
  /** What she is called here: her name, or a neutral word. */
  name: string
}>()

// Direct, as the profile's other covers: only the Library's row and the reel go through `/cover` (docs/plans/owned-covers.md §5).
const coverHosts = { ...useCoverHosts(), proxy: false }
const { t } = useI18n()
const library = useLibraryStore()
const together = useBuddyTogetherStore()
const books = useBookStore()
const headingId = useId()

const fromSocial = (book: SocialBook): SuggestionBook => book
const fromLibrary = (book: Book): SuggestionBook => ({
  id: book.id,
  title: book.title,
  authors: book.authors,
  year: book.year,
  coverUrl: book.coverUrl,
  coverThumbhash: book.coverThumbhash,
  coverColors: book.coverColors,
  coverKey: book.coverKey ?? null,
  coverWidths: book.coverWidths ?? null,
  manual: book.source === 'manual',
  unverified: Boolean(book.unverified),
})

/** What her profile shows of the friend: a list her switch hides is null and gives nothing. */
const friend = computed<FriendShown>(() => {
  const p = props.profile
  const done: { book: SuggestionBook; abandoned?: boolean }[] = p.finished.map((f) => ({ book: fromSocial(f.book) }))
  for (const read of props.record?.reads ?? []) if (read.outcome) done.push({ book: fromLibrary(read.book), abandoned: read.outcome === 'abandoned' })
  return {
    want: p.sections.want ? (props.want ?? p.want).map((w) => fromSocial(w.book)) : null,
    reading: p.sections.reading ? p.reading.map((r) => fromSocial(r.book)) : null,
    done: p.sections.finished ? done : null,
  }
})
/** Whether anything of hers is of use: when not, nothing is read or asked. Only a member she follows can be invited to a buddy read. */
const wanted = computed(() => props.profile.state === 'following' && friendShowsAnything(friend.value))

// Her own Library (the device's copy at once, read afresh when stale) and her buddy reads, read only when the profile shows something to compare.
function ask() {
  if (!wanted.value) return
  void library.load({ ifStale: true })
  void together.load()
}
onMounted(ask)
onActivated(ask)
watch(wanted, ask)

const items = computed(() => {
  if (!wanted.value || !library.loaded || !together.books) return []
  return suggestBuddyReads({
    mine: {
      want: library.wantToRead.map((e) => fromLibrary(e.book)),
      reading: library.reading.map((e) => fromLibrary(e.book)),
      finished: library.finished.map((e) => ({ book: fromLibrary(e.book), abandoned: e.latestSession?.outcome === 'abandoned' })),
    },
    friend: friend.value,
    together: together.books,
  })
})

function why(reason: SuggestionReason): string {
  const name = props.name
  switch (reason.kind) {
    case 'both_want':
      return t('member.buddy.bothWant')
    case 'you_reading':
      return t('member.buddy.youReading', { name })
    case 'they_reading':
      return t('member.buddy.theyReading', { name })
    case 'author_yours':
      return t('member.buddy.authorYours', { author: reason.author })
    case 'author_theirs':
      return t('member.buddy.authorTheirs', { name, author: reason.author })
  }
}

const rows = computed(() =>
  items.value.map(({ book, reason }) => ({
    book,
    reason: reason.kind,
    to: bookWith(book.id, props.profile.member.id),
    label: t('member.buddy.label', { title: book.title, reason: why(reason) }),
  })),
)
const shown = computed(() => rows.value.length > 0)
</script>

<template>
  <UiReveal :show="shown">
    <section class="flex flex-col gap-md pb-xl" :aria-labelledby="headingId" data-testid="member.buddy">
      <h2 :id="headingId" class="eyebrow">{{ t('member.buddy.title') }}</h2>
      <ul class="scrollbar-none -mx-screen flex snap-x scroll-px-screen gap-ms overflow-x-auto px-screen pt-xs pb-xxl -mb-xl" data-testid="member.buddy.books">
        <li v-for="row in rows" :key="row.book.id" class="w-(--size-cover-md) shrink-0 snap-start">
          <UiPressLink
            :to="row.to"
            class="cover-link block rounded-cover"
            :aria-label="row.label"
            :title="row.label"
            :data-reason="row.reason"
            data-testid="member.buddy.book"
            v-on="flightOf(row.to)"
            @press="books.prefetch(row.book.id, row.book)"
          >
            <UiCover
              decorative
              :title="row.book.title"
              :authors="[...row.book.authors]"
              v-bind="coverImage(row.book, 'md', coverHosts)"
              :thumbhash="row.book.coverThumbhash ?? null"
              :colors="row.book.coverColors ?? null"
              size="md"
            />
          </UiPressLink>
        </li>
      </ul>
    </section>
  </UiReveal>
</template>

<style scoped>
.cover-link:active {
  opacity: 0.8;
}
</style>
