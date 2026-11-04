<script setup lang="ts">
// Home (D's home / home-empty): what matters now. The Books being read, as
// large cards lit by their covers, each with a Finish shortcut; the year's
// tally ("Read in 2026: 3", which opens that year's Books in a sheet);
// Want to read, a short row of covers; and, when there is one, the next Book
// in a series she has been reading (#167). A new member with no Books sees the
// empty state and the way to Search. Kept alive: coming back shows what was
// there and refreshes quietly behind it.
import { useLibraryStore } from '~/stores/library'
import { useFriendsBooksStore } from '~/stores/friendsBooks'
import { useSessionStore } from '~/stores/session'
import type { LibraryEntry } from '~/data/library'

definePageMeta({ layout: 'tabs', screen: 'home', titleSize: 'title', dated: true, greeting: true, keepalive: true })

const { t } = useI18n()
const library = useLibraryStore()
const session = useSessionStore()

// Buddy reads (docs/plans/buddy-read-shared.md W5): the "Reading together" card and a Currently reading card's "..." exist only in a build that has
// them and while her switch is on; otherwise nothing of them is drawn or loaded and nothing asks the server (both are lazy components).
const togetherOn = useBuddyReadsOn()
const togetherEntry = ref<LibraryEntry | null>(null)
const togetherMenu = ref(false)
function togetherFor(entry: LibraryEntry) {
  togetherEntry.value = entry
  togetherMenu.value = true
}

// What the cards, the tally and Want to read show: held while a sheet is on screen
// (a Finish's card stays while the sheet falls away, then collapses) and while
// Home is in the background (a Start on the book page arrives when she is back).
const reading = useSettled(() => library.reading)
const wantToRead = useSettled(() => library.wantToRead)
const readInYear = useSettled(() => library.readInYear)
// Followed members who read, or want, the same Books (circle_reading / circle_want), by her Book's id.
const friendsBooks = useFriendsBooksStore()
const friendsReading = computed(() => friendsBooks.reading)
const friendsWant = computed(() => friendsBooks.want)

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

// Coming back to Home asks again only for what has gone stale (stores/library.ts, `FRESH_MS`); Retry and a member change always ask.
onActivated(() => {
  void library.load({ ifStale: true })
  void library.loadReadInYear({ ifStale: true })
  // The store asks by itself when her lists arrive or change; coming back asks again once the answer is stale.
  void friendsBooks.load({ ifStale: true })
})
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
    <!-- Buddy read invitations wait for a new member too (a read starts from her Library, but she may be asked to join one). -->
    <LazyHomeTogether v-if="togetherOn" />
    <!-- A new member who follows someone, or has a request, sees her friends here too; it shows nothing otherwise, and arrives last (UiReveal). -->
    <HomeFriends />
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
        <HomeReadingCard
          v-for="(entry, index) in reading"
          :key="entry.id"
          :entry="entry"
          :eager="index < 3"
          :friends="friendsReading[entry.book.id]"
          @together="togetherFor"
        />
      </UiListMotion>
      <Transition name="after-leave">
        <p v-if="!reading.length" class="text-subhead text-ink-muted" data-testid="home.readingEmpty">{{ t('home.readingEmpty') }}</p>
      </Transition>
    </section>

    <!-- Buddy reads (W5): her active reads and the invitations that wait, read when Home is on screen; nothing with the switch off. -->
    <LazyHomeTogether v-if="togetherOn" />

    <HomeTally :year="library.readInYearOf" :count="readInYear" @open="tallyOpen = true" />

    <HomeUpNext v-if="wantToRead.length" :entries="wantToRead" :friends="friendsWant" />
    <!-- Last, so its coming (after the lists) moves nothing under it (#167). -->
    <HomeNextInSeries />
    <!-- Last of all, for the same reason: it arrives after the lists and moves nothing above it. -->
    <HomeFriends />
    <HomeTallySheet v-model:open="tallyOpen" :year="library.readInYearOf" :restore="tallyRestore" />
    <LazyHomeTogetherMenu v-if="togetherOn" v-model:open="togetherMenu" :entry="togetherEntry" />
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
