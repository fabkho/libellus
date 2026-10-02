<script setup lang="ts">
// search-typing / search-results / search-empty. The query is set large, as
// a headline being written; under it a wire line shows each source (Libellus'
// own Catalogue, Apple Books, Open Library) as in or still coming. Results
// are one merged index: plate, title, author and year, the source in small
// caps; books already in the Library carry their Status, others a quick add.
import { computed } from 'vue'
import type { SearchSource, Status } from '../../../data'
import { formatAuthors } from '../../../data'
import { useProto } from '../../../contract'
import Button from '../kit/Button.vue'
import Cover from '../kit/Cover.vue'
import Icon from '../kit/Icon.vue'
import IconButton from '../kit/IconButton.vue'
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

const sources: SearchSource[] = ['catalogue', 'apple', 'openlibrary']
const sourceLabel: Record<SearchSource, string> = {
  catalogue: 'Libellus',
  apple: 'Apple Books',
  openlibrary: 'Open Library',
}
const statusLabel: Record<Status, string> = {
  want_to_read: 'Want to read',
  reading: 'Reading',
  finished: 'Finished',
}
const loading = (source: SearchSource) => props.state === 'typing' && search.value.typingLoading.includes(source)
const countOf = (source: SearchSource) => results.value.filter((r) => r.source === source).length
</script>

<template>
  <div class="search" :class="`is-${state}`">
    <header class="header">
      <div v-if="state !== 'typing'" class="title-row">
        <h1 class="b-display heading">Search</h1>
      </div>

      <div class="field" :class="{ focus: state === 'typing' }">
        <Icon name="search" :size="22" :stroke="1.5" class="glass" />
        <span class="query b-display b-italic"
          >{{ query }}<span v-if="state === 'typing'" class="caret"
        /></span>
        <span class="clear"><Icon name="close" :size="14" :stroke="1.8" /></span>
        <span v-if="state === 'typing'" class="cancel">Cancel</span>
      </div>

      <!-- The wire: each source, in or still coming. -->
      <div v-if="state !== 'empty'" class="wire b-label">
        <span v-for="source in sources" :key="source" class="source" :class="{ loading: loading(source) }">
          <span class="dot" />{{ sourceLabel[source] }}
          <span v-if="!loading(source)" class="count b-figures">{{ countOf(source) }}</span>
          <span v-else class="count">…</span>
        </span>
      </div>
      <div v-else class="wire b-label">
        <span class="source none"><span class="dot" />Nothing in all three sources</span>
      </div>
    </header>

    <div v-if="state === 'empty'" class="empty">
      <p class="b-label b-kicker">No entry</p>
      <h2 class="b-display headline">Not in any index we know.</h2>
      <p class="explain">
        Nothing for “{{ query }}” in Libellus, Apple Books or Open Library. Check the spelling, try the ISBN — or set
        the book in by hand.
      </p>
      <span class="manual"><Button tone="outline"><Icon name="pen" :size="18" :stroke="1.5" />Add manually</Button></span>
      <p class="aside b-italic b-faint">Books you add by hand stay private to you.</p>
    </div>

    <ol v-else class="results">
      <li v-for="result in results" :key="result.id" class="result">
        <Cover :book="result" :width="state === 'typing' ? 34 : 44" />
        <div class="text">
          <span class="title">{{ result.title }}</span>
          <span class="byline">
            <span class="b-italic">{{ formatAuthors(result.authors) }}</span>
            <span class="year b-figures">{{ result.year }}</span>
          </span>
          <span v-if="state !== 'typing'" class="from b-label">{{ sourceLabel[result.source] }}</span>
        </div>
        <span v-if="result.libraryStatus" class="owned">
          <span class="b-label b-kicker">{{ statusLabel[result.libraryStatus] }}</span>
          <span class="b-italic b-faint">in Library</span>
        </span>
        <IconButton v-else name="plus" ring />
      </li>
      <template v-if="state === 'typing'">
        <li v-for="n in 1" :key="`pending-${n}`" class="result pending">
          <span class="ghost-cover" />
          <span class="ghost-lines"><span /><span /></span>
        </li>
      </template>
    </ol>

    <Keyboard v-if="state === 'typing'" />
    <TabBar v-else active="search" />
  </div>
