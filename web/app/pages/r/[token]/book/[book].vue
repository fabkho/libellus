<script setup lang="ts">
// A Book card (issue #171): one Book from a member's reading page, for anyone
// with its link, signed in or not. The cover large in its own light, the
// title and authors, where she is with it (reading now, wants to read,
// finished on a day), her Rating, and her review when she shared it. Above it
// a way to her whole page; under it the quiet invite. A dead link, or a Book
// her page neither shows nor shares, is "This page isn't here" (and a 404 from
// the Pages Function in front, web/functions/r/[[path]].js). Its link preview
// (the title, her stars, the cover) is the Open Graph image the same Function
// serves (supabase/functions/reading-page-og).
import { readingPagePath } from '~/data/readingPage'
import { useReadingPageStore } from '~/stores/readingPage'

definePageMeta({ screen: 'bookCard' })

const { t } = useI18n()
const route = useRoute()
const store = useReadingPageStore()
const { formatDay } = useDays()

const token = computed(() => String(route.params.token ?? ''))
const bookId = computed(() => String(route.params.book ?? ''))
watch([token, bookId], ([now, book]) => void store.loadCard(now, book), { immediate: true })

const card = computed(() => store.card)
const name = computed(() => card.value?.name ?? null)
const authors = computed(() => (card.value ? formatAuthors(card.value.book.authors, t('common.etAl')) : ''))

useHead({
  title: () =>
    (store.cardState === 'missing' ? t('readingPage.missing.title') : card.value ? card.value.book.title : t('readingPage.titleNone')) + ` · ${t('app.name')}`,
  meta: [{ name: 'robots', content: 'noindex, nofollow' }],
})

const status = computed(() => {
  const c = card.value
  if (!c) return ''
  if (c.status === 'reading') return t('readingPage.card.reading')
  if (c.status === 'want_to_read') return t('readingPage.card.want')
  return c.endedOn ? t('readingPage.card.finished', { date: formatDay(c.endedOn) }) : t('readingPage.card.finishedUndated')
})
</script>

<template>
  <main class="relative mx-auto min-h-dvh w-full max-w-(--size-max-content) safe-x" data-testid="bookCard">
    <UiAmbient :colors="card?.book.coverColors ?? null" />
    <div class="screen-inset relative flex min-h-dvh flex-col px-screen">
      <NuxtLink :to="readingPagePath(token)" class="-ml-sm inline-flex min-h-(--size-touch) items-center gap-xs self-start px-sm text-subhead text-ink-muted" data-testid="bookCard.page">
        <UiIcon name="back" :size="18" />{{ name ? t('readingPage.card.back', { name }) : t('readingPage.card.backNone') }}
      </NuxtLink>

      <div v-if="store.cardState === 'loading'" class="flex flex-1 items-center justify-center" role="status" data-testid="bookCard.loading">
        <p class="text-subhead text-ink-muted">{{ t('readingPage.loading') }}</p>
      </div>

      <div v-else-if="store.cardState === 'missing'" class="flex flex-1 flex-col justify-center gap-sm py-xxl" data-testid="bookCard.missing">
        <h1 class="book-title text-title">{{ t('readingPage.missing.title') }}</h1>
        <p class="text-body text-ink-muted">{{ t('readingPage.missing.text') }}</p>
      </div>

      <div v-else-if="store.cardState !== 'ready'" class="flex flex-1 flex-col items-center justify-center gap-md text-center" role="status" data-testid="bookCard.error">
        <h1 class="sr-only">{{ t('readingPage.titleNone') }}</h1>
        <p class="text-subhead text-ink-muted">{{ store.cardState === 'offline' ? t('readingPage.offline') : t('readingPage.error') }}</p>
        <UiButton v-if="store.cardState === 'error'" tone="secondary" size="md" data-testid="bookCard.retry" @click="store.loadCard(token, bookId)">{{ t('readingPage.retry') }}</UiButton>
      </div>

      <article v-else-if="card" class="flex flex-col items-center gap-lg pt-lg text-center">
        <UiCover
          decorative
          eager
          priority
          glow
          :title="card.book.title"
          :authors="card.book.authors"
          :src="coverSrc(card.book.coverUrl, 'xl')"
          :thumbhash="card.book.coverThumbhash"
          :colors="card.book.coverColors"
          size="xl"
        />
        <div class="flex flex-col gap-xs">
          <h1 class="book-title text-title text-balance" data-testid="bookCard.title">{{ card.book.title }}</h1>
          <p v-if="authors" class="text-body text-ink-muted" data-testid="bookCard.authors">{{ authors }}</p>
          <p class="figures text-meta text-ink-faint" data-testid="bookCard.status">{{ status }}</p>
        </div>

        <div v-if="card.rating" class="flex flex-col items-center gap-xs" data-testid="bookCard.rating">
          <p class="eyebrow">{{ name ? t('readingPage.card.rating', { name }) : t('readingPage.card.ratingNone') }}</p>
          <UiStars :quarters="card.rating" size="lg" />
        </div>

        <figure v-if="card.review" class="flex w-full flex-col gap-sm text-left" data-testid="bookCard.review">
          <figcaption class="eyebrow">{{ name ? t('readingPage.card.review', { name }) : t('readingPage.card.reviewNone') }}</figcaption>
          <blockquote class="text-body whitespace-pre-line text-ink">{{ card.review }}</blockquote>
        </figure>
      </article>

      <ReadingFooter v-if="store.cardState !== 'loading'" :name="name" class="mt-auto" />
    </div>
  </main>
</template>
