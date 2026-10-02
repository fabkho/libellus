<script setup lang="ts">
// search-typing / search-results / search-empty with the `search` toggle on
// `dock` or `float`: D's command palette turned upside down and brought to the
// thumb. The query is the palette's bottom row, the source strip and its lamp
// hairline sit right above it, the results above that.
//
// - dock  ("Palette in bar"): the tab bar itself grows into the palette. Its
//   bottom row keeps Home and Library at the left, the query takes the rest.
//   Fully flipped: the best match sits at the bottom, nearest the query.
// - float ("Palette above bar"): the tab bar stays (Search active) and the
//   palette floats right above it. Results read top-down as usual.
//
// While typing both lift above the keyboard and the tabs step aside.
import { computed } from 'vue'
import type { SearchResult, SearchSource, Status } from '../../../data'
import { formatAuthors } from '../../../data'
import { useProto } from '../../../contract'
import Avatar from '../kit/Avatar.vue'
import Button from '../kit/Button.vue'
import Cover from '../kit/Cover.vue'
import Icon from '../kit/Icon.vue'
import Keyboard from '../kit/Keyboard.vue'
import TabBar from '../kit/TabBar.vue'

const props = defineProps<{ state: 'typing' | 'results' | 'empty' }>()
const proto = useProto()

const mode = computed(() => (proto.value.toggles.search === 'dock' ? 'dock' : 'float'))
const typing = computed(() => props.state === 'typing')

const search = computed(() => proto.value.data.search)
const query = computed(() =>
  props.state === 'typing'
    ? search.value.typingQuery
    : props.state === 'empty'
      ? search.value.emptyQuery
      : search.value.query,
)
const results = computed<SearchResult[]>(() =>
  props.state === 'typing' ? search.value.typingResults : props.state === 'results' ? search.value.results : [],
)
/** Dock: best match last, so it lands next to the query. */
const ordered = computed(() => (mode.value === 'dock' ? [...results.value].reverse() : results.value))

