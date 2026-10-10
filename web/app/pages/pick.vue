<script setup lang="ts">
// Pick my next book, step 1 (issue #259, PROTOTYPE behind `?pick=1`): choose the candidates.
// Her Want to read list, each Book a tap to choose or un-choose; a search (the app's own: her
// Library, the Catalogue, Apple and OpenLibrary, stores/search.ts) for a Book that is not on it,
// which joins as a snapshot without being added; the chosen ones as a row of small covers, each
// one tap away from going again; the animation's variant (A, B, C) in a chooser; and Pick, which
// draws the winner and deals (components/pick/Stage.vue). Nothing here writes.
import { candidateOfEntry, candidateOfHit, PICK_MAX, PICK_MIN, type PickCandidate } from '~/data/pick'
import { useLibraryStore } from '~/stores/library'
import { usePickStore } from '~/stores/pick'
import { useSearchStore } from '~/stores/search'
import type { SearchHit } from '~/stores/search'

definePageMeta({ layout: 'tabs', screen: 'pick', pushed: true, immersive: true })

const { t } = useI18n()
const router = useRouter()
const library = useLibraryStore()
const pick = usePickStore()
const search = useSearchStore()

useHead({ title: () => `${t('pick.title')} · ${t('app.name')}` })

onMounted(() => void library.load({ ifStale: true }))
// The picker's search is the app's search; it is left as it was found.
onBeforeUnmount(() => search.close())

const candidates = computed(() => library.wantToRead.map(candidateOfEntry))

function back() {
  if (window.history.state?.back === '/library') router.back()
  else void navigateTo('/library')
}

// ------------------------------------------------------------------ search

const searching = computed(() => search.query.trim().length >= 2)
/** What search found, each as a candidate (null: read or being read, not for picking). */
const found = computed(() =>
  [...search.own, ...search.others].map((hit: SearchHit) => ({ hit, candidate: candidateOfHit(hit) })),
)
const statusOf = (hit: SearchHit) => (hit.entry ? t(`status.${hit.entry.status}`) : '')

// ------------------------------------------------------------------ choose

function toggle(candidate: PickCandidate) {
  pick.toggle(candidate)
}

const variantOpen = ref(false)

function go() {
  if (!pick.ready) return
  pick.start()
}
</script>

