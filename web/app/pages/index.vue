<script setup lang="ts">
// Home (D's home / home-empty): what matters now. The Books being read, as
// large cards lit by their covers, each with a Finish shortcut; the year's
// tally ("Read in 2026: 3", which opens that year's Books in a sheet);
// Want to read, a short row of covers; and, when there is one, the next Book
// in a series she has been reading (#167). A new member with no Books sees the
// empty state and the way to Search. Kept alive: coming back shows what was
// there and refreshes quietly behind it.
import { useLibraryStore } from '~/stores/library'
import { useSessionStore } from '~/stores/session'

definePageMeta({ layout: 'tabs', screen: 'home', titleSize: 'title', dated: true, greeting: true, keepalive: true })

const { t } = useI18n()
const library = useLibraryStore()
const session = useSessionStore()

// What the cards, the tally and Want to read show: held while a sheet is on screen
// (a Finish's card stays while the sheet falls away, then collapses) and while
// Home is in the background (a Start on the book page arrives when she is back).
const reading = useSettled(() => library.reading)
const wantToRead = useSettled(() => library.wantToRead)
const readInYear = useSettled(() => library.readInYear)
// Followed members who read, or want, the same Books (circle_reading / circle_want), by her Book's id; empty until a later task wires them (nothing is asked yet).
const circleReading = ref<Record<string, CircleGroup>>({})
const circleWant = ref<Record<string, CircleGroup>>({})

// The year's Books, in a sheet: the tally opens it (HomeTallySheet).
const tallyOpen = ref(false)
// Back from a Book opened from it, the sheet is open again as it was left (composables/useSheetRestore.ts).
const { restore: tallyRestore } = useSheetRestore({
  testid: 'homeTally',
  sheet: () => tallyOpen.value || null,
  reopen: () => (tallyOpen.value = true),
})
// For the owner, the sheet's row of that year is warmed on idle, so it opens with its Spines drawn.
useShelfPreload(() => library.readInYearOf)

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
  <div v-if="empty" class="flex flex-col gap-xl">
    <HomeEmpty />
    <!-- A new member who follows someone, or has a request, sees her circle here too; it shows nothing otherwise, and arrives last (UiReveal). -->
    <HomeCircle />
  </div>

  <div v-else-if="library.loaded" class="flex flex-col gap-lg">
    <HomeInstallHint />
    <HomeImportOffer />

    <section data-testid="home.reading">
      <div class="flex h-(--size-touch) items-center justify-between">
        <h2 class="eyebrow">{{ t('home.reading') }}</h2>
        <!-- Nothing being read: the count would only say 0 above the line that says so. -->
        <span v-if="reading.length" class="eyebrow text-ink-faint" data-testid="home.readingCount">{{ reading.length }}</span>
      </div>
      <UiListMotion class="flex flex-col gap-ms">
        <HomeReadingCard v-for="(entry, index) in reading" :key="entry.id" :entry="entry" :eager="index < 3" :circle="circleReading[entry.book.id]" />
      </UiListMotion>
      <Transition name="after-leave">
        <p v-if="!reading.length" class="text-subhead text-ink-muted" data-testid="home.readingEmpty">{{ t('home.readingEmpty') }}</p>
      </Transition>
    </section>

    <HomeTally :year="library.readInYearOf" :count="readInYear" @open="tallyOpen = true" />

    <HomeUpNext v-if="wantToRead.length" :entries="wantToRead" :circle="circleWant" />
    <!-- Last, so its coming (after the lists) moves nothing under it (#167). -->
    <HomeNextInSeries />
    <!-- Last of all, for the same reason: it arrives after the lists and moves nothing above it. -->
    <HomeCircle />
    <HomeTallySheet v-model:open="tallyOpen" :year="library.readInYearOf" :restore="tallyRestore" />
  </div>

  <div v-else-if="library.loadError" class="px-lg pt-xxl text-center" data-testid="home.loadError">
    <p class="text-subhead text-ink-muted">{{ t('home.loadError') }}</p>
    <UiButton tone="secondary" size="md" class="mt-md" data-testid="home.retry" @click="load">
      {{ t('home.retry') }}
    </UiButton>
  </div>
</template>

<style scoped>
/* "Nothing being read" fades in once the last card has gone, not over it. */
.after-leave-enter-active {
  transition: opacity var(--duration-standard) var(--ease-standard) var(--duration-exit);
}
.after-leave-enter-from {
  opacity: 0;
}
</style>
