<script setup lang="ts">
// book-new / book-reading / book-finished: the cover lights the room. Under
// it: title, author, the facts in small mono, the one action the Status asks
// for, then the reading history as a thin timeline (newest first, every
// session editable), the Collections and the description.
import { computed } from 'vue'
import type { Book, LibraryEntry, ReadingSession } from '../../../data'
import { formatAuthors, formatDate, latestSession } from '../../../data'
import { useProto } from '../../../contract'
import Ambient from '../kit/Ambient.vue'
import Button from '../kit/Button.vue'
import Cover from '../kit/Cover.vue'
import Icon from '../kit/Icon.vue'
import Stars from '../kit/Stars.vue'
import TopBar from '../kit/TopBar.vue'
import { daysBetween } from '../kit/night'

const props = defineProps<{ state: 'new' | 'reading' | 'finished' }>()
const proto = useProto()

const entry = computed<LibraryEntry | null>(() =>
  props.state === 'reading'
    ? proto.value.data.readingEntry
    : props.state === 'finished'
      ? proto.value.data.finishedEntry
      : null,
)
const book = computed<Book>(() => entry.value?.book ?? proto.value.data.newBook)
const latest = computed(() => (entry.value ? latestSession(entry.value) : null))
const history = computed(() => [...(entry.value?.sessions ?? [])].reverse())
const collections = computed(() => (entry.value ? proto.value.data.collectionsOf(entry.value) : []))
const facts = computed(() =>
  [book.value.year, book.value.pageCount && `${book.value.pageCount} pages`, book.value.publisher].filter(Boolean),
)

const ordinals = ['First', 'Second', 'Third', 'Fourth', 'Fifth']
function sessionName(index: number): string {
  const n = history.value.length - index
  return history.value.length > 1 ? `${ordinals[n - 1] ?? `${n}th`} read` : 'This read'
}
function sessionDates(session: ReadingSession): string {
  if (!session.outcome) return `Since ${formatDate(session.startedOn)}`
  const sameYear = session.startedOn?.slice(0, 4) === session.endedOn?.slice(0, 4)
  return `${formatDate(session.startedOn, sameYear ? 'short' : 'long')} – ${formatDate(session.endedOn)}`
}
</script>

<template>
  <div class="page">
    <Ambient :colors="book.coverColors" />
    <TopBar :trailing="entry ? ['more'] : []" />

    <div class="hero">
      <Cover :book="book" :width="state === 'new' ? 140 : 118" halo />
      <h1 class="d-title title">{{ book.title }}</h1>
      <p class="author">{{ formatAuthors(book.authors) }}</p>
      <p class="facts d-mono">
        <template v-for="(fact, i) in facts" :key="i"><span v-if="i" class="dot" />{{ fact }}</template>
      </p>
    </div>

    <div class="status">
      <template v-if="state === 'reading'">
        <span class="lamp" />
        <span>Currently reading</span>
        <span class="muted d-mono">day {{ daysBetween(latest?.startedOn ?? null) }}</span>
      </template>
      <template v-else-if="state === 'finished'">
        <Stars :rating="latest?.rating ?? null" :size="15" :value-size="12" />
        <span class="muted">Finished {{ formatDate(latest?.endedOn ?? null) }}</span>
      </template>
      <template v-else>
        <span class="muted">From Apple Books · not in your Library</span>
      </template>
    </div>

    <div class="actions">
      <Button v-if="state === 'new'" block><Icon name="plus" :size="18" :stroke="1.8" />Add to Library</Button>
      <template v-else-if="state === 'reading'">
        <Button block><Icon name="check" :size="18" :stroke="1.8" />Finish</Button>
        <Button tone="line" class="abandon">Abandon</Button>
      </template>
      <Button v-else tone="quiet" block><Icon name="repeat" :size="18" />Read again</Button>
    </div>

    <section v-if="entry" class="section">
      <div class="label">
        <span class="d-eyebrow">Reading history</span>
        <span class="d-eyebrow faint"
          >{{ entry.sessions.length }} {{ entry.sessions.length === 1 ? 'read' : 'reads' }}</span
        >
      </div>
      <ol class="timeline">
        <li v-for="(session, i) in history" :key="session.id" class="session" :class="{ open: !session.outcome }">
          <span class="node" />
          <div class="row">
            <span class="name">{{ session.outcome ? sessionName(i) : 'Reading now' }}</span>
            <Stars v-if="session.rating" :rating="session.rating" :size="11" />
          </div>
          <div class="row">
            <span class="dates d-mono"
              >{{ sessionDates(session) }} · {{ daysBetween(session.startedOn, session.endedOn ?? undefined) }} days</span
            >
            <span class="edit">Edit</span>
          </div>
          <p v-if="session.review" class="review">{{ session.review }}</p>
        </li>
      </ol>
    </section>

    <section class="section">
      <div class="label"><span class="d-eyebrow">Collections</span></div>
      <div class="chips">
        <span v-for="collection in collections" :key="collection.id" class="chip">{{ collection.name }}</span>
        <span class="chip add"><Icon name="plus" :size="14" :stroke="1.7" />Add to collection</span>
      </div>
    </section>

    <section v-if="book.description" class="section">
      <div class="label"><span class="d-eyebrow">About</span></div>
      <p class="about">{{ book.description }}</p>
    </section>
  </div>
