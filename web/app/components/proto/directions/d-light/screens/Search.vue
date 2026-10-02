<script setup lang="ts">
// search-typing / search-results / search-empty: search as a command palette.
// One floating panel holds the query, a strip where each source reports in
// (own Catalogue, Apple Books, Open Library — counts, or a spinner while it is
// still out), and the merged list. A hairline under the query fills as the
// sources answer.
import { computed } from 'vue'
import type { SearchResult, SearchSource, Status } from '../../../data'
import { formatAuthors } from '../../../data'
import { useProto } from '../../../contract'
import Button from '../kit/Button.vue'
import Cover from '../kit/Cover.vue'
import Icon from '../kit/Icon.vue'
import Keyboard from '../kit/Keyboard.vue'
import TabBar from '../kit/TabBar.vue'

const props = defineProps<{ state: 'typing' | 'results' | 'empty' }>()
const proto = useProto()

const search = computed(() => proto.value.data.search)
const query = computed(() =>
  props.state === 'typing'
    ? search.value.typingQuery
    : props.state === 'empty'
      ? search.value.emptyQuery
      : search.value.query,
)
const results = computed(() =>
  props.state === 'typing' ? search.value.typingResults : props.state === 'results' ? search.value.results : [],
)

const sources: { key: SearchSource; label: string }[] = [
  { key: 'catalogue', label: 'Libellus' },
  { key: 'apple', label: 'Apple Books' },
  { key: 'openlibrary', label: 'Open Library' },
]
const groups = computed(() =>
  sources.map((source) => ({
    ...source,
    hits: results.value.filter((r: SearchResult) => r.source === source.key),
    loading: props.state === 'typing' && search.value.typingLoading.includes(source.key),
  })),
)
const answered = computed(() => groups.value.filter((g) => !g.loading).length)

const sourceLabel = Object.fromEntries(sources.map((s) => [s.key, s.label])) as Record<SearchSource, string>

const statusLabel: Record<Status, string> = {
  want_to_read: 'Want to read',
  reading: 'Reading',
  finished: 'Finished',
}
</script>

<template>
  <div class="page">
    <div class="lamp" aria-hidden="true" />

    <div class="palette">
      <div class="query">
        <Icon name="search" :size="19" class="glass" />
        <span class="text"
          >{{ query }}<span v-if="state === 'typing'" class="dl-caret"
        /></span>
        <span class="clear"><Icon name="close" :size="13" :stroke="2" /></span>
        <span v-if="state === 'typing'" class="cancel">Cancel</span>
      </div>
      <div class="progress">
        <span :style="{ width: `${(answered / 3) * 100}%` }" :class="{ done: answered === 3 }" />
      </div>

      <div class="sources">
        <span v-for="group in groups" :key="group.key" class="source" :class="{ loading: group.loading }">
          <span v-if="group.loading" class="spinner" />
          <span v-else class="pip" :class="{ none: state === 'empty' }" />
          {{ group.label }}
          <span v-if="!group.loading" class="dl-num count">{{ group.hits.length }}</span>
        </span>
      </div>

      <div v-if="state !== 'empty'" class="list">
        <div v-for="hit in results" :key="hit.id" class="hit">
          <Cover :book="hit" :width="38" />
          <div class="hit-text">
            <span class="dl-title hit-title dl-truncate">{{ hit.title }}</span>
            <span class="hit-meta dl-truncate">{{ formatAuthors(hit.authors) }}</span>
            <span class="hit-source dl-mono"
              >{{ hit.year }}<span class="dot" />{{ sourceLabel[hit.source] }}</span
            >
          </div>
          <span v-if="hit.libraryStatus" class="owned"
            ><Icon name="check" :size="13" :stroke="1.8" />{{ statusLabel[hit.libraryStatus] }}</span
          >
          <span v-else class="add" aria-label="Add"><Icon name="plus" :size="17" :stroke="1.6" /></span>
        </div>
        <div v-if="state === 'typing'" class="hit ghost" aria-hidden="true">
          <span class="ghost-cover" />
          <div class="hit-text">
            <span class="bar" style="width: 62%" />
            <span class="bar" style="width: 38%" />
          </div>
        </div>
      </div>

      <div v-else class="empty">
        <p class="empty-title">No books found</p>
        <p class="empty-query">Nothing for “{{ query }}” in Libellus, Apple Books or Open Library.</p>
        <p class="empty-text">Check the spelling or search the ISBN — or add it by hand. Books you add yourself stay private.</p>
        <Button block tone="quiet"><Icon name="pencil" :size="17" />Add manually</Button>
      </div>
    </div>

    <p v-if="state === 'results'" class="hint">
      Not the edition you hold? Search its ISBN.
    </p>

    <Keyboard v-if="state === 'typing'" />
    <TabBar v-else active="search" />
  </div>
