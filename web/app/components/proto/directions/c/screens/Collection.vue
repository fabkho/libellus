<script setup lang="ts">
// collection: one Collection (Sci-fi) in the Member's order. On top, its
// own little shelf; below, the list with grip handles — one book is lifted
// mid-drag (tilted, shadow up) over the gap it left. Add and the
// rename/delete menu sit in the bar.
import { computed } from 'vue'
import { formatAuthors } from '../../../data'
import Cover from '../kit/Cover.vue'
import Icon from '../kit/Icon.vue'
import NavBar from '../kit/NavBar.vue'
import Plank from '../kit/Plank.vue'
import Spine from '../kit/Spine.vue'
import StatusTag from '../kit/StatusTag.vue'
import TabBar from '../kit/TabBar.vue'
import { useShelf } from '../kit/useShelf'

const { data } = useShelf()
const collection = computed(() => data.value.openCollection)
const entries = computed(() => data.value.collectionEntries(collection.value))
/** Mid-drag: the third book is lifted and hovers over slot 4; the rows below it closed up. */
const DRAGGED = 2
const TARGET = 3
const ROW = 70
const rows = computed(() => {
  const rest = entries.value.filter((_, i) => i !== DRAGGED).map((entry) => ({ entry, placeholder: false }))
  rest.splice(TARGET, 0, { entry: entries.value[DRAGGED]!, placeholder: true })
  return rest
})
const dragged = computed(() => entries.value[DRAGGED]!)
</script>

<template>
  <div class="screen c-paper-grain">
    <NavBar :title="collection.name" back="Collections">
      <template #trailing>
        <span class="round"><Icon name="plus" /></span>
        <span class="round"><Icon name="more" /></span>
      </template>
    </NavBar>
    <p class="sub">{{ entries.length }} books · your order · hold <Icon name="grip" :size="15" class="inline-grip" /> to move</p>

    <div class="mini-shelf">
      <Plank :gap="2" :inset="14">
        <Spine v-for="entry in entries" :key="entry.id" :book="entry.book" :scale="0.58" />
      </Plank>
    </div>

    <ol class="list">
      <template v-for="({ entry, placeholder }, i) in rows" :key="entry.id">
        <li v-if="placeholder" class="slot" />
        <li v-else class="row">
          <span class="pos">{{ i + 1 }}</span>
          <span class="cover-slot"><Cover :book="entry.book" :width="38" /></span>
          <span class="text">
            <span class="title">{{ entry.book.title }}</span>
            <span class="meta">
              <span class="author">{{ formatAuthors(entry.book.authors) }}</span>
            </span>
          </span>
          <StatusTag :status="entry.status" icon />
          <span class="grip"><Icon name="grip" :size="20" /></span>
        </li>
      </template>
      <li class="row dragged" :style="{ top: `${TARGET * ROW - 14}px` }">
        <span class="pos">{{ TARGET + 1 }}</span>
        <span class="cover-slot"><Cover :book="dragged.book" :width="38" :lift="2" /></span>
        <span class="text">
          <span class="title">{{ dragged.book.title }}</span>
          <span class="meta">
            <span class="author">{{ formatAuthors(dragged.book.authors) }}</span>
          </span>
        </span>
        <StatusTag :status="dragged.status" icon />
        <span class="grip"><Icon name="grip" :size="20" /></span>
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

.sub {
  display: flex;
  align-items: center;
  gap: 3px;
  margin: 0;
  padding: 0 20px 6px;
  font-size: 14.5px;
  color: var(--c-ink-soft);
}

.inline-grip {
  color: var(--c-ink);
}

.mini-shelf {
  padding: 12px 6px 4px;
}

.list {
  position: relative;
  margin: 10px 20px 0;
  padding: 0;
  list-style: none;
}

.slot {
  height: 70px;
  border-radius: 16px;
  outline: 2px dashed var(--c-line-strong);
  outline-offset: -6px;
  background: color-mix(in srgb, var(--c-paper-deep) 60%, transparent);
}

.row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  height: 70px;
  padding: 0 4px 0 6px;
  border-bottom: 1px solid var(--c-line);
}

.pos {
  width: 18px;
  font-family: var(--c-mono);
  font-size: 14px;
  font-weight: 700;
  text-align: center;
  color: var(--c-muted);
}

.cover-slot {
  display: flex;
  align-items: flex-end;
  height: 60px;
}

.text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.meta {
  display: flex;
  min-width: 0;
}

.author {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.title {
  overflow: hidden;
  font-size: 16px;
  font-weight: 700;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.author {
  font-size: 14px;
  color: var(--c-ink-soft);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.grip {
  display: grid;
  place-items: center;
  width: 36px;
  height: 44px;
  color: var(--c-muted);
}

/* Mid-drag: the lifted row hovers just above the slot it will drop into. */
.row.dragged {
  position: absolute;
  inset-inline: -8px;
  z-index: 3;
  padding: 0 12px 0 14px;
  border-radius: 18px;
  border-bottom: 0;
  background: var(--c-card);
  transform: rotate(-1.8deg) scale(1.03);
  box-shadow:
    0 0 0 1.5px var(--c-ink),
    0 22px 34px -12px rgb(var(--c-shadow) / 0.5);
}

.row.dragged .grip {
  color: var(--c-ink);
}
</style>
