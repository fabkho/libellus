<script setup lang="ts">
// collection: one Collection's books in the Member's order. Grips on every
// row to reorder; + adds books; the … menu (shown open) renames or deletes.
import { computed } from 'vue'
import { formatAuthors, formatDate, latestSession } from '../../../data'
import { useProto } from '../../../contract'
import Cover from '../kit/Cover.vue'
import Icon from '../kit/Icon.vue'
import RoundButton from '../kit/RoundButton.vue'
import StatusTag from '../kit/StatusTag.vue'
import Stars from '../kit/Stars.vue'
import TabBar from '../kit/TabBar.vue'
import TopBar from '../kit/TopBar.vue'

const proto = useProto()
const collection = computed(() => proto.value.data.openCollection)
const entries = computed(() => proto.value.data.collectionEntries(collection.value))
</script>

<template>
  <div class="screen">
    <TopBar>
      <RoundButton icon="plus" />
      <RoundButton icon="more" />
    </TopBar>

    <!-- The … menu, open: frosted, anchored under its button. -->
    <div class="menu ad-glass ad-squircle" role="menu">
      <span class="item" role="menuitem">Rename<Icon name="pencil" :size="19" /></span>
      <span class="item" role="menuitem">Reorder books<Icon name="reorder" :size="19" /></span>
      <span class="item" role="menuitem">Add books<Icon name="plus" :size="19" /></span>
      <span class="divider" />
      <span class="item danger" role="menuitem">Delete collection<Icon name="trash" :size="19" /></span>
    </div>

    <header class="head">
      <h1 class="ad-serif">{{ collection.name }}</h1>
      <p class="ad-num">{{ entries.length }} books · in your order</p>
    </header>

    <ol class="list">
      <li v-for="(entry, i) in entries" :key="entry.id" class="row">
        <span class="pos ad-num">{{ i + 1 }}</span>
        <Cover :book="entry.book" :height="62" />
        <div class="text">
          <span class="title ad-serif">{{ entry.book.title }}</span>
          <span class="author">{{ formatAuthors(entry.book.authors) }}</span>
          <span class="meta">
            <Stars
              v-if="entry.status === 'finished' && latestSession(entry)?.rating"
              :rating="latestSession(entry)!.rating"
              :size="10"
              :gap="0.5"
            />
            <StatusTag v-else :status="entry.status" short class="mini" />
            <span v-if="entry.status === 'finished'" class="when ad-num">{{
              formatDate(latestSession(entry)?.endedOn ?? null, 'month')
            }}</span>
          </span>
        </div>
        <span class="grip" aria-label="Drag to reorder"><Icon name="grip" :size="20" :stroke="1.8" /></span>
      </li>
    </ol>

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
  margin: 10px 0 0;
  padding: 0 0 0 20px;
  list-style: none;
}

.row {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 80px;
  padding-right: 12px;
}

.row + .row .text,
.row + .row .grip {
  box-shadow: 0 -0.5px 0 var(--ad-hair);
}

.pos {
  width: 16px;
  color: var(--ad-ink-3);
  font-size: 13px;
  font-weight: 600;
  text-align: center;
}

.text {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-self: stretch;
  justify-content: center;
  min-width: 0;
  line-height: 1.3;
}

.title {
  overflow: hidden;
  font-size: 16.5px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.author {
  overflow: hidden;
  color: var(--ad-ink-2);
  font-size: 13.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 3px;
}

.meta :deep(.value) {
  font-size: 11.5px !important;
}

.mini {
  height: 20px;
  font-size: 11.5px;
}

.when {
  color: var(--ad-ink-3);
  font-size: 12px;
}

.grip {
  display: flex;
  align-self: stretch;
  align-items: center;
  justify-content: center;
  width: 44px;
  color: var(--ad-ink-3);
}

.menu.ad-glass {
  background: var(--ad-menu-tint);
}

.menu {
  position: absolute;
  top: calc(var(--safe-top) + 54px);
  right: 16px;
  z-index: 27;
  display: flex;
  flex-direction: column;
  width: 238px;
  padding: 6px 0;
  border-radius: 26px;
}

.item {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 44px;
  padding: 0 18px 0 20px;
  font-size: 16px;
}

.item :deep(svg) {
  color: var(--ad-ink-2);
}

.danger,
.danger :deep(svg) {
  color: var(--ad-danger);
}

.divider {
  position: relative;
  z-index: 1;
  height: 0.5px;
  margin: 5px 0;
  background: var(--ad-hair);
}
</style>