</template>

<style scoped>
.page {
  position: relative;
  height: 100%;
  overflow: hidden;
  background: var(--dl-bg);
}

.lamp {
  position: absolute;
  inset: 0 0 auto;
  height: 420px;
  background: radial-gradient(70% 60% at 50% 0%, var(--dl-lamp-soft), transparent 75%);
  pointer-events: none;
}

.palette {
  position: relative;
  margin: calc(var(--safe-top) + 10px) 12px 0;
  overflow: hidden;
  border-radius: 22px;
  background: var(--dl-raised);
  box-shadow:
    inset 0 0 0 0.5px var(--dl-line-2),
    0 24px 60px rgb(0 0 0 / 0.45);
}

.query {
  display: flex;
  height: 54px;
  align-items: center;
  gap: 10px;
  padding: 0 14px 0 16px;
}

.glass {
  color: var(--dl-ink-3);
}

.text {
  flex: 1;
  font-size: 18px;
  letter-spacing: -0.015em;
}

.clear {
  display: flex;
  width: 20px;
  height: 20px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: var(--dl-fill-2);
  color: var(--dl-ink-2);
}

.cancel {
  margin-left: 4px;
  padding-left: 12px;
  border-left: 0.5px solid var(--dl-line-2);
  font-size: 15px;
  color: var(--dl-ink-2);
}

.progress {
  height: 1px;
  background: var(--dl-line);
}

.progress span {
  display: block;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--dl-lamp));
  box-shadow: 0 0 8px var(--dl-lamp);
}

.progress span.done {
  background: var(--dl-line-2);
  box-shadow: none;
}

.sources {
  display: flex;
  height: 38px;
  align-items: center;
  gap: 14px;
  padding: 0 16px;
  border-bottom: 0.5px solid var(--dl-line);
  font-size: 12px;
  color: var(--dl-ink-2);
  white-space: nowrap;
}

.source {
  display: flex;
  align-items: center;
  gap: 6px;
}

.source.loading {
  color: var(--dl-lamp);
}

.pip {
  width: 5px;
  height: 5px;
  border-radius: 9px;
  background: var(--dl-ink-2);
}

.pip.none {
  background: none;
  box-shadow: inset 0 0 0 1px var(--dl-ink-3);
}

.count {
  font-size: 12px;
  color: var(--dl-ink-3);
}

.spinner {
  width: 9px;
  height: 9px;
  border: 1px solid rgb(239 183 104 / 0.25);
  border-top-color: var(--dl-lamp);
  border-radius: 999px;
}

.list {
  padding: 4px 0 6px;
}

.hit-source {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--dl-ink-3);
}

.dot {
  width: 2px;
  height: 2px;
  border-radius: 9px;
  background: currentColor;
}

.hit {
  display: flex;
  min-height: 64px;
  align-items: center;
  gap: 12px;
  padding: 5px 12px 5px 16px;
}

.hit-text {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 3px;
}

.hit-title {
  font-size: calc(14.5px * var(--dl-title-k));
  line-height: 1.2;
}

.hit-meta {
  font-size: 13px;
  color: var(--dl-ink-3);
}

.owned {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 4px;
  font-size: 12px;
  color: var(--dl-ink-3);
}

.add {
  display: flex;
  width: 34px;
  height: 34px;
  margin: 5px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  box-shadow: inset 0 0 0 0.5px var(--dl-line-2);
  color: var(--dl-ink);
}

.ghost-cover {
  width: 36px;
  height: 54px;
  flex-shrink: 0;
  border-radius: 2.5px;
  background: var(--dl-fill);
}

.bar {
  display: block;
  height: 9px;
  border-radius: 9px;
  background: linear-gradient(90deg, var(--dl-fill), var(--dl-fill-2), var(--dl-fill));
}

.empty {
  padding: 22px 20px 20px;
}

.empty-title {
  font-size: 19px;
  font-weight: 500;
  letter-spacing: -0.02em;
}

.empty-query {
  margin-top: 6px;
  font-size: 14px;
  line-height: 1.45;
  color: var(--dl-ink-2);
}

.empty-text {
  margin: 18px 0 18px;
  font-size: 14px;
  line-height: 1.45;
  color: var(--dl-ink-3);
}

.hint {
  position: relative;
  margin-top: 16px;
  text-align: center;
  font-size: 12.5px;
  color: var(--dl-ink-3);
}
</style>
