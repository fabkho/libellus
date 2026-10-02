<script setup lang="ts">
// library-want / library-reading / library-finished: the Library tab. A row
// into Collections, the Status segments with counts, then the books: a cover
// grid (covers keep their own ratio and stand on a common baseline), or, for
// the two books being read, larger rows with the start date and Finish.
import { computed } from 'vue'
import type { LibraryEntry, Status } from '../../../data'
import { formatAuthors, formatDate, latestSession } from '../../../data'
import { useProto } from '../../../contract'
import Cover from '../kit/Cover.vue'
import Icon from '../kit/Icon.vue'
import LargeTitle from '../kit/LargeTitle.vue'
import Pill from '../kit/Pill.vue'
import Segmented from '../kit/Segmented.vue'
import Stars from '../kit/Stars.vue'
import TabBar from '../kit/TabBar.vue'

const props = defineProps<{ status: Status }>()
const proto = useProto()

const data = computed(() => proto.value.data)
const entries = computed(() =>
  props.status === 'want_to_read'
    ? data.value.wantToRead
    : props.status === 'reading'
      ? data.value.reading
      : data.value.finished,
)
const segments = computed(() => [
  { value: 'want_to_read', label: 'Want to read', count: data.value.wantToRead.length },
  { value: 'reading', label: 'Reading', count: data.value.reading.length },
  { value: 'finished', label: 'Finished', count: data.value.finished.length },
])

/** The covers stacked on the Collections row: the first of each Collection. */
const collectionCovers = computed(() =>
  data.value.collections.map((c) => data.value.collectionEntries(c)[0]!.book),
)

const abandoned = (entry: LibraryEntry) => latestSession(entry)?.outcome === 'abandoned'
const DAY = 86_400_000
const dayOf = (entry: LibraryEntry) => {
  const started = latestSession(entry)?.startedOn
  return started ? Math.round((Date.parse(data.value.today) - Date.parse(started)) / DAY) + 1 : null
}
</script>

<template>
  <div class="screen">
    <LargeTitle title="Library" avatar />

    <div class="controls">
      <div class="collections-row ad-squircle" role="button">
        <span class="stack" aria-hidden="true">
          <span v-for="(book, i) in collectionCovers" :key="i" class="stack-item" :style="{ '--i': i }">
            <Cover :book="book" :height="42" shadow="flat" />
          </span>
        </span>
        <span class="row-text">
          <span class="row-title">Collections</span>
          <span class="row-sub">{{ data.collections.map((c) => c.name).join(', ') }}</span>
        </span>
        <span class="row-count ad-num">{{ data.collections.length }}</span>
        <Icon name="chevron" :size="17" :stroke="2.2" class="row-chev" />
      </div>

      <Segmented :options="segments" :value="status" />

      <div v-if="status === 'finished'" class="filters">
        <span class="filter on">All</span>
        <span class="filter"
          ><svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3 3 9" /></svg>Not
          finished <span class="ad-num faint">{{ data.notFinished.length }}</span></span
        >
        <span class="sort">Newest first</span>
      </div>
    </div>

    <!-- Currently reading: few books, so bigger rows with the start date and Finish. -->
    <div v-if="status === 'reading'" class="reading">
      <article v-for="entry in entries" :key="entry.id" class="reading-row ad-squircle">
        <Cover :book="entry.book" :height="132" />
        <div class="reading-text">
          <h3 class="ad-serif">{{ entry.book.title }}</h3>
          <p class="author">{{ formatAuthors(entry.book.authors) }}</p>
          <p class="meta ad-num">
            Started {{ formatDate(latestSession(entry)?.startedOn ?? null) }}<br />Day {{ dayOf(entry) }} ·
            {{ entry.book.pageCount }} pages
          </p>
          <Pill size="sm" icon="check" class="finish">Finish</Pill>
        </div>
      </article>
      <p class="hint">Finished one? Tap Finish, rate it, done.</p>
    </div>

    <div v-else class="grid">
      <article v-for="entry in entries" :key="entry.id" class="cell">
        <div class="cover-slot">
          <Cover :book="entry.book" :height="150" />
          <span v-if="abandoned(entry)" class="badge">Not finished</span>
          <span v-else-if="entry.sessions.length > 1" class="badge">
            <Icon name="again" :size="11" :stroke="2.6" />{{ entry.sessions.length }}×
          </span>
        </div>
        <p class="cell-title">{{ entry.book.title }}</p>
        <p class="cell-meta ad-num">
          <template v-if="status === 'want_to_read'">Added {{ formatDate(entry.addedOn, 'short') }}</template>
          <template v-else-if="abandoned(entry)">Stopped {{ formatDate(latestSession(entry)?.endedOn ?? null, 'short') }}</template>
          <template v-else>
            <Stars v-if="latestSession(entry)?.rating" :rating="latestSession(entry)!.rating" :size="10" :gap="0.5" />
            <span v-else class="unrated">Not rated</span>
          </template>
        </p>
        <p v-if="status === 'finished' && !abandoned(entry)" class="cell-meta sub ad-num">
          {{ formatDate(latestSession(entry)?.endedOn ?? null) }}
        </p>
      </article>
    </div>

    <TabBar active="library" />
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

