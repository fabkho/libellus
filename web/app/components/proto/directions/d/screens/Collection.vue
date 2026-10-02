<script setup lang="ts">
// collection: Sci-fi in the Member's order. Numbered like a reading list, a
// grip on every row, one row lifted mid-drag; add, rename and delete live in
// the top bar.
import { computed } from 'vue'
import type { LibraryEntry, Status } from '../../../data'
import { formatAuthors, latestSession } from '../../../data'
import { useProto } from '../../../contract'
import Ambient from '../kit/Ambient.vue'
import Cover from '../kit/Cover.vue'
import Icon from '../kit/Icon.vue'
import Stars from '../kit/Stars.vue'
import TabBar from '../kit/TabBar.vue'
import TopBar from '../kit/TopBar.vue'

const proto = useProto()
const collection = computed(() => proto.value.data.openCollection)
const entries = computed(() => proto.value.data.collectionEntries(collection.value))
/** The row the finger is holding. */
const LIFTED = 2

const statusLabel: Record<Status, string> = {
  want_to_read: 'Want to read',
  reading: 'Reading',
  finished: 'Finished',
}
const rating = (entry: LibraryEntry) => latestSession(entry)?.rating ?? null
</script>

<template>
  <div class="page">
    <Ambient :colors="entries[0]!.book.coverColors" />
    <TopBar :trailing="['plus', 'more']" />

    <header class="head">
      <h1 class="title">{{ collection.name }}</h1>
      <p class="sub">
        <span class="d-num">{{ entries.length }}</span> books · your order · hold a row to move it
      </p>
    </header>

    <ol class="list">
      <li v-for="(entry, i) in entries" :key="entry.id" class="row" :class="{ lifted: i === LIFTED }">
        <span class="index d-mono">{{ String(i + 1).padStart(2, '0') }}</span>
        <Cover :book="entry.book" :width="34" />
        <div class="text">
          <span class="d-title name d-truncate">{{ entry.book.title }}</span>
          <span class="meta">
            <span class="d-truncate">{{ formatAuthors(entry.book.authors) }}</span>
            <span class="dot" />
            <Stars v-if="rating(entry)" :rating="rating(entry)" :size="9" :gap="1" :value="false" />
            <span v-else class="status" :class="entry.status">{{ statusLabel[entry.status] }}</span>
          </span>
        </div>
        <span class="grip"><Icon name="grip" :size="18" /></span>
      </li>
    </ol>

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
  position: relative;
  padding: 8px 20px 0;
}

.title {
  font-family: var(--d-title-font);
  font-size: calc(32px * var(--d-title-k));
  font-weight: var(--d-title-weight);
  line-height: 1.05;
  letter-spacing: var(--d-title-tracking);
}

.sub {
  margin-top: 6px;
  font-size: 13px;
  color: var(--d-ink-3);
}

.list {
  position: relative;
  margin: 12px 0 0;
  padding: 0 12px;
  list-style: none;
}

.row {
  position: relative;
  display: flex;
  height: 62px;
  align-items: center;
  gap: 12px;
  padding: 0 4px 0 8px;
  border-radius: 14px;
}

.row + .row::before {
  position: absolute;
  top: 0;
  right: 8px;
  left: 82px;
  height: 0.5px;
  content: '';
  background: var(--d-line);
}

.lifted {
  z-index: 2;
  background: var(--d-sheet);
  box-shadow:
    inset 0 0 0 0.5px var(--d-line-2),
    0 16px 34px rgb(0 0 0 / 0.55);
  margin: 6px 0;
  transform: scale(1.035);
}

.lifted::before,
.lifted + .row::before {
  display: none;
}

.index {
  width: 18px;
  font-size: 11px;
  color: var(--d-ink-4);
}

.lifted .index {
  color: var(--d-lamp);
}

.text {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 3px;
}

.name {
  font-size: calc(15px * var(--d-title-k));
  line-height: 1.2;
}

.meta {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--d-ink-3);
}

.dot {
  width: 2px;
  height: 2px;
  flex-shrink: 0;
  border-radius: 9px;
  background: currentColor;
}

.status {
  flex-shrink: 0;
  font-size: 12px;
}

.status.reading {
  color: var(--d-lamp);
}

.grip {
  display: flex;
  width: 44px;
  height: 44px;
  align-items: center;
  justify-content: center;
  color: var(--d-ink-4);
}

.lifted .grip {
  color: var(--d-ink);
}
</style>
