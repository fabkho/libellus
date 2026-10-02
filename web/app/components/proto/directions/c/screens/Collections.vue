<script setup lang="ts">
// collections: each Collection as a card with its first covers fanned out
// like books pulled off the shelf, the book count, and a strip of spine
// colours for every book inside. "New collection" is a dashed empty card.
import { computed } from 'vue'
import Cover from '../kit/Cover.vue'
import Icon from '../kit/Icon.vue'
import NavBar from '../kit/NavBar.vue'
import TabBar from '../kit/TabBar.vue'
import { paint, thickness } from '../kit/paint'
import { useShelf } from '../kit/useShelf'

const { data, palette } = useShelf()

const cards = computed(() =>
  data.value.collections.map((collection) => {
    const entries = data.value.collectionEntries(collection)
    return {
      collection,
      covers: entries.slice(0, 3).map((e) => e.book),
      spines: entries.map((e) => ({
        id: e.id,
        color: paint(e.book, palette.value).bg,
        width: Math.round(thickness(e.book.pageCount) / 4),
      })),
      finished: entries.filter((e) => e.status === 'finished').length,
    }
  }),
)
const fan = [
  { tilt: -9, x: 0, y: 6 },
  { tilt: 0, x: 26, y: 0 },
  { tilt: 8, x: 52, y: 6 },
]
</script>

<template>
  <div class="screen c-paper-grain">
    <NavBar title="Collections" back="Library">
      <template #trailing><span class="round"><Icon name="plus" /></span></template>
    </NavBar>
    <p class="sub">Your own shelves. A book can sit on as many as you like.</p>

    <div class="list">
      <article v-for="card in cards" :key="card.collection.id" class="card">
        <div class="fan" aria-hidden="true">
          <span
            v-for="(book, i) in card.covers"
            :key="book.id"
            class="fan-book"
            :style="{ transform: `translate(${fan[i]!.x}px, ${fan[i]!.y}px) rotate(${fan[i]!.tilt}deg)`, zIndex: i === 1 ? 3 : 1 }"
          >
            <Cover :book="book" :width="56" />
          </span>
        </div>
        <div class="info">
          <h2>{{ card.collection.name }}</h2>
          <span class="count">{{ card.collection.entryIds.length }} books · {{ card.finished }} finished</span>
          <span class="strip" aria-hidden="true">
            <span v-for="s in card.spines" :key="s.id" :style="{ background: s.color, width: `${s.width}px` }" />
          </span>
        </div>
        <Icon name="chevron" :size="18" class="chev" />
      </article>

      <div class="new">
        <span class="new-icon"><Icon name="plus" :size="22" /></span>
        <span class="new-text">
          <b>New collection</b>
          Gifts, a summer stack, a book club…
        </span>
      </div>
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

.sub {
  margin: 0;
  padding: 0 20px 14px;
  font-size: 15px;
  color: var(--c-ink-soft);
}

.list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 4px 20px 0;
}

.card {
  display: flex;
  align-items: center;
  gap: 14px;
  height: 128px;
  padding: 0 14px 0 12px;
  border-radius: 24px;
  background: var(--c-card);
  box-shadow:
    0 0 0 1px var(--c-line),
    0 6px 14px -10px rgb(var(--c-shadow) / 0.3);
}

.fan {
  position: relative;
  flex-shrink: 0;
  width: 116px;
  height: 96px;
}

.fan-book {
  position: absolute;
  top: 4px;
  left: 4px;
  transform-origin: bottom center;
}

.info {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

h2 {
  margin: 0;
  font-family: var(--c-serif);
  font-size: 22px;
  font-weight: 400;
}

.count {
  font-size: 14px;
  font-weight: 600;
  color: var(--c-ink-soft);
}

.strip {
  display: flex;
  align-items: flex-end;
  gap: 1px;
  height: 18px;
  margin-top: 8px;
  padding: 0 2px;
  border-bottom: 3px solid var(--c-wood);
}

.strip span {
  display: block;
  height: 100%;
  min-width: 4px;
  border-radius: 1.5px 1.5px 0 0;
}

.strip span:nth-child(3n + 2) {
  height: 84%;
}

.strip span:nth-child(4n + 3) {
  height: 92%;
}

.chev {
  flex-shrink: 0;
  color: var(--c-muted);
}

.new {
  display: flex;
  align-items: center;
  gap: 16px;
  height: 92px;
  padding: 0 18px;
  border-radius: 24px;
  outline: 2px dashed var(--c-line-strong);
  outline-offset: -2px;
}

.new-icon {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: 16px;
  background: var(--c-mustard-soft);
  color: var(--c-ink);
}

.new-text {
  display: flex;
  flex-direction: column;
  font-size: 14px;
  color: var(--c-ink-soft);
}

.new-text b {
  font-size: 17px;
  color: var(--c-ink);
}
</style>