const sources: { key: SearchSource; label: string }[] = [
  { key: 'catalogue', label: 'Libellus' },
  { key: 'apple', label: 'Apple Books' },
  { key: 'openlibrary', label: 'Open Library' },
]
const groups = computed(() =>
  sources.map((source) => ({
    ...source,
    hits: results.value.filter((r) => r.source === source.key),
    loading: typing.value && search.value.typingLoading.includes(source.key),
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
  <div class="page" :class="[`state-${state}`, mode]">
    <div class="lamp" aria-hidden="true" />

    <header v-if="!typing" class="head">
      <h1 class="title">Search</h1>
      <Avatar />
    </header>

    <section class="palette" :class="{ typing }">
      <div v-if="state !== 'empty'" class="list">
        <p v-if="state === 'results' && mode === 'dock'" class="hint">Not the edition you hold? Search its ISBN.</p>
        <div v-if="typing && mode === 'dock'" class="hit ghost" aria-hidden="true">
          <span class="ghost-cover" />
          <div class="hit-text">
            <span class="bar" style="width: 62%" />
            <span class="bar" style="width: 38%" />
          </div>
        </div>

        <div v-for="hit in ordered" :key="hit.id" class="hit">
          <Cover :book="hit" :width="38" />
          <div class="hit-text">
            <span class="d-title hit-title d-truncate">{{ hit.title }}</span>
            <span class="hit-meta d-truncate">{{ formatAuthors(hit.authors) }}</span>
            <span class="hit-source d-mono">{{ hit.year }}<span class="dot" />{{ sourceLabel[hit.source] }}</span>
          </div>
          <span v-if="hit.libraryStatus" class="owned"
            ><Icon name="check" :size="13" :stroke="1.8" />{{ statusLabel[hit.libraryStatus] }}</span
          >
          <span v-else class="add" aria-label="Add"><Icon name="plus" :size="17" :stroke="1.6" /></span>
        </div>

        <div v-if="typing && mode === 'float'" class="hit ghost" aria-hidden="true">
          <span class="ghost-cover" />
          <div class="hit-text">
            <span class="bar" style="width: 62%" />
            <span class="bar" style="width: 38%" />
          </div>
        </div>
        <p v-if="state === 'results' && mode === 'float'" class="hint">Not the edition you hold? Search its ISBN.</p>
      </div>

      <div v-else class="empty">
        <p class="empty-title">No books found</p>
        <p class="empty-query">Nothing for “{{ query }}” in Libellus, Apple Books or Open Library.</p>
        <p class="empty-text">
          Check the spelling or search the ISBN — or add it by hand. Books you add yourself stay private.
        </p>
        <Button block tone="quiet"><Icon name="pencil" :size="17" />Add manually</Button>
      </div>

      <div class="sources">
        <span v-for="group in groups" :key="group.key" class="source" :class="{ loading: group.loading }">
          <span v-if="group.loading" class="spinner" />
          <span v-else class="pip" :class="{ none: state === 'empty' }" />
          {{ group.label }}
          <span v-if="!group.loading" class="d-num count">{{ group.hits.length }}</span>
        </span>
      </div>
      <div class="progress">
        <span :style="{ width: `${(answered / 3) * 100}%` }" :class="{ done: answered === 3 }" />
      </div>

      <div class="query">
        <template v-if="mode === 'dock' && !typing">
          <span class="tab" aria-label="Home"><Icon name="home" :size="22" /></span>
          <span class="tab" aria-label="Library"><Icon name="library" :size="22" /></span>
          <span class="divider" />
        </template>
        <Icon name="search" :size="19" class="glass" />
        <span class="text">{{ query }}<span v-if="typing" class="d-caret" /></span>
        <span class="clear"><Icon name="close" :size="13" :stroke="2" /></span>
        <span v-if="typing" class="cancel">Cancel</span>
      </div>
    </section>

    <Keyboard v-if="typing" />
    <TabBar v-else-if="mode === 'float'" active="search" />
  </div>
</template>

<style scoped>
.page {
  position: relative;
  height: 100%;
  overflow: hidden;
  background: var(--d-bg);
}

/* The lamp now shines from below, where the palette is. */
.lamp {
  position: absolute;
  inset: auto 0 0;
  height: 520px;
  background: radial-gradient(75% 60% at 50% 100%, var(--d-lamp-soft), transparent 75%);
  pointer-events: none;
}

.head {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: calc(var(--safe-top) + 10px) 20px 0;
}

.title {
  font-size: 28px;
  font-weight: 500;
  letter-spacing: -0.03em;
}

.palette {
  position: absolute;
  right: 12px;
  bottom: calc(var(--safe-bottom) - 4px);
  left: 12px;
  z-index: 11;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 24px;
  background: var(--d-raised);
  box-shadow:
    inset 0 0 0 0.5px var(--d-line-2),
    0 -10px 50px rgb(0 0 0 / 0.4),
    0 12px 30px rgb(0 0 0 / 0.35);
}

/* Above bar: the tab bar keeps its place, the palette sits on top of it. */
.float .palette {
  bottom: calc(var(--safe-bottom) + 60px);
}

.palette.typing,
.float .palette.typing {
  bottom: 346px;
}

.list {
  display: flex;
  max-height: 560px;
  flex-direction: column;
  padding: 6px 0 4px;
}

/* While typing the room above the keyboard is short: the far end of the list
   (the top) fades out. In the dock that is the weakest match. */
.typing .list {
  max-height: 318px;
  overflow: hidden;
  -webkit-mask-image: linear-gradient(to bottom, transparent, #000 48px);
  mask-image: linear-gradient(to bottom, transparent, #000 48px);
}

.dock .typing .list {
  justify-content: flex-end;
}

.float .typing .list {
  -webkit-mask-image: linear-gradient(to top, transparent, #000 48px);
  mask-image: linear-gradient(to top, transparent, #000 48px);
}

.hit {
  display: flex;
  min-height: 64px;
  flex-shrink: 0;
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
  font-size: calc(14.5px * var(--d-title-k));
  line-height: 1.2;
}

.hit-meta {
  font-size: 13px;
  color: var(--d-ink-3);
}

.hit-source {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--d-ink-3);
}

.dot {
  width: 2px;
  height: 2px;
  border-radius: 9px;
  background: currentColor;
}

.owned {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 4px;
  font-size: 12px;
  color: var(--d-ink-3);
}

.add {
  display: flex;
  width: 34px;
  height: 34px;
  margin: 5px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  box-shadow: inset 0 0 0 0.5px var(--d-line-2);
  color: var(--d-ink);
}

.ghost-cover {
  width: 36px;
  height: 54px;
  flex-shrink: 0;
  border-radius: 2.5px;
  background: var(--d-fill);
}

.bar {
  display: block;
  height: 9px;
  border-radius: 9px;
  background: linear-gradient(90deg, var(--d-fill), var(--d-fill-2), var(--d-fill));
}

.hint {
  padding: 8px 16px;
  text-align: center;
  font-size: 12px;
  color: var(--d-ink-3);
}

.empty {
  padding: 20px 20px 18px;
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
  color: var(--d-ink-2);
}

.empty-text {
  margin: 16px 0;
  font-size: 14px;
  line-height: 1.45;
  color: var(--d-ink-3);
}

/* Flipped: the strip's hairline is on top, the lamp line under it, then the query. */
.sources {
  display: flex;
  height: 36px;
  flex-shrink: 0;
  align-items: center;
  gap: 14px;
  padding: 0 16px;
  border-top: 0.5px solid var(--d-line);
  font-size: 12px;
  color: var(--d-ink-2);
  white-space: nowrap;
}

.source {
  display: flex;
  align-items: center;
  gap: 6px;
}

.source.loading {
  color: var(--d-lamp);
}

.pip {
  width: 5px;
  height: 5px;
  border-radius: 9px;
  background: var(--d-ink-2);
}

.pip.none {
  background: none;
  box-shadow: inset 0 0 0 1px var(--d-ink-3);
}

.count {
  font-size: 12px;
  color: var(--d-ink-3);
}

.spinner {
  width: 9px;
  height: 9px;
  border: 1px solid rgb(239 183 104 / 0.25);
  border-top-color: var(--d-lamp);
  border-radius: 999px;
}

.progress {
  height: 1px;
  flex-shrink: 0;
  background: var(--d-line);
}

.progress span {
  display: block;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--d-lamp));
  box-shadow: 0 0 8px var(--d-lamp);
}

.progress span.done {
  background: var(--d-line-2);
  box-shadow: none;
}

.query {
  display: flex;
  height: 56px;
  flex-shrink: 0;
  align-items: center;
  gap: 10px;
  padding: 0 14px 0 16px;
}

.dock .query {
  padding-left: 8px;
}

.tab {
  display: flex;
  width: 42px;
  height: 42px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  color: var(--d-ink-3);
}

.divider {
  width: 0.5px;
  height: 24px;
  margin-right: 4px;
  background: var(--d-line-2);
}

.glass {
  color: var(--d-lamp);
}

.text {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  font-size: 17px;
  letter-spacing: -0.015em;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.clear {
  display: flex;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: var(--d-fill-2);
  color: var(--d-ink-2);
}

.cancel {
  margin-left: 4px;
  padding-left: 12px;
  border-left: 0.5px solid var(--d-line-2);
  font-size: 15px;
  color: var(--d-ink-2);
}
</style>
