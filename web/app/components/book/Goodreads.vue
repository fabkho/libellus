<script setup lang="ts">
// Goodreads' community rating under the book page's facts (issue #69):
// "4.3 ★ · 138K ratings · 6.1K reviews on Goodreads", small and quiet, the
// word Goodreads linking to the book's reviews there. Asked for once the page
// shows (stores/goodreads.ts); it opens its room and fades in when the answer
// comes. A rating the Book already carried (a Library copy, offline too) shows
// at once. Hidden while nothing is known, when Goodreads does not know the
// Book, when it has no ratings, and for a Book with neither an ISBN nor an author.
import type { Book, BookSnapshot } from '~/data/books'
import { goodreadsKey, goodreadsUrl, showsRating } from '~/data/goodreads'
import { useGoodreadsStore } from '~/stores/goodreads'
import { numberFormat } from '~/utils/intl'

const props = defineProps<{ book: Book | BookSnapshot }>()

const { t, locale } = useI18n()
const goodreads = useGoodreadsStore()

// A rating that arrives late waits for the cover's flight (useAfterMotion); one the Book carried is there in the first frame.
const rating = useAfterMotion(() => {
  const found = goodreads.rating(props.book)
  return showsRating(found) ? found : null
})

// After the page has rendered, so the line never holds the page up.
onMounted(() => watch(() => goodreadsKey(props.book), () => void goodreads.load(props.book), { immediate: true }))

const compact = computed(() => numberFormat(locale.value, { notation: 'compact', maximumFractionDigits: 1 }))
/** "138K ratings", then "6.1K reviews" when Goodreads said; the last one ends "on Goodreads". */
const counts = computed(() => {
  const r = rating.value
  if (!r) return []
  const format = (key: string, n: number) => t(key, { count: compact.value.format(n) }, n)
  return [
    { testid: 'book.goodreadsRatings', text: format('book.goodreads.ratings', r.ratingsCount) },
    ...(r.reviewsCount ? [{ testid: 'book.goodreadsReviews', text: format('book.goodreads.reviews', r.reviewsCount) }] : []),
  ]
})
const average = computed(() =>
  rating.value
    ? numberFormat(locale.value, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(rating.value.rating)
    : '',
)
</script>

<template>
  <Transition name="room">
    <div v-if="rating" class="room grid" data-testid="book.goodreads">
      <p class="figures flex min-h-0 flex-wrap items-center justify-center gap-x-sm pt-ms text-meta text-ink-faint">
        <span class="text-ink-muted" :aria-label="t('book.goodreads.ratingLabel', { rating: average })" data-testid="book.goodreadsRating">
          {{ average }}<span class="star text-star" aria-hidden="true">★</span>
        </span>
        <template v-for="(count, i) in counts" :key="count.testid">
          <span class="dot text-ink-ghost" aria-hidden="true" />
          <span :data-testid="count.testid">
            {{ count.text }}
            <i18n-t v-if="i === counts.length - 1" keypath="book.goodreads.on" tag="span" scope="global">
              <template #goodreads>
                <a
                  :href="goodreadsUrl(rating.goodreadsId)"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="link text-ink-muted"
                  data-testid="book.goodreadsLink"
                >{{ t('book.goodreads.name') }}</a>
              </template>
            </i18n-t>
          </span>
        </template>
      </p>
    </div>
  </Transition>
</template>

<style scoped>
.dot {
  width: var(--spacing-xxs);
  height: var(--spacing-xxs);
  border-radius: var(--radius-pill);
  background: currentColor;
}

.star {
  margin-left: var(--spacing-xxs);
}

.link {
  position: relative;
  text-decoration: underline;
  text-decoration-color: var(--color-hairline-strong);
  text-underline-offset: var(--spacing-xxs);
}

/* The touch target is the size of a fingertip, not of the 11px word. */
.link::after {
  content: '';
  position: absolute;
  inset: 50% calc(-1 * var(--spacing-sm)) auto;
  height: var(--size-touch);
  transform: translateY(-50%);
}

/* MOTION.md: one that arrives opens its room and fades in over `standard`.
   Clipped only while it moves, so the link's touch area reaches past the line. */
.room {
  grid-template-rows: 1fr;
}
.room-enter-active > p,
.room-leave-active > p {
  overflow: hidden;
}
.room-enter-active {
  transition:
    grid-template-rows var(--duration-standard) var(--ease-standard),
    opacity var(--duration-standard) var(--ease-standard);
}
.room-leave-active {
  transition:
    grid-template-rows var(--duration-exit) var(--ease-exit),
    opacity var(--duration-exit) var(--ease-exit);
}
.room-enter-from,
.room-leave-to {
  grid-template-rows: 0fr;
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .room-enter-active,
  .room-leave-active {
    transition: opacity var(--duration-quick) linear;
  }
}
</style>
