<script setup lang="ts">
// An author's page (#167): the hero (portrait, name, life dates, genres, the
// Wikipedia intro with its credits), then her works, one entry per work,
// grouped: each series in reading order ("Book 3"), then the works in no series
// split by what they are — the novels, the novellas, then the rest (collections,
// non-fiction, works without a place and works without a kind). A work says its
// kind beside its year. Each work
// shows her status or "+ Want to read" and opens its Book's page. Opened by
// any of the author's keys (Wikidata item, Open Library id, uuid) from the
// Book page's author line and from a list row's. A pushed screen in the tabs
// layout; it opens from the device's copy where there is one (offline too)
// and refreshes behind it; the first opening stands in placeholders of its
// shape, replaced whole when the page comes.
//
// The hero's genre chips filter the works below (C5b): a pressed chip shows only
// the works whose genres include it, several pressed chips are an OR, and none
// pressed shows everything. The state is the page's own and goes away with it;
// the predicate and the filter are `utils/authorPage.ts`, tested in plain Node.
import type { GenreId } from '~/data/enrich'
import type { WorkCard } from '~/data/enrich'
import { useAuthorsStore } from '~/stores/authors'
import { useLibraryStore } from '~/stores/library'
import { filterByGenres, standaloneByKind } from '~/utils/authorPage'
import { newestFirst } from '~/utils/enrich'

definePageMeta({ layout: 'tabs', screen: 'author', pushed: true })

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const authors = useAuthorsStore()
const library = useLibraryStore()

const key = computed(() => String(route.params.key))
const state = computed(() => authors.page(key.value))
const page = computed(() => state.value?.page ?? null)
const author = computed(() => page.value?.author ?? null)
const loading = computed(() => !page.value && (!state.value || state.value.phase === 'loading'))
const arriving = useArrival(() => loading.value)

watch(key, (value) => void authors.load(value), { immediate: true })
// Her Library changed (a work added from here, a Book finished elsewhere): her statuses are read again.
watch(
  () => library.wantToRead.length + library.reading.length + library.finished.length,
  () => void authors.load(key.value),
)

useHead({ title: () => (author.value ? `${author.value.name} · ${t('app.name')}` : t('app.name')) })

/** How many works a group shows before "Show all". */
const SHOWN = 8
const opened = reactive(new Set<string>())

/** The hero's genre chips a finger has pressed: their own state, gone with the page. */
const activeGenres = ref<GenreId[]>([])

/**
 * Every work the page shows, as the hero's chips leave them: the page's own works with those of the pressed genres, or
 * all of them while nothing is pressed.
 */
const visible = computed(() => {
  const p = page.value
  if (!p) return null
  const pick = (works: readonly WorkCard[]) => filterByGenres(works, activeGenres.value)
  return {
    series: p.series.map((s) => ({ ...s, works: pick(s.works) })).filter((s) => s.works.length),
    standalone: pick(p.standalone),
    other: pick(p.other),
  }
})

type Group = { id: string; title: string; parent?: string; works: WorkCard[]; places: boolean }
const groups = computed<Group[]>(() => {
  const v = visible.value
  if (!v) return []
  const standalone = standaloneByKind(v.standalone)
  return [
    ...v.series.map((s) => ({ id: `series-${s.id}`, title: s.name, parent: s.parentName ?? undefined, works: s.works, places: true })),
    ...(standalone.novels.length ? [{ id: 'standalone', title: t('author.standalone'), works: newestFirst(standalone.novels), places: false }] : []),
    ...(standalone.novellas.length ? [{ id: 'novellas', title: t('author.novellas'), works: newestFirst(standalone.novellas), places: false }] : []),
    ...(standalone.rest.length ? [{ id: 'standaloneOther', title: t('author.standaloneOther'), works: newestFirst(standalone.rest), places: false }] : []),
    ...(v.other.length ? [{ id: 'other', title: t('author.other'), works: newestFirst(v.other), places: false }] : []),
  ]
})

/** Every work of hers this page lists, and how many of them the chips leave: what the status line says. */
const totals = computed(() => {
  const p = page.value
  if (!p) return { all: 0, shown: 0 }
  const all = p.series.reduce((n, s) => n + s.works.length, 0) + p.standalone.length + p.other.length
  const shown = groups.value.reduce((n, g) => n + g.works.length, 0)
  return { all, shown }
})

const filterStatus = computed(() =>
  activeGenres.value.length ? t('author.filterCount', { shown: totals.value.shown, total: totals.value.all }, totals.value.all) : '',
)

function toggleGenre(genre: GenreId) {
  activeGenres.value = activeGenres.value.includes(genre)
    ? activeGenres.value.filter((g) => g !== genre)
    : [...activeGenres.value, genre]
}
const shown = (group: Group) => (opened.has(group.id) || group.works.length <= SHOWN + 2 ? group.works : group.works.slice(0, SHOWN))
const placeOf = (group: Group, work: WorkCard) => {
  const n = group.places ? positionText(work.position) : null
  return n ? t('series.book', { n }) : null
}

function back() {
  if (window.history.state?.back) router.back()
  else void navigateTo('/library')
}
</script>