<template>
  <div class="relative min-h-dvh pb-[calc(var(--float-bottom)+var(--size-touch)*2)]">
    <UiTopBar :back-label="t('pick.back')" back-testid="pick.back" @back="back">
      <template #trailing>
        <button
          type="button"
          class="pointer-events-auto glass edge flex h-(--size-touch) items-center gap-xs rounded-pill px-md text-footnote text-ink"
          data-testid="pick.variant"
          @click="variantOpen = true"
        >
          <span class="text-ink-faint">{{ t('pick.variant') }}</span>
          <span>{{ t(`pick.variants.${pick.variant}.name`) }}</span>
        </button>
      </template>
    </UiTopBar>

    <header class="px-screen pt-bar">
      <p class="eyebrow text-accent-ink">{{ t('pick.prototype') }}</p>
      <h1 class="mt-xs text-large-title" data-testid="pick.title">{{ t('pick.title') }}</h1>
      <p class="mt-xs text-subhead text-ink-muted">{{ t('pick.intro') }}</p>
    </header>

    <!-- The chosen ones: small covers, each removed again with a tap. -->
    <section class="px-screen pt-lg" :aria-label="t('pick.chosen')">
      <div class="flex items-baseline justify-between">
        <h2 class="eyebrow">{{ t('pick.chosen') }}</h2>
        <p class="figures text-caption text-ink-muted" aria-live="polite" data-testid="pick.count">
          {{ t('pick.count', { count: pick.selection.length, max: PICK_MAX }, pick.selection.length) }}
        </p>
      </div>
      <UiListMotion v-if="pick.selection.length" tag="ul" class="chosen mt-sm flex gap-sm overflow-x-auto pb-xs scrollbar-none" data-testid="pick.chosen">
        <li v-for="candidate in pick.selection" :key="candidate.key" class="shrink-0">
          <button
            type="button"
            class="relative block rounded-sm active:opacity-70"
            :aria-label="t('pick.remove', { title: candidate.book.title })"
            data-testid="pick.chosenItem"
            @click="pick.remove(candidate.key)"
          >
            <UiCover
              decorative
              :title="candidate.book.title"
              :authors="candidate.book.authors"
              :src="coverSrc(candidate.book.coverUrl, 'sm')"
              :thumbhash="candidate.book.coverThumbhash"
              :colors="candidate.book.coverColors"
              size="sm"
              eager
            />
            <span class="remove glass edge absolute -top-xs -right-xs flex items-center justify-center rounded-pill text-ink">
              <UiIcon name="close" :size="12" bold />
            </span>
          </button>
        </li>
      </UiListMotion>
      <p v-else class="mt-sm text-caption text-ink-faint">{{ t('pick.needMore', { min: PICK_MIN }) }}</p>
      <p v-if="pick.full" class="mt-xs text-caption text-error" role="alert" data-testid="pick.full">{{ t('pick.full', { max: PICK_MAX }) }}</p>
    </section>

    <!-- Search: a Book that is not on the list joins as it is, not added. -->
    <section class="px-screen pt-lg">
      <label for="pick-search" class="sr-only">{{ t('pick.searchLabel') }}</label>
      <div class="flex items-center gap-sm rounded-md bg-fill px-ms">
        <UiIcon name="search" :size="18" class="text-ink-faint" />
        <input
          id="pick-search"
          v-model="search.query"
          type="search"
          autocomplete="off"
          enterkeyhint="search"
          :placeholder="t('pick.searchPlaceholder')"
          class="min-h-(--size-touch) w-full bg-transparent text-body text-ink caret-accent outline-none placeholder:text-ink-faint"
          data-testid="pick.search"
        />
        <button v-if="search.query" type="button" class="text-ink-faint" :aria-label="t('common.cancel')" data-testid="pick.searchClear" @click="search.query = ''">
          <UiIcon name="close" :size="16" />
        </button>
      </div>

      <div v-if="searching" class="pt-xs" data-testid="pick.results">
        <p v-if="search.phase === 'loading' && !found.length" class="py-sm text-caption text-ink-faint">{{ t('pick.searchLoading') }}</p>
        <p v-else-if="!found.length" class="py-sm text-caption text-ink-faint">{{ t('pick.searchEmpty') }}</p>
        <PickRow
          v-for="{ hit, candidate } in found.slice(0, 12)"
          :key="hit.key"
          :book="hit.book"
          :chosen="pick.selected(hit.key) || (candidate ? pick.selected(candidate.key) : false)"
          :disabled="!candidate"
          :note="candidate ? (candidate.kind === 'search' ? t('pick.fromSearch') : t('pick.wantToRead')) : t('pick.notNext', { status: statusOf(hit) })"
          testid="pick.result"
          @toggle="candidate && toggle(candidate)"
        />
      </div>
    </section>

    <!-- Her Want to read list. -->
    <section class="px-screen pt-lg">
      <div class="flex items-baseline justify-between">
        <h2 class="eyebrow">{{ t('pick.wantToRead') }}</h2>
        <p class="figures text-caption text-ink-faint">{{ t('pick.wantToReadCount', { count: candidates.length }, candidates.length) }}</p>
      </div>
      <div class="flex flex-col pt-xs" data-testid="pick.list">
        <PickRow
          v-for="candidate in candidates"
          :key="candidate.key"
          :book="candidate.book"
          :chosen="pick.selected(candidate.key)"
          testid="pick.item"
          @toggle="toggle(candidate)"
        />
      </div>
    </section>

    <!-- Pick: over the bottom of the screen, where the tab bar would be. -->
    <div class="pick-bar float-bottom fixed inset-x-0 z-20 mx-auto max-w-(--size-max-content) px-screen">
      <UiButton block :disabled="!pick.ready" data-testid="pick.go" @click="go">
        {{ pick.ready ? t('pick.actionCount', { count: pick.selection.length }) : t('pick.needMore', { min: PICK_MIN }) }}
      </UiButton>
    </div>

    <PickVariantSheet v-model:open="variantOpen" />
  </div>
</template>

<style scoped>
.remove {
  width: var(--spacing-ml);
  height: var(--spacing-ml);
}
</style>