</template>

<style scoped>
.search {
  position: relative;
  height: 100%;
  overflow: hidden;
}

.header {
  padding: calc(var(--safe-top) + 2px) var(--b-margin) 0;
}

.is-typing .header {
  padding-top: calc(var(--safe-top) + 6px);
}

.title-row {
  display: flex;
  height: 48px;
  align-items: flex-end;
  padding-bottom: 2px;
}

.heading {
  --size: 46;
  margin: 0 0 -4px;
}

.field {
  display: flex;
  height: 52px;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
  border-top: 2px solid var(--b-ink);
  border-bottom: 1px solid var(--b-ink);
}

.glass {
  color: var(--b-ink-2);
}

.query {
  --size: 30;
  min-width: 0;
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  padding-top: 3px;
}

.caret {
  display: inline-block;
  width: 2px;
  height: 28px;
  margin-left: 2px;
  background: var(--b-accent);
  vertical-align: -5px;
}

.clear {
  display: flex;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--b-ink-3);
  color: var(--b-paper);
}

.cancel {
  display: flex;
  height: 44px;
  align-items: center;
  padding-left: 6px;
  font-size: 17px;
  color: var(--b-accent);
}

.wire {
  display: flex;
  gap: 14px;
  padding: 10px 0 8px;
  font-size: 9.5px;
  letter-spacing: 0.12em;
  color: var(--b-ink-2);
}

.source {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--b-ink);
}

.source.loading {
  color: var(--b-ink-3);
}

.source.loading .dot {
  border: 1px solid var(--b-accent);
  background: none;
  box-shadow: 0 0 0 2px var(--b-accent-wash);
}

.source.loading .count {
  color: var(--b-accent);
}

.source.none .dot {
  background: var(--b-accent);
}

.count {
  color: var(--b-ink-3);
}

.results {
  margin: 0;
  padding: 0 var(--b-margin);
  list-style: none;
}

.result {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 0;
  border-top: 1px solid var(--b-rule);
}

.is-typing .result {
  padding: 8px 0;
}

.text {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}

.title {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  font-size: 17px;
  font-weight: 500;
  line-height: 22px;
  text-wrap: pretty;
}

.byline {
  display: flex;
  gap: 8px;
  overflow: hidden;
  font-size: 15px;
  line-height: 20px;
  white-space: nowrap;
  color: var(--b-ink-2);
}

.year {
  color: var(--b-ink-3);
}

.from {
  margin-top: 2px;
  font-size: 9px;
  line-height: 14px;
  color: var(--b-ink-3);
}

.owned {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  text-align: right;
}

.owned .b-label {
  font-size: 9.5px;
}

.owned .b-italic {
  font-size: 13px;
  line-height: 16px;
}

.result :deep(.icon-button) {
  margin-right: -6px;
}

.result :deep(.ringed .mark) {
  border-color: var(--b-accent);
  color: var(--b-accent);
}

.pending {
  gap: 14px;
}

.ghost-cover {
  width: 34px;
  height: 51px;
  background: var(--b-paper-2);
}

.ghost-lines {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8px;
}

.ghost-lines span {
  height: 9px;
  width: 64%;
  background: var(--b-paper-2);
}

.ghost-lines span + span {
  width: 38%;
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 44px var(--b-margin) 0;
}

.headline {
  --size: 44;
  margin: 10px 0 0;
  line-height: 1;
}

.explain {
  margin: 16px 0 0;
  font-size: 17px;
  line-height: 24px;
  color: var(--b-ink-2);
}

.manual {
  display: block;
  width: 200px;
  margin-top: 24px;
}

.aside {
  margin: 12px 0 0;
  font-size: 14px;
  line-height: 20px;
}
</style>
