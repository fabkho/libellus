<script setup lang="ts">
// home: the books on the go as big tilted cards with a ribbon bookmark and
// a day count, the year's pile of finished books ("Read in 2026"), and Up
// next on a little shelf — face-out first book, spines after it (or covers /
// a pile, by the Shelf toggle).
import { computed } from 'vue'
import { formatAuthors, formatDate, latestSession } from '../../../data'
import Button from '../kit/Button.vue'
import Cover from '../kit/Cover.vue'
import Icon from '../kit/Icon.vue'
import LyingBook from '../kit/LyingBook.vue'
import NavBar from '../kit/NavBar.vue'
import Plank from '../kit/Plank.vue'
import Spine from '../kit/Spine.vue'
import TabBar from '../kit/TabBar.vue'
import { daysBetween, paint, wash } from '../kit/paint'
import { useShelf } from '../kit/useShelf'

const { data, palette, view } = useShelf()

const cards = computed(() =>
  data.value.reading.map((entry) => {
    const started = latestSession(entry)?.startedOn ?? null
    return {
      entry,
      started,
      day: started ? daysBetween(started, data.value.today) + 1 : null,
      wash: wash(entry.book, palette.value),
    }
  }),
)

/** The year's pile: one slim book per finish, coloured from the books really finished. */
const pile = computed(() => {
  const books = data.value.finished.filter((e) => latestSession(e)?.outcome === 'finished').map((e) => e.book)
  return Array.from({ length: data.value.readInYear.count }, (_, i) => {
    const book = books[i % books.length]!
    return { key: i, color: paint(book, palette.value).bg, width: 58 + ((i * 37) % 5) * 5, shift: ((i * 7) % 5) - 2 }
  })
})

const upNext = computed(() => data.value.upNext)
const weekday = computed(() =>
  new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
    new Date(`${data.value.today}T12:00:00Z`),
  ),
)
</script>

<template>
  <div class="screen c1-paper-grain">
    <NavBar :kicker="weekday" :title="`Hi, ${data.member.firstName}`" avatar />

    <section class="reading">
      <div class="section-head">
        <h2>Currently reading</h2>
        <span class="count">{{ cards.length }}</span>
      </div>
      <div class="carousel">
        <article v-for="(card, i) in cards" :key="card.entry.id" class="card" :style="{ '--wash': card.wash }">
          <div class="cover-slot">
            <Cover :book="card.entry.book" :width="96" :lift="2" />
            <span class="ribbon" />
          </div>
          <div class="card-body">
            <h3 class="title">{{ card.entry.book.title }}</h3>
            <p class="author">{{ formatAuthors(card.entry.book.authors) }}</p>
            <p class="since"><span class="day">Day {{ card.day }}</span> · since {{ formatDate(card.started, 'short') }}</p>
            <div class="actions">
              <Button small inline><Icon name="check" :size="17" />Finish</Button>
            </div>
          </div>
        </article>
      </div>
    </section>

    <section class="year">
      <div class="pile" aria-hidden="true">
        <span
          v-for="book in pile"
          :key="book.key"
          class="slim"
          :style="{ background: book.color, width: `${book.width}px`, transform: `translateX(${book.shift}px)` }"
        />
      </div>
      <div class="year-text">
        <span class="year-label">Read in {{ data.readInYear.year }}</span>
        <span class="year-count">{{ data.readInYear.count }}<small> books</small></span>
        <span class="year-note">Last one: {{ data.finished[0]!.book.title }}</span>
      </div>
      <Icon name="chevron" :size="18" class="year-chevron" />
    </section>

    <section class="next">
      <div class="section-head">
        <h2>Up next</h2>
        <span class="see-all">See all</span>
      </div>

      <Plank v-if="view === 'spines'" :gap="3" :inset="20">
        <Cover :book="upNext[0]!.book" :width="86" :lift="1" class="face-out" />
        <Spine
          v-for="(entry, i) in upNext.slice(1)"
          :key="entry.id"
          :book="entry.book"
          :scale="0.8"
          :lean="i === upNext.length - 2 ? -9 : 0"
        />
      </Plank>

      <Plank v-else-if="view === 'covers'" :gap="12" :inset="18">
        <Cover v-for="entry in upNext" :key="entry.id" :book="entry.book" :width="70" />
      </Plank>

      <div v-else class="next-pile">
        <LyingBook
          v-for="entry in upNext.slice(0, 4)"
          :key="entry.id"
          :book="entry.book"
          :height="27"
          :length="300"
          :jitter="14"
          compact
        />
        <span class="pile-base c1-wood" />
      </div>
    </section>

    <TabBar active="home" />
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

