<script setup lang="ts">
// library-want / library-reading / library-finished: the Library tab. The way
// into Collections, the three Status tabs with their counts, then the entries.
// Finished is grouped by year and has the *Not finished* filter; abandoned
// reads sit dimmed among them, re-reads say so.
import { computed } from 'vue'
import type { LibraryEntry, Status } from '../../../data'
import { formatAuthors, formatDate, latestSession } from '../../../data'
import { useProto } from '../../../contract'
import Ambient from '../kit/Ambient.vue'
import Avatar from '../kit/Avatar.vue'
import Button from '../kit/Button.vue'
import Cover from '../kit/Cover.vue'
import Icon from '../kit/Icon.vue'
import Stars from '../kit/Stars.vue'
import TabBar from '../kit/TabBar.vue'
import { daysBetween } from '../kit/night'

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
const tabs = computed(() => [
  { value: 'want_to_read', label: 'Want to read', count: data.value.wantToRead.length },
  { value: 'reading', label: 'Reading', count: data.value.reading.length },
  { value: 'finished', label: 'Finished', count: data.value.finished.length },
])
/** Finished, by the year of the latest end date. */
const years = computed(() => {
  const groups: { year: string; entries: LibraryEntry[] }[] = []
  for (const entry of data.value.finished) {
    const year = latestSession(entry)?.endedOn?.slice(0, 4) ?? '—'
    const group = groups.at(-1)
    if (group?.year === year) group.entries.push(entry)
    else groups.push({ year, entries: [entry] })
  }
  return groups
})
const stack = computed(() => data.value.collections.map((c) => data.value.collectionEntries(c)[0]!.book))
const abandoned = (entry: LibraryEntry) => latestSession(entry)?.outcome === 'abandoned'
</script>

<template>
  <div class="page">
    <header class="head">
      <h1 class="title">Library</h1>
      <Avatar />
    </header>

    <div class="collections">
      <span class="fan" aria-hidden="true">
        <Cover v-for="(book, i) in stack" :key="book.id" :book="book" :width="22" :class="`fan-${i}`" />
      </span>
      <span class="collections-label">Collections</span>
      <span class="collections-count d-num">{{ data.collections.length }}</span>
      <Icon name="chevron" :size="15" :stroke="1.7" class="chev" />
    </div>

    <nav class="tabs">
      <span v-for="tab in tabs" :key="tab.value" class="tab" :class="{ on: tab.value === status }">
        {{ tab.label }}<span class="tab-count d-num">{{ tab.count }}</span>
      </span>
    </nav>

    <div v-if="status === 'finished'" class="filters">
      <span class="filter on">All <span class="d-num">{{ data.finished.length }}</span></span>
      <span class="filter"><Icon name="slash" :size="13" />Not finished <span class="d-num">{{ data.notFinished.length }}</span></span>
    </div>

    <!-- Currently reading: few books, so each gets room and its cover's light. -->
    <div v-if="status === 'reading'" class="reading">
      <article v-for="entry in entries" :key="entry.id" class="lit">
        <Ambient :colors="entry.book.coverColors" shape="card" />
        <Cover :book="entry.book" :width="64" halo />
        <div class="text">
          <span class="d-title name">{{ entry.book.title }}</span>
          <span class="author">{{ formatAuthors(entry.book.authors) }}</span>
          <span class="meta d-mono"
            >Since {{ formatDate(latestSession(entry)?.startedOn ?? null, 'short') }} · day
            {{ daysBetween(latestSession(entry)?.startedOn ?? null) }}</span
          >
        </div>
        <Button size="sm" tone="quiet" class="finish">Finish</Button>
      </article>

      <div class="next">
        <div class="next-head">
          <span class="d-eyebrow">Start next</span>
          <span class="d-eyebrow faint">from Want to read</span>
        </div>
        <div class="next-row">
          <Cover v-for="entry in data.upNext.slice(0, 4)" :key="entry.id" :book="entry.book" :width="68" />
        </div>
      </div>
    </div>

    <div v-else-if="status === 'want_to_read'" class="list">
      <div v-for="entry in entries" :key="entry.id" class="row">
        <Cover :book="entry.book" :width="40" />
        <div class="text">
          <span class="d-title name d-truncate">{{ entry.book.title }}</span>
          <span class="author d-truncate">{{ formatAuthors(entry.book.authors) }}</span>
          <span class="meta d-mono">
            Added {{ formatDate(entry.addedOn, 'short') }}
            <template v-if="entry.book.source === 'manual'"
              ><span class="dot" /><Icon name="lock" :size="11" :stroke="1.6" />Private</template
            >
          </span>
        </div>
      </div>
    </div>

    <div v-else class="list">
      <template v-for="group in years" :key="group.year">
        <div class="year">
          <span class="d-eyebrow">{{ group.year }}</span>
          <span class="d-eyebrow faint">{{ group.entries.length }}</span>
        </div>
        <div v-for="entry in group.entries" :key="entry.id" class="row" :class="{ dnf: abandoned(entry) }">
          <Cover :book="entry.book" :width="40" />
          <div class="text">
            <span class="d-title name d-truncate">{{ entry.book.title }}</span>
            <span class="author d-truncate">{{ formatAuthors(entry.book.authors) }}</span>
            <span v-if="abandoned(entry)" class="meta d-mono">
              <Icon name="slash" :size="11" :stroke="1.6" />Not finished · {{ formatDate(latestSession(entry)?.endedOn ?? null, 'short') }}
            </span>
            <span v-else class="meta d-mono">
              <Stars v-if="latestSession(entry)?.rating" :rating="latestSession(entry)!.rating" :size="10" :gap="1" />
              <span v-else class="unrated">Not rated</span>
              <span class="dot" />{{ formatDate(latestSession(entry)?.endedOn ?? null, 'short') }}
              <template v-if="entry.sessions.length > 1"
                ><span class="dot" /><Icon name="repeat" :size="11" :stroke="1.6" />{{ entry.sessions.length }}×</template
              >
            </span>
          </div>
        </div>
      </template>
    </div>

    <TabBar active="library" />
  </div>
