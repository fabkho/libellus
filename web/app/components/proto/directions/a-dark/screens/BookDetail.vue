<script setup lang="ts">
// book-new / book-reading / book-finished: the cover large over a soft colour
// field from the cover's own palette, serif title, quiet metadata, one
// prominent pill action for the entry's Status. Then the reading history
// (newest first, each session editable), the Collections, the description.
import { computed } from 'vue'
import type { Book, LibraryEntry, ReadingSession } from '../../../data'
import { formatAuthors, formatDate, latestSession } from '../../../data'
import { useProto } from '../../../contract'
import Ambient from '../kit/Ambient.vue'
import Cover from '../kit/Cover.vue'
import Icon from '../kit/Icon.vue'
import Pill from '../kit/Pill.vue'
import RoundButton from '../kit/RoundButton.vue'
import Stars from '../kit/Stars.vue'
import StatusTag from '../kit/StatusTag.vue'
import TopBar from '../kit/TopBar.vue'

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
const meta = computed(() =>
  [book.value.year, book.value.pageCount && `${book.value.pageCount} pages`, book.value.publisher]
    .filter(Boolean)
    .join('  ·  '),
)

const DAY = 86_400_000
const days = (from: string | null, to: string | null) =>
  from && to ? Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1 : null

const ordinals = ['First', 'Second', 'Third', 'Fourth']
function sessionTitle(session: ReadingSession, index: number) {
  if (!session.outcome) return 'Reading now'
  if (session.outcome === 'abandoned') return 'Not finished'
  const n = history.value.length - index
  return history.value.length > 1 ? `${ordinals[n - 1] ?? `Read ${n}`} read` : 'Finished'
}
function sessionDates(session: ReadingSession) {
  if (!session.outcome) return `Started ${formatDate(session.startedOn)} · day ${days(session.startedOn, proto.value.data.today)}`
  const span = days(session.startedOn, session.endedOn)
  const sameYear = session.startedOn?.slice(0, 4) === session.endedOn?.slice(0, 4)
  return `${formatDate(session.startedOn, sameYear ? 'short' : 'long')} – ${formatDate(session.endedOn)}${span ? ` · ${span} days` : ''}`
}
</script>

<template>
  <div class="screen">
    <div class="scroll">
      <Ambient :colors="book.coverColors" :height="400" />

      <div class="hero">
        <Cover :book="book" :height="state === 'new' ? 224 : 184" shadow="lift" />
        <h1 class="title ad-serif">{{ book.title }}</h1>
        <p class="author">{{ formatAuthors(book.authors) }}</p>
        <p class="meta ad-num">{{ meta }}</p>

        <div v-if="state === 'reading'" class="status">
          <StatusTag status="reading" />
          <span class="status-text">since {{ formatDate(latest?.startedOn ?? null) }}</span>
        </div>
        <div v-else-if="state === 'finished'" class="status">
          <StatusTag status="finished" />
          <span class="status-text">{{ formatDate(latest?.endedOn ?? null) }}</span>
          <Stars :rating="latest?.rating ?? null" :size="14" />
        </div>

        <div class="action">
          <Pill v-if="state === 'new'" icon="plus" block>Add to Library</Pill>
          <template v-else-if="state === 'reading'">
            <Pill icon="check" class="grow">Finish</Pill>
            <Pill tone="soft" icon="flag">Abandon</Pill>
          </template>
          <Pill v-else icon="again" block>Read again</Pill>
        </div>

        <div class="chips" aria-label="Collections">
          <span v-for="collection in collections" :key="collection.id" class="chip">
            <Icon name="stack" :size="14" :stroke="1.8" />{{ collection.name }}
          </span>
          <span class="chip add"><Icon name="plus" :size="14" :stroke="2" />{{ collections.length ? 'Add' : 'Add to collection' }}</span>
        </div>
      </div>

      <div class="sections">
        <section v-if="state !== 'new'" class="block">
          <div class="head">
            <h2 class="ad-serif">Reading history</h2>
            <span class="count">{{ entry!.sessions.length }} {{ entry!.sessions.length === 1 ? 'read' : 'reads' }}</span>
          </div>
          <div class="history ad-squircle">
            <article v-for="(session, i) in history" :key="session.id" class="session" :class="{ open: !session.outcome }">
              <span class="rail" aria-hidden="true"><span class="node" /></span>
              <div class="session-body">
                <div class="session-head">
                  <span class="session-title">{{ sessionTitle(session, i) }}</span>
                  <Stars v-if="session.rating" :rating="session.rating" :size="13" />
                  <span class="edit" role="button">Edit</span>
                </div>
                <p class="dates ad-num">{{ sessionDates(session) }}</p>
                <p v-if="session.review" class="review ad-serif">{{ session.review }}</p>
              </div>
            </article>
          </div>
        </section>

        <section v-if="book.description && state !== 'finished'" class="block">
          <div class="head"><h2 class="ad-serif">About this book</h2></div>
          <p class="about ad-serif">{{ book.description }}</p>
        </section>
      </div>
    </div>

    <TopBar>
      <RoundButton icon="share" />
      <RoundButton v-if="entry" icon="more" />
    </TopBar>
  </div>
