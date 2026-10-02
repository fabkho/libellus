<script setup lang="ts">
// collections: the Member's shelves as numbered sections. Each opens with its
// name running into a leader and its count, then its first covers stood on a
// hairline shelf at one height (each at its own width). New collection last.
import { computed } from 'vue'
import { useProto } from '../../../contract'
import Button from '../kit/Button.vue'
import Cover from '../kit/Cover.vue'
import Icon from '../kit/Icon.vue'
import RunningHead from '../kit/RunningHead.vue'
import TabBar from '../kit/TabBar.vue'
import { roman } from '../kit/type'

const proto = useProto()
const data = computed(() => proto.value.data)
const shelves = computed(() =>
  data.value.collections.map((collection) => ({
    collection,
    entries: data.value.collectionEntries(collection).slice(0, 5),
  })),
)
const total = computed(() => new Set(data.value.collections.flatMap((c) => c.entryIds)).size)
</script>

<template>
  <div class="collections">
    <RunningHead back="Library" />

    <header class="intro">
      <h1 class="b-display heading">Collections</h1>
      <p class="b-italic b-muted">Three shelves of your own, {{ total }} books across them.</p>
      <hr class="b-rule-ink" />
    </header>

    <div class="shelves">
      <section v-for="(shelf, i) in shelves" :key="shelf.collection.id" class="shelf">
        <div class="name-row">
          <span class="numeral b-display">{{ roman(i + 1) }}.</span>
          <span class="name">{{ shelf.collection.name }}</span>
          <span class="b-leader" />
          <span class="count b-figures">{{ shelf.collection.entryIds.length }} books</span>
          <Icon name="chevron" :size="16" :stroke="1.5" class="chev" />
        </div>
        <div class="strip">
          <Cover v-for="entry in shelf.entries" :key="entry.id" :book="entry.book" :height="84" />
          <span v-if="shelf.collection.entryIds.length > shelf.entries.length" class="more b-italic">
            +{{ shelf.collection.entryIds.length - shelf.entries.length }}
          </span>
        </div>
      </section>
    </div>

    <div class="new">
      <Button tone="outline"><Icon name="plus" :size="18" :stroke="1.6" />New collection</Button>
    </div>

    <TabBar active="library" />
  </div>
</template>

<style scoped>
.collections {
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

.shelves {
  padding: 0 var(--b-margin);
}

.shelf {
  padding: 14px 0 0;
}

.name-row {
  display: flex;
  height: 32px;
  align-items: baseline;
}

.numeral {
  --size: 22;
  width: 34px;
  font-style: italic;
  color: var(--b-accent);
}

.name {
  font-size: 20px;
  font-weight: 500;
  line-height: 24px;
}

.count {
  font-size: 14px;
  line-height: 24px;
  color: var(--b-ink-2);
}

.chev {
  align-self: center;
  margin: 0 -4px 0 4px;
  color: var(--b-ink-3);
}

.strip {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  margin-top: 8px;
  padding: 0 0 0 34px;
  border-bottom: 1px solid var(--b-rule-strong);
  overflow: hidden;
}

.more {
  align-self: center;
  padding-left: 4px;
  font-size: 15px;
  color: var(--b-ink-3);
}

.new {
  padding: 22px var(--b-margin) 0;
}
</style>
