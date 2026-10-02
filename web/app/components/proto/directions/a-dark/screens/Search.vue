<script setup lang="ts">
// search-typing / search-results / search-empty. iOS 26 search: the field is a
// frosted capsule at the bottom (right above the keyboard while typing). One
// merged list — own Catalogue first, then Apple Books, then Open Library —
// with a small strip saying which sources are in and which are still coming.
import { computed } from 'vue'
import type { SearchResult, SearchSource } from '../../../data'
import { formatAuthors } from '../../../data'
import { useProto } from '../../../contract'
import Cover from '../kit/Cover.vue'
import Icon from '../kit/Icon.vue'
import Keyboard from '../kit/Keyboard.vue'
import LargeTitle from '../kit/LargeTitle.vue'
import Pill from '../kit/Pill.vue'
import RoundButton from '../kit/RoundButton.vue'
import SearchField from '../kit/SearchField.vue'
import StatusTag from '../kit/StatusTag.vue'
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
const sourceLabel = Object.fromEntries(sources.map((s) => [s.key, s.label])) as Record<SearchSource, string>
const loading = (key: SearchSource) => props.state === 'typing' && search.value.typingLoading.includes(key)
</script>

<template>
  <div class="screen" :class="`state-${state}`">
    <LargeTitle v-if="state !== 'typing'" title="Search" avatar />

    <!-- Which sources have answered. -->
    <div v-if="state !== 'empty'" class="sources" :class="{ top: state === 'typing' }">
      <span class="sources-lead ad-num">
        <template v-if="state === 'typing'">{{ results.length }} so far</template>
        <template v-else>{{ results.length }} books</template>
      </span>
      <span v-for="source in sources" :key="source.key" class="source" :class="{ loading: loading(source.key) }">
        <span v-if="loading(source.key)" class="spinner" aria-label="Loading" />
        <svg v-else width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><path d="m2.4 6.3 2.4 2.4 4.8-5.2" /></svg>
        {{ source.label }}
      </span>
    </div>

    <div v-if="state !== 'empty'" class="results">
      <article v-for="result in results" :key="result.id" class="result">
        <div class="result-cover"><Cover :book="result" :height="76" /></div>
        <div class="result-text">
          <h3 class="ad-serif">{{ result.title }}</h3>
          <p class="author">{{ formatAuthors(result.authors) }}</p>
          <p class="meta ad-num">
            {{ result.year }}<span class="sep">·</span><span class="src" :class="result.source">{{
              sourceLabel[result.source]
            }}</span>
          </p>
        </div>
        <StatusTag v-if="result.libraryStatus" :status="result.libraryStatus" short />
        <span v-else class="add" role="button" :aria-label="`Add ${result.title}`"
          ><Icon name="plus" :size="19" :stroke="2.1"
        /></span>
      </article>

      <!-- Open Library still on its way. -->
      <article v-if="state === 'typing'" class="result skeleton" aria-hidden="true">
        <div class="result-cover"><span class="ghost-cover" /></div>
        <div class="result-text">
          <span class="ghost wide" />
          <span class="ghost" />
        </div>
      </article>
    </div>

    <div v-else class="empty">
      <div class="art" aria-hidden="true">
        <svg width="92" height="92" viewBox="0 0 92 92">
          <rect x="22" y="16" width="38" height="56" rx="4" class="art-back" transform="rotate(-8 41 44)" />
          <rect x="30" y="18" width="38" height="56" rx="4" class="art-front" />
          <path d="M37 32h24M37 39h18M37 46h21" class="art-lines" />
          <circle cx="62" cy="62" r="11" class="art-lens" />
          <path d="m70 70 7 7" class="art-handle" />
        </svg>
      </div>
      <h2 class="ad-serif">No book by that name</h2>
      <p>
        Libellus, Apple Books and Open Library don’t know “{{ query }}”. Check the spelling, try the ISBN from the back
        cover, or add it yourself.
      </p>
      <Pill icon="pencil" size="md">Add manually</Pill>
    </div>

    <template v-if="state === 'typing'">
      <div class="edge" aria-hidden="true" />
      <div class="typing-bar">
        <div class="grow"><SearchField :query="query" focus /></div>
        <RoundButton icon="close" :size="52" />
      </div>
      <Keyboard />
    </template>
    <TabBar v-else active="search">
      <SearchField :query="query" />
    </TabBar>
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

