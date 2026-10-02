<script setup lang="ts">
// search-typing / search-results / search-empty. Search stays plain and fast:
// one round field, three quiet source pills that fill in as each source answers
// (Libellus' own Catalogue first, then Apple Books, then Open Library), and
// a merged list. Covers stand on a common baseline at their real ratio.
// In-Library hits show their Status tag; the rest get a round quick add.
import { computed } from 'vue'
import type { SearchSource } from '../../../data'
import { formatAuthors } from '../../../data'
import Button from '../kit/Button.vue'
import Cover from '../kit/Cover.vue'
import Icon from '../kit/Icon.vue'
import Keyboard from '../kit/Keyboard.vue'
import Plank from '../kit/Plank.vue'
import StatusTag from '../kit/StatusTag.vue'
import TabBar from '../kit/TabBar.vue'
import { useShelf } from '../kit/useShelf'

const props = defineProps<{ state: 'typing' | 'results' | 'empty' }>()
const { data } = useShelf()

const search = computed(() => data.value.search)
const query = computed(() =>
  props.state === 'typing' ? search.value.typingQuery : props.state === 'empty' ? search.value.emptyQuery : search.value.query,
)
const results = computed(() =>
  props.state === 'typing' ? search.value.typingResults : props.state === 'results' ? search.value.results : [],
)

const sourceLabel: Record<SearchSource, string> = {
  catalogue: 'Libellus',
  apple: 'Apple Books',
  openlibrary: 'Open Library',
}
const sources = computed(() =>
  (['catalogue', 'apple', 'openlibrary'] as SearchSource[]).map((source) => ({
    source,
    label: sourceLabel[source],
    loading: props.state === 'typing' && search.value.typingLoading.includes(source),
    count: results.value.filter((r) => r.source === source).length,
  })),
)
</script>

<template>
  <div class="screen c1-paper-grain" :class="`is-${state}`">
    <header class="head">
      <div v-if="state !== 'typing'" class="title-row">
        <h1>Search</h1>
      </div>
      <div class="field-row">
        <span class="field" :class="{ focus: state === 'typing' }">
          <Icon name="search" :size="20" class="glass" />
          <span class="query"
            >{{ query }}<span v-if="state === 'typing'" class="caret"
          /></span>
          <span class="clear"><Icon name="close" :size="13" /></span>
        </span>
        <span v-if="state === 'typing'" class="cancel">Cancel</span>
      </div>
      <div class="sources">
        <span v-for="s in sources" :key="s.source" class="pill" :class="{ loading: s.loading, none: !s.loading && !s.count }">
          <span v-if="s.loading" class="dots"><i /><i /><i /></span>
          <span v-else class="pill-count">{{ s.count }}</span>
          {{ s.label }}
        </span>
      </div>
    </header>

    <div v-if="state === 'empty'" class="empty">
      <div class="empty-art" aria-hidden="true">
        <Plank :inset="0" align="center" :gap="4">
          <span class="ghost-book">?</span>
          <span class="tipped" />
        </Plank>
      </div>
      <h2>No books found</h2>
      <p>
        Nothing for “{{ query }}” in Libellus, Apple Books or Open Library. Check the spelling, try the ISBN, or add
        the book by hand.
      </p>
      <Button tone="primary" inline><Icon name="pencil" :size="19" />Add manually</Button>
    </div>

    <ul v-else class="list">
      <li v-for="result in results" :key="result.id" class="row">
        <span class="cover-slot"><Cover :book="result" :width="48" /></span>
        <span class="text">
          <span class="title">{{ result.title }}</span>
          <span class="author">{{ formatAuthors(result.authors) }}</span>
          <span class="meta">
            {{ result.year }}<span class="dot">·</span>
            <span class="src" :class="result.source">{{ sourceLabel[result.source] }}</span>
          </span>
        </span>
        <StatusTag v-if="result.libraryStatus" :status="result.libraryStatus" short />
        <span v-else class="add" aria-label="Add"><Icon name="plus" :size="20" /></span>
      </li>
      <template v-if="state === 'typing'">
        <li v-for="n in 2" :key="n" class="row skeleton">
          <span class="cover-slot"><span class="sk-cover" /></span>
          <span class="text"><span class="sk-line" /><span class="sk-line short" /></span>
        </li>
      </template>
    </ul>

    <Keyboard v-if="state === 'typing'" :suggestions="['“le gu”', 'Le Guin', 'legume']" />
    <TabBar v-else active="search" />
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
  flex-shrink: 0;
  padding: var(--safe-top) 20px 0;
}

.title-row {
  padding: 14px 0 10px;
}

h1 {
  margin: 0;
  font-family: var(--c1-serif);
  font-size: 34px;
  font-weight: var(--c1-serif-weight);
  line-height: 1.1;
}

.is-typing .head {
  padding-top: calc(var(--safe-top) + 6px);
}

.field-row {
  display: flex;
  align-items: center;
  gap: 14px;
}

