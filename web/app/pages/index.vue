<script setup lang="ts">
// Home (D's home / home-empty): what matters now. The Books being read, as
// large cards lit by their covers, each with a Finish shortcut; the year's
// tally ("Read in 2026: 3", which opens that year's Books in a sheet); and
// Want to read, a short row of covers. A new member with no Books sees the
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

// The year's Books, in a sheet: the tally opens it (HomeTallySheet).
const tallyOpen = ref(false)

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
    <HomeInstallHint />

    <section data-testid="home.reading">
      <div class="flex h-(--size-touch) items-center justify-between">
        <h2 class="eyebrow">{{ t('home.reading') }}</h2>
        <!-- Nothing being read: the count would only say 0 above the line that says so. -->
        <span v-if="reading.length" class="eyebrow text-ink-ghost" data-testid="home.readingCount">{{ reading.length }}</span>
      </div>
      <UiListMotion class="flex flex-col gap-ms">
        <HomeReadingCard v-for="(entry, index) in reading" :key="entry.id" :entry="entry" :eager="index < 3" />
      </UiListMotion>
      <Transition name="after-leave">
        <p v-if="!reading.length" class="text-subhead text-ink-muted" data-testid="home.readingEmpty">{{ t('home.readingEmpty') }}</p>
      </Transition>
    </section>

    <HomeTally :year="library.readInYearOf" :count="readInYear" @open="tallyOpen = true" />

    <HomeUpNext v-if="wantToRead.length" :entries="wantToRead" />
    <HomeTallySheet v-model:open="tallyOpen" :year="library.readInYearOf" />
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