</template>

<style scoped>
.page {
  position: relative;
  height: 100%;
  overflow: hidden;
  background: var(--d-bg);
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: calc(var(--safe-top) + 10px) 20px 0;
}

.title {
  font-size: 28px;
  font-weight: 500;
  letter-spacing: -0.03em;
}

.collections {
  display: flex;
  height: 54px;
  margin: 12px 16px 0;
  align-items: center;
  gap: 12px;
  padding: 0 14px 0 12px;
  border-radius: 14px;
  background: var(--d-fill);
  box-shadow: inset 0 0 0 0.5px var(--d-line);
}

.fan {
  position: relative;
  width: 38px;
  height: 33px;
}

.fan > * {
  position: absolute;
  bottom: 0;
}

.fan-0 {
  left: 0;
  z-index: 3;
}

.fan-1 {
  left: 8px;
  z-index: 2;
  opacity: 0.8;
  transform: scale(0.9);
  transform-origin: 100% 100%;
}

.fan-2 {
  left: 16px;
  z-index: 1;
  opacity: 0.6;
  transform: scale(0.8);
  transform-origin: 100% 100%;
}

.collections-label {
  flex: 1;
  font-size: 15.5px;
}

.collections-count {
  font-size: 14px;
  color: var(--d-ink-3);
}

.chev {
  color: var(--d-ink-4);
}

.tabs {
  display: flex;
  gap: 22px;
  margin: 16px 20px 0;
  border-bottom: 0.5px solid var(--d-line-2);
}

.tab {
  position: relative;
  display: flex;
  height: 42px;
  align-items: center;
  gap: 6px;
  font-size: 14.5px;
  color: var(--d-ink-3);
}

.tab.on {
  color: var(--d-ink);
}

.tab.on::after {
  position: absolute;
  right: 0;
  bottom: -0.5px;
  left: 0;
  height: 1.5px;
  content: '';
  background: var(--d-lamp);
  box-shadow: 0 0 8px rgb(239 183 104 / 0.6);
}

.tab-count {
  font-size: 12px;
  color: var(--d-ink-4);
}

.on .tab-count {
  color: var(--d-lamp);
}

.filters {
  display: flex;
  gap: 8px;
  padding: 12px 20px 0;
}

.filter {
  display: inline-flex;
  height: 30px;
  align-items: center;
  gap: 5px;
  padding: 0 12px;
  border-radius: 999px;
  box-shadow: inset 0 0 0 0.5px var(--d-line-2);
  font-size: 13px;
  color: var(--d-ink-2);
}

.filter .d-num {
  color: var(--d-ink-3);
}

.filter.on {
  background: var(--d-ink);
  box-shadow: none;
  color: var(--d-on-ink);
}

.filter.on .d-num {
  color: var(--d-on-ink);
  opacity: 0.55;
}

.list {
  padding: 4px 20px 0;
}

.year {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 0 4px;
}

.faint {
  color: var(--d-ink-4);
}

.row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 9px 0;
}

.row + .row {
  border-top: 0.5px solid var(--d-line);
}

.text {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}

.name {
  font-size: calc(15.5px * var(--d-title-k));
  line-height: 1.2;
}

.author {
  font-size: 13px;
  color: var(--d-ink-2);
}

.meta {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 3px;
  font-size: 11px;
  color: var(--d-ink-3);
}

.dot {
  width: 2px;
  height: 2px;
  margin: 0 2px;
  border-radius: 9px;
  background: currentColor;
}

.unrated {
  color: var(--d-ink-4);
}

.dnf :deep(.k-cover) {
  opacity: 0.45;
  filter: grayscale(0.6);
}

.dnf .name,
.dnf .author {
  color: var(--d-ink-3);
}

.reading {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px 16px 0;
}

.lit {
  position: relative;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px;
  overflow: hidden;
  border-radius: 18px;
  background: var(--d-raised);
  box-shadow: inset 0 0 0 0.5px var(--d-line);
}

.lit .text {
  position: relative;
}

.lit .name {
  font-size: calc(17px * var(--d-title-k));
}

.finish {
  position: relative;
  align-self: flex-end;
}

.next {
  margin-top: 18px;
  padding: 0 4px;
}

.next-head {
  display: flex;
  justify-content: space-between;
  margin-bottom: 12px;
}

.next-row {
  display: flex;
  gap: 14px;
}

.foot {
  margin-top: 8px;
  padding: 0 24px;
  text-align: center;
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--d-ink-3);
}
</style>
