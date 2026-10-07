<script setup lang="ts">
// A member's public reading page (issue #171), for anyone with its link,
// signed in or not (the auth middleware lets `/r/…` through). What it shows is
// what the database publishes for the token (stores/readingPage.ts) and only
// the sections she turned on, in this order: Currently reading, this year's
// figures and month row, Favourites, Recently finished (her Ratings, and the
// reviews she shared), her shelf. Every Book opens its card. Her shelf is the
// owner's 3D row (Regal, from the published library file, lazy like the
// Profile's card; the `regal` chunk is fetched only when this section shows)
// and a row of covers for anyone else. A dead link (turned off, a new link
// made, never was) is "This page isn't here", and the Pages Function in front
// answers it with a 404 too (web/functions/r/[[path]].js). No sign-in, no tab
// bar, the viewer's own light or dark (the theme rule: her stored choice, else
// the device's), out of search engines, and at its end the waitlist form.
import { yearFigures } from '~/data/readingPage'
import { useReadingPageStore } from '~/stores/readingPage'

definePageMeta({ screen: 'readingPage' })

const { t } = useI18n()
const route = useRoute()
const store = useReadingPageStore()
const { monthLong, monthLetter } = useFigures()
const config = useRuntimeConfig().public

const token = computed(() => String(route.params.token ?? ''))
watch(token, (now) => void store.loadPage(now), { immediate: true })

const page = computed(() => (store.pageToken === token.value ? store.page : null))
const name = computed(() => page.value?.name ?? null)
const heading = computed(() => (name.value ? t('readingPage.title', { name: name.value }) : t('readingPage.titleNone')))

useHead({
  title: () => (store.pageState === 'missing' ? t('readingPage.missing.title') : heading.value) + ` · ${t('app.name')}`,
  meta: [{ name: 'robots', content: 'noindex, nofollow' }],
})

const thisYear = Number(isoDay().slice(0, 4))
const thisMonth = Number(isoDay().slice(5, 7))
const year = computed(() => (page.value?.year ? yearFigures(page.value.year) : null))
const columns = computed(() => year.value?.columns.map((c) => ({ ...c, label: monthLetter(c.key), name: monthLong(c.key) })) ?? null)

const reading = computed(() => page.value?.reading ?? [])
const favourites = computed(() => page.value?.favourites ?? [])
const finished = computed(() => page.value?.finished ?? [])
const shelf = computed(() => page.value?.shelf ?? null)
// The owner's shelf needs a build with Regal and the published library file (regal.config.ts); without them it is left out.
const regal = computed(() => shelf.value?.kind === 'regal' && useAppConfig().regal === true && Boolean((config.regal as { librarySrc?: string } | undefined)?.librarySrc))
const shelfBooks = computed(() => (shelf.value?.kind === 'covers' ? shelf.value.books.map((book) => ({ book })) : []))

const empty = computed(
  () => !!page.value && !reading.value.length && !year.value && !favourites.value.length && !finished.value.length && !regal.value && !shelfBooks.value.length,
)
// The room is lit by the first cover the page shows.
const light = computed(() => (reading.value[0] ?? finished.value[0] ?? favourites.value[0])?.book.coverColors ?? null)
</script>

<template>
  <main class="relative mx-auto min-h-dvh w-full max-w-(--size-max-content) safe-x" data-testid="readingPage">
    <UiAmbient :colors="light" />
    <div class="screen-inset relative flex min-h-dvh flex-col px-screen">
      <p class="pt-lg font-serif text-callout lowercase italic text-ink-muted">{{ t('app.name') }}</p>

      <div v-if="store.pageState === 'loading'" class="flex flex-1 items-center justify-center" role="status" data-testid="readingPage.loading">
        <p class="text-subhead text-ink-muted">{{ t('readingPage.loading') }}</p>
      </div>

      <div v-else-if="store.pageState === 'missing'" class="flex flex-1 flex-col justify-center gap-sm py-xxl" data-testid="readingPage.missing">
        <h1 class="book-title text-title">{{ t('readingPage.missing.title') }}</h1>
        <p class="text-body text-ink-muted">{{ t('readingPage.missing.text') }}</p>
      </div>

      <div v-else-if="store.pageState !== 'ready'" class="flex flex-1 flex-col items-center justify-center gap-md text-center" role="status" data-testid="readingPage.error">
        <h1 class="sr-only">{{ t('readingPage.titleNone') }}</h1>
        <p class="text-subhead text-ink-muted">{{ store.pageState === 'offline' ? t('readingPage.offline') : t('readingPage.error') }}</p>
        <UiButton v-if="store.pageState === 'error'" tone="secondary" size="md" data-testid="readingPage.retry" @click="store.loadPage(token)">{{ t('readingPage.retry') }}</UiButton>
      </div>

      <template v-else-if="page">
        <h1 class="book-title pt-xs pb-xl text-large-title text-balance" data-testid="readingPage.title">{{ heading }}</h1>

        <div class="flex flex-col gap-xxl">
          <section v-if="reading.length" aria-labelledby="reading-now" class="flex flex-col gap-md" data-testid="readingPage.reading">
            <h2 id="reading-now" class="eyebrow">{{ t('readingPage.reading') }}</h2>
            <ReadingCoverRow :items="reading" :token="token" testid="readingPage.readingRow" />
          </section>

          <section v-if="year" aria-labelledby="reading-year" class="flex flex-col gap-md" data-testid="readingPage.year">
            <h2 id="reading-year" class="eyebrow">{{ t('readingPage.year', { year: year.year }) }}</h2>
            <ProfileFigures :figures="year" />
            <ProfileColumns still :columns="columns" :lit="year.year === thisYear ? thisMonth : null" testid="readingPage.months" />
          </section>

          <section v-if="favourites.length" aria-labelledby="reading-favourites" class="flex flex-col gap-md" data-testid="readingPage.favourites">
            <h2 id="reading-favourites" class="eyebrow">{{ t('readingPage.favourites') }}</h2>
            <ReadingCoverRow :items="favourites" :token="token" testid="readingPage.favouritesRow" />
          </section>

          <section v-if="finished.length" aria-labelledby="reading-finished" class="flex flex-col gap-sm" data-testid="readingPage.finishedSection">
            <h2 id="reading-finished" class="eyebrow">{{ t('readingPage.finished') }}</h2>
            <ReadingFinishedList :items="finished" :token="token" />
          </section>

          <section v-if="regal || shelfBooks.length" aria-labelledby="reading-shelf" class="flex flex-col gap-md" data-testid="readingPage.shelf">
            <h2 id="reading-shelf" class="eyebrow">{{ name ? t('readingPage.shelf', { name }) : t('readingPage.shelfNone') }}</h2>
            <ShelfRowCard
              v-if="regal"
              :limit="SHELF_ROW_LIMIT"
              :label="name ? t('readingPage.shelfRowLabel', { name }) : t('readingPage.shelfRowLabelNone')"
              data-testid="readingPage.shelfRow"
            />
            <ReadingCoverRow v-else :items="shelfBooks" :token="token" compact testid="readingPage.shelfCovers" />
          </section>

          <p v-if="empty" class="text-subhead text-ink-muted" data-testid="readingPage.empty">{{ t('readingPage.nothing') }}</p>
        </div>
      </template>

      <ReadingFooter v-if="store.pageState !== 'loading'" :token="token" class="mt-auto" />
    </div>
  </main>
</template>