.section-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 0 20px 10px;
}

h2 {
  margin: 0;
  font-family: var(--c1-serif);
  font-size: 21px;
  font-weight: var(--c1-serif-weight);
  letter-spacing: -0.01em;
}

.count {
  font-size: 14px;
  font-weight: 500;
  color: var(--c1-muted);
}

.see-all {
  margin-left: auto;
  font-size: 15px;
  font-weight: 500;
  color: var(--c1-accent-deep);
}

[data-theme='dark'] .see-all {
  color: var(--c1-accent);
}

/* --- Currently reading ------------------------------------------------ */

.reading {
  padding-top: 14px;
}

.carousel {
  display: flex;
  gap: 12px;
  margin-bottom: -24px;
  padding: 0 20px 24px;
  overflow: hidden;
}

.card {
  position: relative;
  display: flex;
  flex: 0 0 306px;
  gap: 18px;
  height: 180px;
  padding: 18px 18px 18px 20px;
  border-radius: 24px;
  background: linear-gradient(140deg, var(--wash), color-mix(in srgb, var(--wash) 45%, var(--c1-card)));
  box-shadow: var(--c1-card-shadow);
}

.cover-slot {
  position: relative;
  align-self: center;
  margin-top: -4px;
}

.cover-slot :deep(.c-cover) {
  position: relative;
  z-index: 1;
}

/* Ribbon bookmark hanging out of the book's foot. */
.ribbon {
  position: absolute;
  bottom: -16px;
  left: 26px;
  z-index: 0;
  width: 9px;
  height: 30px;
  background: var(--c1-accent);
  clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 82%, 0 100%);
}

.ribbon.right {
  left: auto;
  right: 26px;
  transform: rotate(5deg);
}

.card-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.meta-row {
  display: flex;
  align-items: center;
  gap: 7px;
}

.day {
  font-weight: 600;
  color: var(--c1-accent-deep);
}

[data-theme='dark'] .day {
  color: var(--c1-accent);
}

.title {
  margin: 6px 0 0;
  padding-bottom: 2px;
  font-family: var(--c1-serif);
  font-size: 21px;
  font-weight: var(--c1-serif-weight);
  line-height: 1.16;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.author {
  margin: 4px 0 0;
  font-size: 15px;
  font-weight: 500;
  color: var(--c1-ink-soft);
}

.since {
  margin: 3px 0 0;
  font-size: 13px;
  font-weight: 500;
  color: var(--c1-ink-soft);
  white-space: nowrap;
}

.actions {
  margin-top: auto;
}

/* --- Read in 2026 ------------------------------------------------------ */

.year {
  display: flex;
  align-items: center;
  gap: 18px;
  margin: 20px 20px 0;
  padding: 12px 16px 12px 18px;
  border-radius: 22px;
  background: var(--c1-card);
  box-shadow: var(--c1-card-shadow);
}

.pile {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 84px;
}

.slim {
  display: block;
  height: 4px;
  margin-top: 1px;
  border-radius: 2px 1.5px 1.5px 2px;
  box-shadow: inset 0 -1px 0 rgb(0 0 0 / 0.16);
}

.year-text {
  display: flex;
  flex: 1;
  flex-direction: column;
}

.year-label {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--c1-ink-soft);
}

.year-count {
  font-family: var(--c1-serif);
  font-weight: var(--c1-serif-weight);
  font-size: 36px;
  line-height: 1.05;
}

.year-count small {
  font-family: var(--c1-sans);
  font-size: 16px;
  font-weight: 500;
  color: var(--c1-ink-soft);
}

.year-note {
  font-size: 13px;
  color: var(--c1-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 190px;
}

.year-chevron {
  color: var(--c1-muted);
}

/* --- Up next ----------------------------------------------------------- */

.next {
  margin-top: 20px;
}

.face-out {
  margin-right: 6px;
}

.next-pile {
  display: flex;
  flex-direction: column;
  padding: 0 20px;
}

.pile-base {
  height: 10px;
  margin-top: 1px;
  border-radius: 4px;
}
</style>