<template>
  <div class="relative min-h-dvh" data-testid="author">
    <UiTopBar :back-label="t('author.back')" back-testid="author.back" @back="back" />

    <template v-if="page || loading">
      <AuthorHero :author="author" :genres="page?.genres ?? []" :active="activeGenres" :arriving="arriving" @toggle="toggleGenre" />

      <div v-if="page" class="relative px-ml" :class="{ arrive: arriving }">
        <!-- What the chips leave, and the way back to everything: one line, a polite status, so the change below is heard
             and nothing above it moves (the Library's own filter says its count the same way). -->
        <div v-if="activeGenres.length" class="flex min-h-(--size-touch) items-center justify-between gap-md" data-testid="author.filter">
          <p class="figures min-w-0 truncate text-caption text-ink-faint" role="status" data-testid="author.filterCount">{{ filterStatus }}</p>
          <UiButton tone="plain" size="sm" class="shrink-0" data-testid="author.filterClear" @click="activeGenres = []">{{ t('author.filterClear') }}</UiButton>
        </div>

        <p v-if="activeGenres.length && !groups.length" class="pt-xl text-center text-subhead text-ink-muted" data-testid="author.filterEmpty">{{ t('author.filterEmpty') }}</p>

        <section v-for="(group, g) in groups" :key="group.id" class="pt-xl" :data-testid="group.places ? 'author.series' : `author.${group.id}`">
          <div class="flex min-h-(--size-touch) items-end justify-between gap-md pb-xs">
            <h2 class="min-w-0">
              <span v-if="group.parent" class="eyebrow block text-ink-faint" data-testid="author.seriesParent">{{ group.parent }}</span>
              <span class="eyebrow block" data-testid="author.groupTitle">{{ group.title }}</span>
            </h2>
            <span class="eyebrow shrink-0 text-ink-faint" data-testid="author.groupCount">{{ t('author.count', { count: group.works.length }, group.works.length) }}</span>
          </div>
          <component :is="group.places ? 'ol' : 'ul'" :aria-label="group.title">
            <AuthorWorkRow
              v-for="(work, index) in shown(group)"
              :key="work.workId ?? work.entry?.entryId ?? `${work.title}-${index}`"
              :work="work"
              :place="placeOf(group, work)"
              testid="author.work"
              :author="author?.name"
              kind
              :eager="g === 0 && index < 4"
            />
          </component>
          <button
            v-if="shown(group).length < group.works.length"
            type="button"
            class="figures -ml-sm flex min-h-(--size-touch) items-center gap-xxs px-sm text-footnote text-ink-muted"
            data-testid="author.showAll"
            @click="opened.add(group.id)"
          >
            {{ t('author.showAll', { count: group.works.length }) }}
            <UiIcon name="down" :size="13" />
          </button>
        </section>

        <p v-if="!groups.length && !activeGenres.length" class="pt-xl text-center text-subhead text-ink-muted" data-testid="author.noWorks">{{ t('author.noWorks') }}</p>
      </div>

      <!-- The works, in placeholders, under the hero's: replaced whole with the page. -->
      <div v-else class="relative px-ml pt-xl" aria-hidden="true" data-testid="author.loading">
        <span class="line eyebrow-line w-1/3"><span class="skeleton wave w-full" /></span>
        <span v-for="i in 4" :key="i" class="flex items-center gap-inset py-sm">
          <span class="cover skeleton wave" :style="{ '--wave': i * 0.12 }" />
          <span class="flex flex-1 flex-col gap-xs">
            <span class="line body-line w-2/3"><span class="skeleton wave w-full" :style="{ '--wave': i * 0.12 + 0.05 }" /></span>
            <span class="line meta-line w-1/4"><span class="skeleton wave w-full" :style="{ '--wave': i * 0.12 + 0.1 }" /></span>
          </span>
        </span>
        <span class="sr-only">{{ t('author.loading') }}</span>
      </div>
    </template>

    <div v-else class="relative px-ml pt-xxl text-center" data-testid="author.missing">
      <p class="book-title text-headline">{{ t(`author.${state?.phase === 'missing' ? 'missing' : state?.phase === 'offline' ? 'offline' : 'error'}Title`) }}</p>
      <p class="mt-sm text-subhead text-ink-muted">{{ t(`author.${state?.phase === 'missing' ? 'missing' : state?.phase === 'offline' ? 'offline' : 'error'}`) }}</p>
      <div v-if="state?.phase === 'error'" class="mt-lg flex justify-center">
        <UiButton tone="secondary" size="md" data-testid="author.retry" @click="authors.load(key)">{{ t('author.retry') }}</UiButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cover {
  width: var(--size-cover-sm);
  aspect-ratio: 2 / 3;
  border-radius: var(--radius-cover-sm);
}

.line {
  display: flex;
  align-items: center;
}
.line > * {
  height: 62%;
}
.eyebrow-line {
  height: var(--size-touch);
}
.body-line {
  height: var(--text-body-large--line-height);
}
.meta-line {
  height: var(--text-meta--line-height);
}
</style>
