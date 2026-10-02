<script setup lang="ts">
// collections: every Collection as a small lit mosaic of its first covers,
// its name and size; "New collection" at the end and in the top bar.
import { useProto } from '../../../contract'
import Ambient from '../kit/Ambient.vue'
import Cover from '../kit/Cover.vue'
import Icon from '../kit/Icon.vue'
import TabBar from '../kit/TabBar.vue'
import TopBar from '../kit/TopBar.vue'

const proto = useProto()
const firsts = (collection: (typeof proto.value.data.collections)[number]) =>
  proto.value.data.collectionEntries(collection).slice(0, 4)
</script>

<template>
  <div class="page">
    <TopBar :trailing="['plus']" />
    <h1 class="title">Collections</h1>
    <p class="sub">Your own shelves. A book can sit on any number of them.</p>

    <div class="list">
      <article v-for="collection in proto.data.collections" :key="collection.id" class="item">
        <div class="mosaic">
          <Ambient :colors="firsts(collection)[0]!.book.coverColors" shape="card" />
          <template v-for="i in 4" :key="i">
            <Cover v-if="firsts(collection)[i - 1]" :book="firsts(collection)[i - 1]!.book" :width="40" />
            <span v-else class="empty-cell" />
          </template>
        </div>
        <div class="text">
          <span class="d-title name">{{ collection.name }}</span>
          <span class="count"
            ><span class="d-num">{{ collection.entryIds.length }}</span> books</span
          >
        </div>
        <Icon name="chevron" :size="16" :stroke="1.6" class="chev" />
      </article>

      <div class="item new">
        <span class="new-cell"><Icon name="plus" :size="22" /></span>
        <span class="new-label">New collection</span>
      </div>
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

.title {
  padding: 10px 20px 0;
  font-size: 28px;
  font-weight: 500;
  letter-spacing: -0.03em;
}

.sub {
  padding: 6px 20px 0;
  font-size: 13.5px;
  color: var(--d-ink-3);
}

.list {
  padding: 14px 20px 0;
}

.item {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 12px 0;
}

.item + .item {
  border-top: 0.5px solid var(--d-line);
}

.mosaic {
  position: relative;
  display: grid;
  width: 98px;
  flex-shrink: 0;
  grid-template-columns: 40px 40px;
  gap: 6px;
  padding: 6px;
  overflow: hidden;
  border-radius: 12px;
  background: var(--d-raised);
  box-shadow: inset 0 0 0 0.5px var(--d-line);
}

.empty-cell {
  position: relative;
  width: 40px;
  height: 60px;
  border-radius: 2.5px;
  box-shadow: inset 0 0 0 0.5px var(--d-line-2);
}

.text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 4px;
}

.name {
  font-size: calc(19px * var(--d-title-k));
  line-height: 1.15;
}

.count {
  font-size: 13px;
  color: var(--d-ink-3);
}

.chev {
  color: var(--d-ink-4);
}

.new {
  color: var(--d-ink-2);
}

.new-cell {
  display: flex;
  width: 98px;
  height: 64px;
  align-items: center;
  justify-content: center;
  border: 1px dashed var(--d-line-2);
  border-radius: 12px;
  color: var(--d-ink-3);
}

.new-label {
  font-size: 15px;
}
</style>
