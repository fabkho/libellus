<script setup lang="ts">
// collections: every Collection as a card with a mosaic of its first covers on
// a field tinted by the first one, the name and the size; "New collection".
import { computed } from 'vue'
import { useProto } from '../../../contract'
import Cover from '../kit/Cover.vue'
import Icon from '../kit/Icon.vue'
import RoundButton from '../kit/RoundButton.vue'
import TabBar from '../kit/TabBar.vue'
import TopBar from '../kit/TopBar.vue'

const proto = useProto()
const data = computed(() => proto.value.data)
const cards = computed(() =>
  data.value.collections.map((collection) => {
    const entries = data.value.collectionEntries(collection)
    return { collection, books: entries.slice(0, 4).map((e) => e.book), tint: entries[0]!.book.coverColors }
  }),
)
const total = computed(() => new Set(data.value.collections.flatMap((c) => c.entryIds)).size)
</script>

<template>
  <div class="screen">
    <TopBar><RoundButton icon="plus" label="New collection" /></TopBar>

    <header class="head">
      <h1 class="ad-serif">Collections</h1>
      <p class="ad-num">{{ data.collections.length }} collections · {{ total }} books</p>
    </header>

    <div class="list">
      <article v-for="card in cards" :key="card.collection.id" class="card ad-squircle">
        <div
          class="mosaic"
          :style="{ '--d': card.tint?.dominant ?? '#d8c8ad', '--s': card.tint?.secondary ?? '#9fb0a4' }"
        >
          <Cover v-for="book in card.books" :key="book.id" :book="book" :height="96" />
          <span v-for="n in 4 - card.books.length" :key="`empty-${n}`" class="empty-slot" />
        </div>
        <div class="foot">
          <span class="name ad-serif">{{ card.collection.name }}</span>
          <span class="count ad-num">{{ card.collection.entryIds.length }} books</span>
          <Icon name="chevron" :size="17" :stroke="2.2" class="chev" />
        </div>
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

.head {
  padding: calc(var(--safe-top) + 58px) 20px 0;
}

h1 {
  margin: 0;
  font-size: 34px;
  font-weight: 600;
  line-height: 1.05;
}

.head p {
  margin: 4px 0 0;
  color: var(--ad-ink-2);
  font-size: 14px;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px 20px 0;
}

.card {
  overflow: hidden;
  border-radius: 24px;
  background: var(--ad-card);
  box-shadow: var(--ad-card-shadow);
}

.mosaic {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  height: 120px;
  padding: 0 16px 14px;
  background:
    radial-gradient(80% 120% at 0% 0%, color-mix(in oklab, var(--d) 30%, var(--ad-card)), transparent 70%),
    radial-gradient(70% 120% at 100% 0%, color-mix(in oklab, var(--s) 26%, var(--ad-card)), transparent 70%),
    color-mix(in oklab, var(--d) 10%, var(--ad-card));
}

.empty-slot {
  width: 64px;
  height: 96px;
  border-radius: 3.5px;
  box-shadow: inset 0 0 0 1px var(--ad-hair);
  background: rgb(var(--ad-tint) / 0.04);
}

.foot {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 11px 16px 12px;
}

.name {
  font-size: 19px;
  font-weight: 600;
}

.count {
  color: var(--ad-ink-2);
  font-size: 14px;
}

.chev {
  align-self: center;
  margin-left: auto;
  color: var(--ad-ink-3);
}
</style>
