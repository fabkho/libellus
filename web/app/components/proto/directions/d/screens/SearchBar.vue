<script setup lang="ts">
// search-typing / search-results / search-empty with the `search` toggle on
// `tabbar` (after direction a): the field lives at the bottom, in the tab
// bar's place — right above the keyboard while typing, with a round close
// button next to it. The results fill the page instead of a floating
// palette; the source strip and its lamp hairline stay at the top.
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

const sources: { key: SearchSource; label: string }[] = [
  { key: 'catalogue', label: 'Libellus' },
  { key: 'apple', label: 'Apple Books' },
  { key: 'openlibrary', label: 'Open Library' },
]
const groups = computed(() =>
  sources.map((source) => ({
    ...source,
    hits: results.value.filter((r) => r.source === source.key),
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
  <div class="page" :class="`state-${state}`">
    <div class="lamp" aria-hidden="true" />

    <header v-if="state !== 'typing'" class="head">
      <h1 class="title">Search</h1>
      <Avatar />
    </header>

    <div class="strip">
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
    </div>

    <div v-if="state !== 'empty'" class="list">
      <div v-for="hit in results" :key="hit.id" class="hit">
        <Cover :book="hit" :width="40" />
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
      <div v-if="state === 'typing'" class="hit ghost" aria-hidden="true">
        <span class="ghost-cover" />
        <div class="hit-text">
          <span class="bar" style="width: 62%" />
          <span class="bar" style="width: 38%" />
        </div>
      </div>
      <p v-if="state === 'results'" class="hint">Not the edition you hold? Search its ISBN.</p>
    </div>

    <div v-else class="empty">
      <p class="empty-title">No books found</p>
      <p class="empty-query">Nothing for “{{ query }}” in Libellus, Apple Books or Open Library.</p>
      <p class="empty-text">
        Check the spelling or search the ISBN — or add it by hand. Books you add yourself stay private.
      </p>
      <Button block tone="quiet"><Icon name="pencil" :size="17" />Add manually</Button>
    </div>

    <template v-if="state === 'typing'">
      <div class="edge" aria-hidden="true" />
      <div class="typing-row">
        <div class="field focus">
          <Icon name="search" :size="18" class="glass" />
          <span class="text">{{ query }}<span class="d-caret" /></span>
          <span class="clear"><Icon name="close" :size="12" :stroke="2" /></span>
        </div>
        <span class="circle" role="button" aria-label="Close search"
          ><Icon name="close" :size="18" :stroke="1.7"
        /></span>
      </div>
      <Keyboard />
    </template>
    <TabBar v-else active="search">
      <div class="field">
        <Icon name="search" :size="18" class="glass" />
        <span class="text">{{ query }}</span>
        <span class="clear"><Icon name="close" :size="12" :stroke="2" /></span>
      </div>
    </TabBar>
  </div>
</template>

<style scoped>
.page {
  position: relative;
  height: 100%;
  overflow: hidden;
  background: var(--d-bg);
}

.lamp {
  position: absolute;
  inset: 0 0 auto;
  height: 420px;
  background: radial-gradient(70% 60% at 50% 0%, var(--d-lamp-soft), transparent 75%);
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

.strip {
  position: relative;
  margin-top: 10px;
}

.state-typing .strip {
  margin-top: calc(var(--safe-top) + 4px);
}

.sources {
  display: flex;
  height: 38px;
  align-items: center;
  gap: 14px;
  padding: 0 20px;
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
  margin: 0 20px;
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

.list {
  position: relative;
  padding: 6px 0;
}

.hit {
  display: flex;
  min-height: 70px;
  align-items: center;
  gap: 13px;
  padding: 6px 12px 6px 20px;
}

.hit-text {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 3px;
}

.hit-title {
  font-size: calc(15px * var(--d-title-k));
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
  padding: 0 6px;
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
  width: 40px;
  height: 60px;
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
  margin-top: 14px;
  text-align: center;
  font-size: 12.5px;
  color: var(--d-ink-3);
}

.empty {
  position: relative;
  padding: 26px 20px 20px;
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
  margin: 18px 0;
  font-size: 14px;
  line-height: 1.45;
  color: var(--d-ink-3);
}

/* The field: same glass as the tab bar, so it reads as the bar itself. */
.field {
  display: flex;
  height: 48px;
  align-items: center;
  gap: 10px;
  padding: 0 14px 0 16px;
  border-radius: 999px;
  background: var(--d-glass);
  box-shadow:
    inset 0 0 0 0.5px var(--d-line-2),
    0 12px 30px rgb(0 0 0 / 0.35);
  backdrop-filter: blur(22px) saturate(1.6);
  -webkit-backdrop-filter: blur(22px) saturate(1.6);
}

.field.focus {
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, var(--d-lamp) 55%, transparent),
    0 12px 30px rgb(0 0 0 / 0.35);
}

.glass {
  color: var(--d-ink-3);
}

.text {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  font-size: 16px;
  letter-spacing: -0.01em;
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

.typing-row {
  position: absolute;
  right: 12px;
  bottom: 346px;
  left: 12px;
  z-index: 36;
  display: flex;
  align-items: center;
  gap: 10px;
}

.typing-row .field {
  flex: 1;
}

.circle {
  display: flex;
  width: 48px;
  height: 48px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: var(--d-glass);
  box-shadow:
    inset 0 0 0 0.5px var(--d-line-2),
    0 12px 30px rgb(0 0 0 / 0.35);
  color: var(--d-ink-2);
  backdrop-filter: blur(22px) saturate(1.6);
  -webkit-backdrop-filter: blur(22px) saturate(1.6);
}

/* Content fades out where the floating field sits. */
.edge {
  position: absolute;
  right: 0;
  bottom: 330px;
  left: 0;
  z-index: 35;
  height: 96px;
  background: linear-gradient(to bottom, transparent, var(--d-bg) 70%);
  pointer-events: none;
}
</style>
