<script setup lang="ts">
// Home (D's home / home-empty): what matters now. The Books being read, as
// large cards lit by their covers, each with a Finish shortcut; the year's
// tally ("Read in 2026: 3"); and Up next, a short row from Want to read. A new
// member with no Books sees the empty state and the way to Search. Kept alive:
// coming back shows what was there and refreshes quietly behind it.
import { useLibraryStore } from '~/stores/library'
import { useSessionStore } from '~/stores/session'

definePageMeta({ layout: 'tabs', screen: 'home', titleSize: 'title', dated: true, greeting: true, keepalive: true })

const { t } = useI18n()
const library = useLibraryStore()
const session = useSessionStore()

const empty = computed(
  () => library.loaded && !library.reading.length && !library.wantToRead.length && !library.finished.length,
)

function load() {
  void library.load()
  void library.loadReadInYear()
}

onActivated(load)
// Kept alive, so a member change (the lists reset) while it is not showing has
// to bring it back by itself.
watch(
  () => session.member?.id,
  (member) => member && load(),
)
</script>

<template>
  <HomeEmpty v-if="empty" />

  <div v-else-if="library.loaded" class="flex flex-col gap-lg">
    <section data-testid="home.reading">
      <div class="flex h-(--size-touch) items-center justify-between">
        <h2 class="eyebrow">{{ t('home.reading') }}</h2>
        <span class="eyebrow text-ink-ghost" data-testid="home.readingCount">{{ library.reading.length }}</span>
      </div>
      <div v-if="library.reading.length" class="flex flex-col gap-ms">
        <HomeReadingCard v-for="(entry, index) in library.reading" :key="entry.id" :entry="entry" :eager="index < 3" />
      </div>
      <p v-else class="text-subhead text-ink-muted" data-testid="home.readingEmpty">{{ t('home.readingEmpty') }}</p>
    </section>

    <HomeTally :year="library.readInYearOf" :count="library.readInYear" />

    <HomeUpNext v-if="library.wantToRead.length" :entries="library.wantToRead" />
  </div>

  <div v-else-if="library.loadError" class="px-lg pt-xxl text-center" data-testid="home.loadError">
    <p class="text-subhead text-ink-muted">{{ t('home.loadError') }}</p>
    <UiButton tone="secondary" size="md" class="mt-md" data-testid="home.retry" @click="load">
      {{ t('home.retry') }}
    </UiButton>
  </div>
</template>
