<script setup lang="ts">
// Dev only (the route is dropped from every build: nuxt.config.ts, `$production`): ProfileReadsSheet opened with
// invented Books, for screenshots and for looking at the paging by hand. `/prototype/books-sheet?n=200` (the number of
// Books, 200 by default), `&state=loading` (the placeholders), `&state=empty`, `&withYear`, `&top` (a header in the slot).
import type { StatsRead } from '~/data/stats'

definePageMeta({ layout: false })

const route = useRoute()
const { t } = useI18n()
const state = computed(() => String(route.query.state ?? 'rows'))
const n = computed(() => (state.value === 'rows' ? Math.max(0, Number(route.query.n ?? 200) || 0) : 0))
const open = ref(true)

const TITLES = ['The Left Hand of Darkness', 'Piranesi', 'A Wizard of Earthsea', 'The Dispossessed', 'Hyperion', 'Middlemarch', 'Gilead', 'Beloved', 'Stoner', 'Austerlitz']
const AUTHORS = [['Ursula K. Le Guin'], ['Susanna Clarke'], ['Ursula K. Le Guin'], ['Ursula K. Le Guin', 'Brian Attebery'], ['Dan Simmons'], ['George Eliot'], ['Marilynne Robinson'], ['Toni Morrison'], ['John Williams'], ['W. G. Sebald']]

const reads = computed<StatsRead[]>(() =>
  Array.from({ length: n.value }, (_, i) => {
    const day = new Date(Date.UTC(2026, 0, 1) + (n.value - i) * 86_400_000 * 1.7)
    const title = `${TITLES[i % TITLES.length]}${i >= TITLES.length ? ` ${Math.floor(i / TITLES.length) + 1}` : ''}`
    return {
      sessionId: `fake-${i}`,
      entryId: `fake-${i}`,
      book: {
        id: `fake-${i}`,
        createdAt: day.toISOString(),
        title,
        authors: AUTHORS[i % AUTHORS.length]!,
        isbn13: null,
        isbn10: null,
        pageCount: 200 + i,
        year: null,
        language: 'en',
        publisher: null,
        description: null,
        coverUrl: null,
        coverThumbhash: null,
        coverColors: null,
        source: 'openlibrary',
        appleId: null,
        openLibraryEditionKey: null,
        openLibraryWorkKey: null,
      },
      startedOn: null,
      endedOn: day.toISOString().slice(0, 10),
      outcome: 'finished',
      rating: i % 4 === 0 ? null : 8 + (i % 13),
      pages: 200 + i,
      days: i % 3 === 0 ? null : 3 + (i % 20),
      nth: i % 17 === 5 ? 2 : 1,
    } satisfies StatsRead
  }),
)
</script>

<template>
  <div class="min-h-dvh p-lg">
    <UiButton tone="secondary" size="md" data-testid="proto.open" @click="open = true">Open the sheet</UiButton>
    <ProfileReadsSheet
      v-model:open="open"
      :title="t('profile.sheet.stars', { count: 4, year: t('profile.sheet.allYears') }, 4)"
      :reads="reads"
      :with-year="'withYear' in route.query"
      :loading="state === 'loading'"
      :empty="t('profile.sheet.empty')"
    >
      <template v-if="'top' in route.query" #top>
        <p class="pb-md text-subhead text-ink-muted">A header slot</p>
      </template>
    </ProfileReadsSheet>
  </div>
</template>