.controls {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 20px 0;
}

.collections-row {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 60px;
  padding: 0 14px 0 12px;
  border-radius: 20px;
  background: var(--ad-card);
  box-shadow: var(--ad-card-shadow);
}

/* A deck: the first Collection's cover in front, the others peeking behind. */
.stack {
  position: relative;
  width: 44px;
  height: 46px;
}

.stack-item {
  position: absolute;
  bottom: 0;
  left: 2px;
  z-index: calc(3 - var(--i));
  opacity: calc(1 - var(--i) * 0.12);
  transform: translate(calc(var(--i) * 6px), calc(var(--i) * -2px)) scale(calc(1 - var(--i) * 0.09));
  transform-origin: bottom right;
}

.row-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  line-height: 1.25;
}

.row-title {
  font-size: 16px;
  font-weight: 600;
}

.row-sub {
  overflow: hidden;
  color: var(--ad-ink-2);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-count {
  color: var(--ad-ink-3);
  font-size: 15px;
}

.row-chev {
  color: var(--ad-ink-3);
}

.filters {
  display: flex;
  align-items: center;
  gap: 8px;
}

.filter {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 32px;
  padding: 0 13px;
  border-radius: 999px;
  box-shadow: inset 0 0 0 1px var(--ad-hair);
  color: var(--ad-ink-2);
  font-size: 13.5px;
  font-weight: 500;
}

.filter svg path {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
}

.filter.on {
  background: var(--ad-ink);
  box-shadow: none;
  color: var(--ad-paper);
}

.faint {
  color: var(--ad-ink-3);
}

.sort {
  margin-left: auto;
  color: var(--ad-ink-3);
  font-size: 13px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  column-gap: 16px;
  row-gap: 18px;
  padding: 18px 20px 0;
}

.cell {
  min-width: 0;
}

.cover-slot {
  position: relative;
  display: flex;
  align-items: flex-end;
  height: 150px;
}

.badge {
  position: absolute;
  right: 4px;
  bottom: 5px;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 19px;
  padding: 0 6px;
  border-radius: 999px;
  background: rgb(29 27 24 / 0.78);
  color: #fff;
  font-size: 10.5px;
  font-weight: 600;
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
}

.cell-title {
  margin: 8px 0 0;
  overflow: hidden;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cell-meta {
  display: flex;
  align-items: center;
  min-height: 16px;
  margin: 2px 0 0;
  color: var(--ad-ink-2);
  font-size: 12px;
}

.cell-meta.sub {
  margin-top: 1px;
  color: var(--ad-ink-3);
}

.cell-meta :deep(.value) {
  font-size: 11.5px !important;
}

.unrated {
  color: var(--ad-ink-3);
}

.reading {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 18px 20px 0;
}

.reading-row {
  display: flex;
  gap: 16px;
  padding: 14px;
  border-radius: 24px;
  background: var(--ad-card);
  box-shadow: var(--ad-card-shadow);
}

.reading-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

h3 {
  margin: 2px 0 0;
  font-size: 20px;
  font-weight: 600;
  line-height: 1.15;
}

.author {
  margin: 2px 0 0;
  color: var(--ad-ink-2);
  font-size: 14.5px;
}

.meta {
  margin: 8px 0 0;
  color: var(--ad-ink-3);
  font-size: 13px;
  line-height: 1.4;
}

.finish {
  align-self: flex-start;
  margin-top: auto;
}

.hint {
  margin: 10px 0 0;
  color: var(--ad-ink-3);
  font-size: 13px;
  text-align: center;
}
</style>