</template>

<style scoped>
.page {
  position: relative;
  height: 100%;
  overflow: hidden;
  background: var(--d-bg);
}

.hero {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 6px 32px 0;
  text-align: center;
}

.title {
  margin-top: 20px;
  font-size: calc(25px * var(--d-title-k));
  line-height: 1.08;
  text-wrap: balance;
}

.author {
  margin-top: 6px;
  font-size: 15px;
  color: var(--d-ink-2);
}

.facts {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 8px;
  font-size: 10.5px;
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

.status {
  position: relative;
  display: flex;
  height: 22px;
  margin-top: 14px;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 13px;
}

.muted {
  color: var(--d-ink-3);
}

.status .d-mono {
  font-size: 11px;
}

.lamp {
  width: 6px;
  height: 6px;
  border-radius: 9px;
  background: var(--d-lamp);
  box-shadow: 0 0 10px 2px rgb(239 183 104 / 0.6);
}

.actions {
  position: relative;
  display: flex;
  gap: 10px;
  padding: 16px 20px 0;
}

.abandon {
  flex: 0 0 120px;
}

.section {
  position: relative;
  padding: 26px 20px 0;
}

.label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.faint {
  color: var(--d-ink-4);
}

.timeline {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.session {
  position: relative;
  padding-left: 22px;
}

/* The thread through the reads. */
.session::before {
  position: absolute;
  top: 12px;
  bottom: -20px;
  left: 3.5px;
  width: 1px;
  content: '';
  background: var(--d-line-2);
}

.session:last-child::before {
  display: none;
}

.node {
  position: absolute;
  top: 5px;
  left: 0;
  width: 8px;
  height: 8px;
  border-radius: 9px;
  box-shadow: inset 0 0 0 1px var(--d-ink-3);
}

.open .node {
  background: var(--d-lamp);
  box-shadow: 0 0 10px 2px rgb(239 183 104 / 0.5);
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.row + .row {
  margin-top: 3px;
}

.name {
  font-size: 14.5px;
  font-weight: 500;
}

.dates {
  font-size: 11px;
  color: var(--d-ink-3);
}

.edit {
  display: flex;
  height: 28px;
  margin: -6px 0;
  align-items: center;
  font-size: 13px;
  color: var(--d-ink-3);
}

.review {
  display: -webkit-box;
  margin-top: 6px;
  overflow: hidden;
  font-family: var(--d-serif);
  font-size: 15px;
  font-style: italic;
  line-height: 1.32;
  color: var(--d-ink-2);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.chip {
  display: inline-flex;
  height: 32px;
  align-items: center;
  gap: 5px;
  padding: 0 13px;
  border-radius: 999px;
  background: var(--d-fill);
  box-shadow: inset 0 0 0 0.5px var(--d-line-2);
  font-size: 13px;
}

.chip.add {
  background: none;
  box-shadow: inset 0 0 0 0.5px var(--d-line-2);
  color: var(--d-ink-2);
}

.about {
  display: -webkit-box;
  overflow: hidden;
  font-size: 14px;
  line-height: 1.5;
  color: var(--d-ink-2);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
}
</style>