.field {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 10px;
  height: 48px;
  padding: 0 12px 0 14px;
  border-radius: 999px;
  background: var(--c1-field);
  box-shadow: inset 0 0 0 1px var(--c1-line-strong);
  font-size: 17px;
  font-weight: 400;
}

.field.focus {
  box-shadow:
    inset 0 0 0 1.5px var(--c1-accent),
    0 0 0 4px color-mix(in srgb, var(--c1-accent) 14%, transparent);
}

.glass {
  flex-shrink: 0;
  color: var(--c1-ink-soft);
}

.query {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.caret {
  display: inline-block;
  width: 2px;
  height: 1.15em;
  margin-left: 1px;
  vertical-align: -0.2em;
  border-radius: 1px;
  background: var(--c1-accent);
}

.clear {
  display: grid;
  flex-shrink: 0;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--c1-line-strong);
  color: var(--c1-card);
}

.cancel {
  font-size: 17px;
  font-weight: 500;
  color: var(--c1-accent-deep);
}

[data-theme='dark'] .cancel {
  color: var(--c1-accent);
}

.sources {
  display: flex;
  gap: 6px;
  padding: 12px 0 4px;
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 10px 0 8px;
  border-radius: 999px;
  background: transparent;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--c1-ink-soft);
  white-space: nowrap;
  box-shadow: inset 0 0 0 1px var(--c1-line-strong);
}

.pill-count {
  display: grid;
  place-items: center;
  min-width: 0;
  height: auto;
  padding: 0;
  color: var(--c1-ink);
  font-size: 12.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.pill.none .pill-count {
  color: var(--c1-muted);
}

.pill.loading {
  color: var(--c1-ink-soft);
  box-shadow: none;
  outline: 1px dashed var(--c1-line-strong);
  outline-offset: -1px;
}

.dots {
  display: inline-flex;
  gap: 2px;
  padding: 0 4px 0 6px;
}

.dots i {
  display: block;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--c1-accent);
}

.dots i:nth-child(2) {
  opacity: 0.6;
  transform: translateY(-2px);
}

.dots i:nth-child(3) {
  opacity: 0.3;
}

/* --- Results ----------------------------------------------------------- */

.list {
  margin: 0;
  padding: 6px 20px 0;
  list-style: none;
}

.row {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 86px;
  border-bottom: 1px solid var(--c1-line);
}

.cover-slot {
  display: flex;
  flex-shrink: 0;
  align-items: flex-end;
  justify-content: center;
  width: 52px;
  height: 74px;
}

.text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.title {
  overflow: hidden;
  font-family: var(--c1-serif);
  font-weight: var(--c1-serif-weight);
  font-size: 17px;
  line-height: 1.25;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.author {
  font-size: 14.5px;
  color: var(--c1-ink-soft);
}

.meta {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 3px;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--c1-muted);
}

.dot {
  opacity: 0.6;
}

.src::before {
  content: '';
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-right: 5px;
  border-radius: 50%;
  vertical-align: 0;
}

.src.catalogue::before {
  background: var(--c1-teal);
}

.src.apple::before {
  background: var(--c1-accent);
}

.src.openlibrary::before {
  background: var(--c1-mustard);
}

.add {
  display: grid;
  flex-shrink: 0;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--c1-accent-soft);
  color: var(--c1-accent-deep);
}

[data-theme='dark'] .add {
  color: var(--c1-accent);
}

.skeleton .sk-cover {
  width: 48px;
  height: 72px;
  border-radius: 3px;
  background: var(--c1-paper-deep);
}

.sk-line {
  display: block;
  width: 70%;
  height: 12px;
  margin: 4px 0;
  border-radius: 6px;
  background: var(--c1-paper-deep);
}

.sk-line.short {
  width: 40%;
}

/* --- Empty ------------------------------------------------------------- */

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 34px 34px 0;
  text-align: center;
}

.empty-art {
  width: 200px;
  margin-bottom: 14px;
}

.ghost-book {
  display: grid;
  place-items: center;
  width: 46px;
  height: 120px;
  border: 1.5px dashed var(--c1-line-strong);
  border-bottom: 0;
  border-radius: 6px 6px 0 0;
  font-family: var(--c1-serif);
  font-weight: var(--c1-serif-weight);
  font-size: 30px;
  color: var(--c1-muted);
}

.tipped {
  width: 34px;
  height: 112px;
  border-radius: 4px;
  background: var(--c1-wood-dark);
  transform: rotate(-16deg);
  transform-origin: bottom left;
  margin-left: 32px;
  box-shadow: inset -3px 0 0 rgb(0 0 0 / 0.1);
}

h2 {
  margin: 0;
  font-family: var(--c1-serif);
  font-size: 26px;
  font-weight: var(--c1-serif-weight);
}

.empty p {
  margin: 0 0 14px;
  font-size: 15.5px;
  line-height: 1.45;
  color: var(--c1-ink-soft);
}
</style>