.sources {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 12px;
  padding: 14px 20px 4px;
  color: var(--ad-ink-2);
  font-size: 12.5px;
  font-weight: 500;
  white-space: nowrap;
}

.sources.top {
  padding-top: calc(var(--safe-top) + 10px);
}

.sources-lead {
  margin-right: auto;
  color: var(--ad-ink);
  font-weight: 600;
}

.source {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.source svg path {
  fill: none;
  stroke: #7fb48f;
  stroke-width: 1.9;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.source.loading {
  color: var(--ad-ink-3);
}

.spinner {
  width: 10px;
  height: 10px;
  border: 1.6px solid var(--ad-hair);
  border-top-color: var(--ad-ink-2);
  border-radius: 999px;
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.results {
  display: flex;
  flex-direction: column;
  padding: 4px 20px 0;
}

.result {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 0;
}

.result-cover {
  display: flex;
  flex: 0 0 52px;
  align-items: flex-end;
  justify-content: center;
}

.result-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

h3 {
  margin: 0;
  overflow: hidden;
  font-size: 17px;
  font-weight: 600;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.author {
  margin: 2px 0 0;
  color: var(--ad-ink-2);
  font-size: 14px;
}

.meta {
  display: flex;
  align-items: center;
  margin: 4px 0 0;
  color: var(--ad-ink-3);
  font-size: 12.5px;
}

.sep {
  margin: 0 5px;
}

.src {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.src::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--ad-ink-3);
}

.src.catalogue::before {
  background: var(--ad-accent);
}

.src.apple::before {
  background: var(--ad-ink-2);
}

.src.openlibrary::before {
  background: #8aa39a;
}

.add {
  position: relative;
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  margin-right: -6px;
  border-radius: 999px;
  color: var(--ad-accent);
}

.add::before {
  content: '';
  position: absolute;
  width: 34px;
  height: 34px;
  border-radius: 999px;
  background: var(--ad-accent-soft);
}

.add :deep(svg) {
  position: relative;
}

.skeleton .ghost-cover {
  display: block;
  width: 50px;
  height: 76px;
  border-radius: 3.5px;
  background: linear-gradient(100deg, rgb(var(--ad-tint) / 0.06) 30%, rgb(var(--ad-tint) / 0.11) 50%, rgb(var(--ad-tint) / 0.06) 70%);
}

.ghost {
  display: block;
  width: 40%;
  height: 11px;
  margin-top: 8px;
  border-radius: 99px;
  background: rgb(var(--ad-tint) / 0.07);
}

.ghost.wide {
  width: 72%;
  height: 14px;
  margin-top: 0;
}

.typing-bar {
  position: absolute;
  inset: auto 0 346px;
  z-index: 36;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 14px;
}

/* iOS 26's scroll-edge effect: content fades out where the floating field sits. */
.edge {
  position: absolute;
  inset: auto 0 330px;
  z-index: 35;
  height: 104px;
  background: linear-gradient(180deg, rgb(var(--ad-paper-rgb) / 0), rgb(var(--ad-paper-rgb) / 0.82) 55%, rgb(var(--ad-paper-rgb) / 0.94));
  pointer-events: none;
}

.typing-bar .grow {
  flex: 1;
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 128px 36px 0;
  text-align: center;
}

.art {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 128px;
  height: 128px;
  margin-bottom: 20px;
  border-radius: 999px;
  background: radial-gradient(circle at 50% 40%, var(--ad-card), var(--ad-sunk));
  box-shadow: inset 0 0 0 0.5px var(--ad-hair);
}

.art-back {
  fill: var(--ad-sunk);
  stroke: var(--ad-ink-3);
  stroke-width: 1.5;
}

.art-front {
  fill: var(--ad-card);
  stroke: var(--ad-ink-2);
  stroke-width: 1.5;
}

.art-lines {
  fill: none;
  stroke: var(--ad-ink-3);
  stroke-width: 1.5;
  stroke-linecap: round;
}

.art-lens {
  fill: color-mix(in oklab, var(--ad-accent) 14%, var(--ad-card));
  stroke: var(--ad-accent);
  stroke-width: 2.2;
}

.art-handle {
  stroke: var(--ad-accent);
  stroke-width: 3.4;
  stroke-linecap: round;
}

.empty h2 {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
}

.empty p {
  margin: 8px 0 22px;
  color: var(--ad-ink-2);
  font-size: 15px;
  line-height: 1.45;
  text-wrap: pretty;
}
</style>
