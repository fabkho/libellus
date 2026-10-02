<script setup lang="ts">
// book-new / book-reading / book-finished. The cover is the object on the
// table: lifted and a little crooked on a wash of its own colour. Reading:
// a ribbon hangs out of it and a "Day 131" sticker. Finished: the red date
// stamp across its corner. Below: the action for the Status, the reading
// history as a library card, Collections as paper tags, the description.
import { computed } from 'vue'
import type { Book, LibraryEntry } from '../../../data'
import { formatAuthors, formatDate, latestSession } from '../../../data'
import Button from '../kit/Button.vue'
import Chip from '../kit/Chip.vue'
import Plank from '../kit/Plank.vue'
import Cover from '../kit/Cover.vue'
import Icon from '../kit/Icon.vue'
import LibraryCard from '../kit/LibraryCard.vue'
import NavBar from '../kit/NavBar.vue'
import Stamp from '../kit/Stamp.vue'
import Stars from '../kit/Stars.vue'
import StatusTag from '../kit/StatusTag.vue'
import { daysBetween, stampDate, wash } from '../kit/paint'
import { useShelf } from '../kit/useShelf'

const props = defineProps<{ state: 'new' | 'reading' | 'finished' }>()
const { data, palette } = useShelf()

const entry = computed<LibraryEntry | null>(() =>
  props.state === 'reading' ? data.value.readingEntry : props.state === 'finished' ? data.value.finishedEntry : null,
)
const book = computed<Book>(() => entry.value?.book ?? data.value.newBook)
const latest = computed(() => (entry.value ? latestSession(entry.value) : null))
const collections = computed(() => (entry.value ? data.value.collectionsOf(entry.value) : []))
const meta = computed(() =>
  [book.value.year, book.value.pageCount && `${book.value.pageCount} pages`, book.value.publisher]
    .filter(Boolean)
    .join(' · '),
)
const hero = computed(() => wash(book.value, palette.value))
/** book-new: the author's other books — what's on your shelf and what search found. */
const moreByAuthor = computed(() => {
  const author = book.value.authors[0]
  const owned = data.value.library.filter((e) => e.book.authors[0] === author && e.book.id !== book.value.id)
  const found = data.value.search.results.filter(
    (r) => r.authors[0] === author && r.title !== book.value.title && !owned.some((e) => e.book.title === r.title),
  )
  return [
    ...owned.map((e) => ({ key: e.id, book: e.book, owned: true })),
    ...found.map((r) => ({ key: r.id, book: r, owned: false })),
  ].slice(0, 4)
})
const surname = computed(() => book.value.authors[0]?.split(' ').at(-1) ?? '')
const day = computed(() =>
  latest.value?.startedOn ? daysBetween(latest.value.startedOn, data.value.today) + 1 : null,
)
</script>