</template>

<style scoped>
.screen {
  position: relative;
  height: 100%;
  overflow: hidden;
}

.scroll {
  position: relative;
}

.hero {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: calc(var(--safe-top) + 40px) 28px 0;
  text-align: center;
}

.title {
  margin: 18px 0 0;
  font-size: 27px;
  font-weight: 600;
  line-height: 1.12;
  text-wrap: balance;
}

.author {
  margin: 4px 0 0;
  color: var(--ad-accent-ink);
  font-size: 16px;
  font-weight: 500;
}

.meta {
  margin: 3px 0 0;
  color: var(--ad-ink-3);
  font-size: 13.5px;
  white-space: pre;
}

.status {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
}

.status-text {
  color: var(--ad-ink-2);
  font-size: 13.5px;
}

.action {
  display: flex;
  gap: 10px;
  width: 100%;
  margin-top: 14px;
}

.action .grow {
  flex: 1;
}

.sections {
  display: flex;
  flex-direction: column;
  gap: 22px;
  padding: 22px 20px 0;
}

.head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 9px;
}

h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}

.count {
  color: var(--ad-ink-3);
  font-size: 14px;
}

.history {
  overflow: hidden;
  border-radius: 22px;
  background: var(--ad-card);
  box-shadow: var(--ad-card-shadow);
}

.session {
  display: flex;
  gap: 12px;
  padding: 0 16px 0 14px;
}

.rail {
  position: relative;
  display: flex;
  justify-content: center;
  width: 12px;
}

/* One line through all sessions: a timeline, newest at the top. */
.rail::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1.5px;
  background: var(--ad-hair);
}

.session:first-child .rail::before {
  top: 21px;
}

.session:last-child .rail::before {
  bottom: calc(100% - 21px);
}

.session:only-child .rail::before {
  display: none;
}

.node {
  position: relative;
  width: 9px;
  height: 9px;
  margin-top: 16px;
  border: 1.5px solid var(--ad-ink-3);
  border-radius: 999px;
  background: var(--ad-card);
}

.open .node {
  border-color: var(--ad-accent);
  background: var(--ad-accent);
  box-shadow: 0 0 0 4px var(--ad-accent-soft);
}

.session-body {
  flex: 1;
  min-width: 0;
  padding: 11px 0 13px;
}

.session + .session .session-body {
  border-top: 0.5px solid var(--ad-hair);
}

.session-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.session-title {
  font-size: 15px;
  font-weight: 600;
}

.edit {
  margin-left: auto;
  color: var(--ad-accent);
  font-size: 14px;
  font-weight: 500;
}

.dates {
  margin: 1px 0 0;
  color: var(--ad-ink-2);
  font-size: 13px;
}


.review {
  margin: 6px 0 0;
  color: var(--ad-ink);
  font-size: 15px;
  font-style: italic;
  line-height: 1.36;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 7px;
  margin-top: 14px;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px 0 10px;
  border-radius: 999px;
  background: var(--ad-card);
  box-shadow: var(--ad-card-shadow);
  font-size: 13.5px;
  font-weight: 500;
}

.chip :deep(svg) {
  color: var(--ad-ink-3);
}

.chip.add {
  background: transparent;
  box-shadow: inset 0 0 0 1px var(--ad-hair);
  color: var(--ad-accent);
}

.chip.add :deep(svg) {
  color: var(--ad-accent);
}

.about {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: var(--ad-ink);
  font-size: 16px;
  line-height: 1.45;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 5;
}
</style>
