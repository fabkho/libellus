<script setup lang="ts">
// collection: Sci-fi, in the Member's order. The order is the point, so each
// book is numbered with a display figure; a handle on every row drags it to a
// new place (the third row is shown lifted, mid-drag). Add and the ⋯ menu
// (Rename, Delete) sit in the running head.
import { computed } from 'vue'
import type { LibraryEntry } from '../../../data'
import { latestSession } from '../../../data'
import { useProto } from '../../../contract'
import Icon from '../kit/Icon.vue'
import IconButton from '../kit/IconButton.vue'
import IndexRow from '../kit/IndexRow.vue'
import Rating from '../kit/Rating.vue'
import RunningHead from '../kit/RunningHead.vue'
import TabBar from '../kit/TabBar.vue'

const proto = useProto()
const collection = computed(() => proto.value.data.openCollection)
const entries = computed(() => proto.value.data.collectionEntries(collection.value))

const statusLabel = (entry: LibraryEntry) =>
  entry.status === 'want_to_read' ? 'Want to read' : entry.status === 'reading' ? 'Reading' : null
</script>

<template>
  <div class="collection">
    <RunningHead back="Collections">
      <template #trailing>
        <IconButton name="plus" />
        <IconButton name="more" />
      </template>
    </RunningHead>

    <header class="intro">
      <h1 class="b-display heading">{{ collection.name }}</h1>
      <p class="b-italic b-muted">{{ entries.length }} books, in your order. Drag a handle to rearrange.</p>
      <hr class="b-rule-ink" />
    </header>

    <div class="list">
      <IndexRow
        v-for="(entry, i) in entries"
        :key="entry.id"
        :book="entry.book"
        :number="String(i + 1)"
        ordinal
        :class="{ lifted: i === 2 }"
      >
        <template #aside>
          <span v-if="statusLabel(entry)" class="state b-label">{{ statusLabel(entry) }}</span>
          <Rating v-else :rating="latestSession(entry)?.rating ?? null" :size="17" figure-only />
        </template>
        <template #trailing>
          <span class="handle"><Icon name="drag" :size="20" :stroke="1.3" /></span>
        </template>
      </IndexRow>
    </div>

    <TabBar active="library" />
  </div>
</template>

<style scoped>
.collection {
  position: relative;
  height: 100%;
  overflow: hidden;
}

.intro {
  padding: 0 var(--b-margin);
}

.heading {
  --size: 46;
  margin: 0;
}

.intro p {
  margin: 6px 0 12px;
  font-size: 16px;
  line-height: 20px;
}

hr {
  margin: 0;
}

.list {
  padding: 0 var(--b-margin);
}

.list :deep(.row) {
  align-items: center;
  padding: 8px 0;
}

.list :deep(.number) {
  align-self: center;
}

.state {
  font-size: 9.5px;
  color: var(--b-ink-3);
}

.handle {
  display: flex;
  width: 44px;
  height: 44px;
  align-items: center;
  justify-content: flex-end;
  margin-left: -8px;
  color: var(--b-ink-3);
}

/* The row under the finger: lifted off the page by a hairline frame and a
   short shadow, a few points out of line, its handle in ink. */
.list :deep(.row.lifted) {
  position: relative;
  z-index: 2;
  margin: 0 -12px;
  padding: 8px 12px;
  border: 1px solid var(--b-ink);
  background: var(--b-paper);
  box-shadow: 0 8px 20px rgb(20 16 12 / 0.14);
  transform: translateY(-14px) rotate(-0.6deg);
}

.list :deep(.row.lifted) .handle {
  color: var(--b-ink);
}
</style>