<template>
  <div class="screen c-paper-grain">
    <div class="hero" :style="{ '--hero': hero }">
      <NavBar :back="state === 'new' ? 'Search' : 'Library'" tone="float">
        <template #trailing>
          <span v-if="entry" class="round"><Icon name="more" /></span>
        </template>
      </NavBar>

      <div class="hero-row">
        <div class="object" :class="state">
          <Cover
            :book="book"
            :width="state === 'finished' ? 106 : 122"
            :lift="2"
            :tilt="state === 'finished' ? -3 : state === 'reading' ? 2.5 : -2"
          />
          <span v-if="state === 'reading'" class="ribbon" />
          <span v-if="state === 'reading'" class="sticker"><Icon name="bookmark" :size="12" filled />Day {{ day }}</span>
          <Stamp
            v-if="state === 'finished'"
            class="stamp"
            label="Finished"
            :date="stampDate(latest?.endedOn ?? null)"
            :rotate="-9"
          />
        </div>
        <div class="titles">
          <h1 class="title">{{ book.title }}</h1>
          <p class="author">{{ formatAuthors(book.authors) }}</p>
          <p class="meta">{{ meta }}</p>
          <div v-if="entry" class="status">
            <StatusTag :status="entry.status" />
            <Stars v-if="latest?.rating" :rating="latest.rating" :size="15" />
          </div>
          <p v-if="state === 'reading'" class="since">Since {{ formatDate(latest?.startedOn ?? null) }}</p>
          <div v-if="state === 'finished'" class="again">
            <Button tone="soft" small inline><Icon name="repeat" :size="18" />Read again</Button>
          </div>
        </div>
      </div>
    </div>

    <div class="content">
      <Button v-if="state === 'new'"><Icon name="plus" :size="20" />Add to Library</Button>
      <div v-else-if="state === 'reading'" class="pair">
        <Button><Icon name="stamp" :size="20" />Finish</Button>
        <Button tone="secondary" class="abandon"><Icon name="flag" :size="18" />Abandon</Button>
      </div>

      <section v-if="entry" class="block">
        <div class="block-head">
          <h2>Reading history</h2>
          <span class="hint">{{ entry.sessions.length }} {{ entry.sessions.length === 1 ? 'read' : 'reads' }}</span>
        </div>
        <LibraryCard :entry="entry" />
      </section>

      <section class="block">
        <div class="block-head"><h2>Collections</h2></div>
        <div class="tags">
          <Chip v-for="collection in collections" :key="collection.id" hole>{{ collection.name }}</Chip>
          <Chip dashed><Icon name="plus" :size="16" />Add to collection</Chip>
        </div>
      </section>

      <section v-if="book.description" class="block">
        <div class="block-head"><h2>About</h2></div>
        <p class="about" :class="{ full: state === 'new' }">{{ book.description }}</p>
      </section>

      <section v-if="state === 'new' && moreByAuthor.length" class="block">
        <div class="block-head">
          <h2>More by {{ surname }}</h2>
          <span class="hint">{{ moreByAuthor.filter((b) => b.owned).length }} in your Library</span>
        </div>
        <Plank :gap="14" :inset="10" class="more">
          <div v-for="item in moreByAuthor" :key="item.key" class="more-book">
            <Cover :book="item.book" :width="64" />
            <span v-if="item.owned" class="owned"><Icon name="check" :size="12" /></span>
          </div>
        </Plank>
      </section>
    </div>
  </div>
</template>

<style scoped>
.screen {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.hero {
  padding-bottom: 24px;
  border-radius: 0 0 36px 36px;
  background: var(--hero);
}

.hero-row {
  display: flex;
  gap: 22px;
  padding: 6px 20px 0 26px;
}

.object {
  position: relative;
  flex-shrink: 0;
}

.object :deep(.c-cover) {
  position: relative;
  z-index: 1;
}

.ribbon {
  position: absolute;
  bottom: -22px;
  left: 78px;
  z-index: 0;
  width: 12px;
  height: 40px;
  background: var(--c-accent);
  clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 80%, 0 100%);
  transform: rotate(4deg);
}

.sticker {
  position: absolute;
  top: -8px;
  right: -14px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 24px;
  padding: 0 8px 0 6px;
  border-radius: 7px;
  background: var(--c-accent);
  color: var(--c-accent-ink);
  font-size: 12.5px;
  font-weight: 800;
  transform: rotate(6deg);
  box-shadow: 0 3px 8px -3px rgb(var(--c-shadow) / 0.45);
}

.stamp {
  position: absolute;
  right: -30px;
  bottom: 18px;
  z-index: 2;
  background: color-mix(in srgb, var(--c-card) 82%, transparent);
}

.titles {
  display: flex;
  flex: 1;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
  min-width: 0;
}

.finished + .titles {
  padding-left: 10px;
}

.title {
  margin: 0;
  font-family: var(--c-serif);
  font-size: 25px;
  font-weight: 400;
  line-height: 1.12;
}

.author {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
}

.meta {
  margin: 0;
  font-size: 13.5px;
  color: var(--c-ink-soft);
}

.status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.since {
  margin: 0;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--c-ink-soft);
}

.content {
  display: flex;
  flex-direction: column;
  gap: 22px;
  padding: 22px 20px 0;
}

.pair {
  display: flex;
  gap: 12px;
}

.pair > :first-child {
  flex: 1;
}

.abandon {
  flex: 0 0 140px;
}

.block {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.block-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 800;
}

.hint {
  font-size: 14px;
  font-weight: 600;
  color: var(--c-ink-soft);
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.again {
  margin-top: 12px;
}

.more {
  margin: 4px -12px 0;
}

.more-book {
  position: relative;
}

.owned {
  position: absolute;
  top: -6px;
  right: -6px;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--c-teal);
  color: #fffaf2;
  box-shadow: 0 0 0 2px var(--c-paper);
}

.about.full {
  -webkit-line-clamp: 6;
}

.about {
  margin: 0;
  font-size: 15px;
  line-height: 1.45;
  color: var(--c-ink-soft);
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
