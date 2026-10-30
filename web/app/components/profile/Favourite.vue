<script setup lang="ts">
// The favourites of a year in review (backlog #25): `reads` are the year's five-star Books, newest first
// (`YearFigures.favourites`; with none, the top-rated read alone). One read is the favourite's card, lit by
// its cover; several are a sideways row of covers (the reading page's `ReadingCoverRow`, no card around it),
// each opening its Book with the cover flying in, the page's light still the first cover's; its title is
// yours, or hers by name (`name`). One component for the Profile's own year page and for a member's
// (social v1, U4): `foreign` is the member's, where a Manual book is hers alone and opens nothing (as in
// MonthBooks); `testid` names the card, its title is `<testid>Title`, the row `<testid>s`. With `reads`
// null, the placeholders hold its place in the loading wave (docs/MOTION.md, Loading); with none, nothing.
// Attributes (`id`, `class`) land on the card or the row, not on the placeholders.
import type { StatsRead } from '~/data/stats'
import { useBookStore } from '~/stores/book'
import { bookPathOf } from '~/utils/memberProfile'

const coverHosts = useCoverHosts() // our stored copies and `/cover`, as this build has them (utils/coverRef.ts)

defineOptions({ inheritAttrs: false })
const props = withDefaults(defineProps<{ reads: readonly StatsRead[] | null; foreign?: boolean; name?: string; testid?: string }>(), { foreign: false, name: undefined, testid: 'yearInReview.favourite' })
const { t } = useI18n()
const books = useBookStore()
const headingId = useId()
// The row's title: yours, hers by name, or neutral on a member's page that has no name to give.
const rowTitle = computed(() => (!props.foreign ? t('profile.year.favourites') : props.name ? t('profile.year.favouritesOf', { name: props.name }) : t('profile.year.favouritesNeutral')))
const read = computed(() => (props.reads?.length === 1 ? props.reads[0]! : null))
const row = computed(() => (props.reads && props.reads.length > 1 ? props.reads.map((r) => ({ book: r.book })) : null))
const to = (book: { id: string }) => {
  const found = props.reads?.find((r) => r.book.id === book.id)
  return found ? bookPathOf(linkOf(found.book, props.foreign)) : null
}
</script>

<template>
  <FriendsMemberBookLink
    v-if="read"
    v-bind="$attrs"
    :book="linkOf(read.book, foreign)"
    class="relative flex flex-col items-center gap-md overflow-hidden rounded-lg bg-surface-raised px-inset py-lg text-center shadow-raised edge-faint"
    :data-testid="testid"
  >
    <UiAmbient :colors="read.book.coverColors" shape="card" />
    <span class="eyebrow relative">{{ t('profile.year.favourite') }}</span>
    <UiCover
      decorative
      class="relative"
      :title="read.book.title"
      :authors="read.book.authors"
      v-bind="coverImage(read.book, 'lg', coverHosts)"
      :thumbhash="read.book.coverThumbhash"
      :colors="read.book.coverColors"
      size="lg"
      glow
    />
    <span class="relative flex flex-col items-center gap-xs">
      <span class="book-title text-book-title" :data-testid="`${testid}Title`">{{ read.book.title }}</span>
      <span class="text-body text-ink-muted">{{ formatAuthors(read.book.authors, t('common.etAl')) }}</span>
      <UiStars :quarters="read.rating" size="md" />
    </span>
  </FriendsMemberBookLink>
  <section v-else-if="row" v-bind="$attrs" class="flex flex-col gap-md" :aria-labelledby="headingId" :data-testid="`${testid}s`">
    <h2 :id="headingId" class="eyebrow">{{ rowTitle }}</h2>
    <ReadingCoverRow :items="row" :testid="`${testid}sRow`" :link-to="to" @press="books.prefetch" />
  </section>
  <div v-else-if="!reads" class="flex flex-col items-center gap-md rounded-lg bg-surface-raised px-inset py-lg shadow-raised edge-faint" aria-hidden="true">
    <span class="eyebrow">{{ t('profile.year.favourite') }}</span>
    <span class="favourite-cover skeleton wave" />
    <span class="flex w-full flex-col items-center gap-xs">
      <span class="line title-line"><span class="skeleton wave w-1/2" :style="{ '--wave': 0.05 }" /></span>
      <span class="line body-line"><span class="skeleton wave w-1/3" :style="{ '--wave': 0.1 }" /></span>
      <span class="line stars-line"><span class="skeleton wave w-1/4" :style="{ '--wave': 0.15 }" /></span>
    </span>
  </div>
</template>

<style scoped>
.favourite-cover {
  width: var(--size-cover-lg);
  aspect-ratio: 2 / 3;
  border-radius: var(--radius-cover-lg);
}
.line {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: center;
}
.line > * {
  height: 62%;
}
.title-line {
  height: var(--text-book-title--line-height);
}
.body-line {
  height: var(--text-body--line-height);
}
.stars-line {
  height: var(--text-caption--line-height);
}
</style>
