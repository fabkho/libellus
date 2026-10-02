<script setup lang="ts">
// library-want / library-reading / library-finished: the Library as a table
// of contents. Heading, the way into Collections, the three Statuses as
// figures over small-caps words, then the entries: running number, plate,
// title with a dotted leader to its date, author and Rating beneath.
// Finished carries the *Not finished* filter.
import { computed } from 'vue'
import type { LibraryEntry, Status } from '../../../data'
import { formatDate, latestSession } from '../../../data'
import { useProto } from '../../../contract'
import Avatar from '../kit/Avatar.vue'
import Icon from '../kit/Icon.vue'
import IndexRow from '../kit/IndexRow.vue'
import Rating from '../kit/Rating.vue'
import TabBar from '../kit/TabBar.vue'
import { folio } from '../kit/type'

const props = defineProps<{ status: Status }>()
const proto = useProto()

const data = computed(() => proto.value.data)
const entries = computed(() =>
  props.status === 'want_to_read'
    ? data.value.wantToRead
    : props.status === 'reading'
      ? data.value.reading
      : data.value.finished,
)
const segments = computed(() => [
  { value: 'want_to_read', label: 'Want to read', count: data.value.wantToRead.length },
  { value: 'reading', label: 'Reading', count: data.value.reading.length },
  { value: 'finished', label: 'Finished', count: data.value.finished.length },
])

function dateOf(entry: LibraryEntry): string {
  const session = latestSession(entry)
  if (props.status === 'want_to_read') return formatDate(entry.addedOn, 'short')
  if (props.status === 'reading') return formatDate(session?.startedOn ?? null, 'short')
  return formatDate(session?.endedOn ?? null, 'short')
}

/** Dates older than this year carry their year, like an index. */
function folioOf(entry: LibraryEntry): string {
  const session = latestSession(entry)
  const iso = props.status === 'want_to_read' ? entry.addedOn : props.status === 'reading' ? session?.startedOn : session?.endedOn
  const sameYear = iso?.startsWith(data.value.today.slice(0, 4))
  return sameYear ? dateOf(entry) : formatDate(iso ?? null)
}

const folioLabel = computed(() =>
  props.status === 'want_to_read' ? 'Added' : props.status === 'reading' ? 'Begun' : 'Finished',
)
</script>

<template>
  <div class="library">
    <header class="masthead">
      <div class="title-row">
        <h1 class="b-display heading">Library</h1>
        <Avatar />
      </div>
      <hr class="b-rule-ink" />
    </header>

    <div class="collections">
      <span class="name">Collections</span>
      <span class="names b-italic b-clip">{{ data.collections.map((c) => c.name).join(', ') }}</span>
      <span class="count b-figures">{{ data.collections.length }}</span>
      <Icon name="chevron" :size="18" class="chev" />
    </div>

    <nav class="segments">
      <span v-for="segment in segments" :key="segment.value" class="segment" :class="{ active: segment.value === status }">
        <span class="figure b-display">{{ segment.count }}</span>
        <span class="b-label">{{ segment.label }}</span>
      </span>
    </nav>

    <div v-if="status === 'finished'" class="filters">
      <span class="filter active">All</span>
      <span class="filter">Not finished <span class="b-figures">{{ data.notFinished.length }}</span></span>
      <span class="sort b-label">by date {{ folioLabel.toLowerCase() }}</span>
    </div>
    <div v-else class="filters plain">
      <span class="sort b-label">{{ folioLabel }}, newest first</span>
    </div>

    <div class="list">
      <IndexRow
        v-for="(entry, i) in entries"
        :key="entry.id"
        :book="entry.book"
        :number="folio(i + 1)"
        :folio="folioOf(entry)"
      >
        <template v-if="status === 'finished'" #aside>
          <span v-if="latestSession(entry)?.outcome === 'abandoned'" class="abandoned b-italic">Not finished</span>
          <template v-else>
            <span v-if="entry.sessions.length > 1" class="reread b-label">Read {{ entry.sessions.length }}×</span>
            <Rating :rating="latestSession(entry)?.rating ?? null" :size="19" :stars="8" />
          </template>
        </template>
        <template v-else-if="status === 'reading'" #aside>
          <span class="b-italic b-faint small">{{ entry.book.pageCount }} pp.</span>
        </template>
        <template v-else-if="entry.book.source === 'manual'" #aside>
          <span class="b-italic b-faint small">Added by hand</span>
        </template>
      </IndexRow>
    </div>

    <TabBar active="library" />
  </div>
</template>

<style scoped>
.library {
  position: relative;
  height: 100%;
  overflow: hidden;
}

.masthead {
  padding: calc(var(--safe-top) + 2px) var(--b-margin) 0;
}

.title-row {
  display: flex;
  height: 48px;
  align-items: flex-end;
  justify-content: space-between;
  padding-bottom: 6px;
}

.heading {
  --size: 46;
  margin: 0 0 -4px;
}

.title-row :deep(.avatar) {
  margin-right: -5px;
}

hr {
  margin: 0;
}

.collections {
  display: flex;
  height: 52px;
  align-items: center;
  gap: 10px;
  margin: 0 var(--b-margin);
  border-bottom: 1px solid var(--b-rule);
}

.collections .name {
  font-size: 17px;
  font-weight: 500;
}

.collections .names {
  min-width: 0;
  flex: 1;
  font-size: 14px;
  color: var(--b-ink-3);
}

.collections .count {
  font-size: 14px;
  color: var(--b-ink-2);
}

.chev {
  margin-right: -4px;
  color: var(--b-ink-3);
}

.segments {
  display: flex;
  margin: 0 var(--b-margin);
  border-bottom: 1px solid var(--b-rule);
}

.segment {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 12px 0 10px;
  color: var(--b-ink-3);
}

.segment .figure {
  --size: 30;
  line-height: 0.9;
}

.segment .b-label {
  font-size: 10px;
  letter-spacing: 0.13em;
}

.segment.active {
  color: var(--b-ink);
}

.segment.active .figure {
  color: var(--b-accent);
}

.segment.active::after {
  content: '';
  position: absolute;
  bottom: -1px;
  left: 0;
  width: 32px;
  border-bottom: 2px solid var(--b-accent);
}

.filters {
  display: flex;
  height: 44px;
  align-items: center;
  gap: 4px;
  margin: 0 var(--b-margin);
}

.filters.plain {
  height: 36px;
}

.filter {
  display: inline-flex;
  height: 28px;
  align-items: center;
  gap: 5px;
  padding: 0 10px;
  font-size: 15px;
  font-style: italic;
  color: var(--b-ink-2);
}

.filter:first-child {
  margin-left: -10px;
}

.filter.active {
  border: 1px solid var(--b-ink);
  border-radius: 2px;
  color: var(--b-ink);
  font-style: normal;
}

.sort {
  margin-left: auto;
  font-size: 9.5px;
  color: var(--b-ink-3);
}

.plain .sort {
  margin-left: 0;
}

.list {
  display: flex;
  flex-direction: column;
  padding: 0 var(--b-margin);
}

.list :deep(.row:first-child) {
  border-top: 1px solid var(--b-rule);
}

.abandoned {
  font-size: 14px;
  line-height: 20px;
  color: var(--b-accent);
}

.reread {
  margin-right: 8px;
  font-size: 9px;
  color: var(--b-ink-3);
}

.small {
  font-size: 13px;
  line-height: 20px;
}
</style>
