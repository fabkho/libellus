<script setup lang="ts">
// book-new / book-reading / book-finished: the Book as a title page. Plate,
// title, author and colophon centred; the Status and Rating under them; the
// action for the Status; the reading history as dated journal entries (newest
// first, each editable); the Collections as tags; the description with a
// drop cap.
import { computed } from 'vue'
import type { Book, LibraryEntry } from '../../../data'
import { formatAuthors, formatDate, latestSession } from '../../../data'
import { useProto } from '../../../contract'
import Button from '../kit/Button.vue'
import Cover from '../kit/Cover.vue'
import Icon from '../kit/Icon.vue'
import IconButton from '../kit/IconButton.vue'
import Kicker from '../kit/Kicker.vue'
import Rating from '../kit/Rating.vue'
import RunningHead from '../kit/RunningHead.vue'
import { dayOf, fullDate, ordinalWord, roman } from '../kit/type'

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
const history = computed(() =>
  [...(entry.value?.sessions ?? [])].map((session, i) => ({ session, n: i + 1 })).reverse(),
)
const collections = computed(() => (entry.value ? proto.value.data.collectionsOf(entry.value) : []))
const colophon = computed(() =>
  [book.value.year, book.value.pageCount && `${book.value.pageCount} pages`, book.value.publisher]
    .filter(Boolean)
    .join(' · '),
)
const today = computed(() => proto.value.data.today)

function span(startedOn: string | null, endedOn: string | null): string {
  if (!startedOn) return formatDate(endedOn)
  const sameYear = startedOn.slice(0, 4) === endedOn?.slice(0, 4)
  return `${formatDate(startedOn, sameYear ? 'short' : 'long')} – ${formatDate(endedOn)}`
}

const description = computed(() => book.value.description ?? '')
</script>

<template>
  <div class="detail">
    <RunningHead :back="state === 'new' ? 'Search' : 'Library'">
      <template #trailing>
        <IconButton v-if="entry" name="more" />
      </template>
    </RunningHead>

    <div class="page">
      <section class="titlepage">
        <Cover :book="book" :width="state === 'new' ? 124 : state === 'finished' ? 88 : 104" plate />
        <h1 class="b-display title">{{ book.title }}</h1>
        <p class="byline"><span class="b-italic">by</span> {{ formatAuthors(book.authors) }}</p>
        <p class="colophon b-label">{{ colophon }}</p>

        <p v-if="state === 'reading'" class="status">
          <span class="b-label b-kicker">Currently reading</span>
          <span class="b-italic b-muted"
            >since {{ formatDate(latest?.startedOn ?? null) }} · day {{ dayOf(latest!.startedOn!, today) }}</span
          >
        </p>
      </section>

      <!-- Finished: the latest Rating set large beside Read again, ruled above and below. -->
      <div v-if="state === 'finished'" class="ledger">
        <div class="verdict-large">
          <Rating :rating="latest?.rating ?? null" :size="34" :stars="13" />
          <span class="b-label b-kicker">Finished {{ formatDate(latest?.endedOn ?? null) }}</span>
        </div>
        <span class="again"><Button tone="outline" small>Read again</Button></span>
      </div>

      <div v-if="state !== 'finished'" class="actions">
        <Button v-if="state === 'new'"><Icon name="plus" :size="18" :stroke="1.6" />Add to Library</Button>
        <template v-else-if="state === 'reading'">
          <Button>Finish</Button>
          <span class="secondary"><Button tone="outline">Abandon</Button></span>
        </template>
      </div>

      <section v-if="entry" class="section">
        <Kicker label="Reading history">
          {{ entry.sessions.length === 1 ? 'one reading' : `${entry.sessions.length} readings` }}
        </Kicker>
        <ol class="journal">
          <li v-for="{ session, n } in history" :key="session.id" class="entry">
            <span class="numeral b-display">{{ roman(n) }}</span>
            <div class="body">
              <div class="head">
                <span class="when b-figures">
                  <template v-if="session.outcome">{{ span(session.startedOn, session.endedOn) }}</template>
                  <template v-else>Begun {{ fullDate(session.startedOn!) }}</template>
                </span>
                <span class="edit b-label">Edit</span>
              </div>
              <p v-if="!session.outcome" class="note b-italic">
                Open — no end date yet. Finish it, or set it aside.
              </p>
              <div v-else class="verdict">
                <span class="b-label b-faint">{{ ordinalWord(n) }} reading</span>
                <Rating :rating="session.rating" :size="20" :stars="9" />
              </div>
              <blockquote v-if="session.review" class="review">{{ session.review }}</blockquote>
            </div>
          </li>
        </ol>
      </section>

      <section class="section">
        <Kicker label="Collections" />
        <div class="tags">
          <span v-for="collection in collections" :key="collection.id" class="tag">{{ collection.name }}</span>
          <span class="tag add"><Icon name="plus" :size="14" :stroke="1.6" />Add to collection</span>
        </div>
      </section>

      <section v-if="description" class="section">
        <Kicker label="About" />
        <p class="about">
          <span class="dropcap b-display">{{ description.charAt(0) }}</span>{{ description.slice(1) }}
        </p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.detail {
  position: relative;
  display: flex;
  height: 100%;
  flex-direction: column;
  overflow: hidden;
}

.page {
  display: flex;
  flex-direction: column;
  padding: 0 var(--b-margin);
}

.titlepage {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 4px;
  text-align: center;
}

.title {
  --size: 38;
  max-width: 320px;
  margin: 16px 0 0;
  line-height: 0.98;
}

.byline {
  margin: 8px 0 0;
  font-size: 18px;
  line-height: 24px;
}

.colophon {
  margin: 4px 0 0;
  font-size: 10px;
  color: var(--b-ink-3);
}

.status {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  margin: 14px 0 0;
  padding-top: 12px;
  border-top: 1px solid var(--b-rule);
  min-width: 200px;
}

.status .b-italic {
  font-size: 15px;
  line-height: 20px;
}

.ledger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 16px;
  padding: 12px 0;
  border-top: 1px solid var(--b-rule-strong);
  border-bottom: 1px solid var(--b-rule-strong);
}

.verdict-large {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.verdict-large .b-label {
  font-size: 10px;
}

.again {
  display: block;
  width: 140px;
}

.actions {
  display: flex;
  gap: 10px;
  padding: 18px 0 4px;
}

.secondary {
  display: block;
  width: 128px;
  flex-shrink: 0;
}

.section {
  display: flex;
  flex-direction: column;
  padding-top: 20px;
}

.journal {
  margin: 0;
  padding: 0;
  list-style: none;
}

.entry {
  display: flex;
  gap: 12px;
  padding: 12px 0 12px;
  border-bottom: 1px solid var(--b-rule);
}

.numeral {
  --size: 26;
  width: 28px;
  flex-shrink: 0;
  padding-top: 2px;
  color: var(--b-accent);
  font-style: italic;
}

.body {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}

.head {
  display: flex;
  height: 24px;
  align-items: center;
  justify-content: space-between;
}

.when {
  font-size: 16px;
  font-weight: 500;
}

.edit {
  display: flex;
  height: 44px;
  align-items: center;
  margin-right: -6px;
  padding: 0 6px;
  font-size: 10px;
  color: var(--b-accent);
}

.verdict {
  display: flex;
  height: 24px;
  align-items: baseline;
  justify-content: space-between;
}

.verdict .b-label {
  font-size: 9.5px;
}

.note {
  margin: 2px 0 0;
  font-size: 15px;
  line-height: 20px;
  color: var(--b-ink-2);
}

.review {
  position: relative;
  margin: 6px 0 0;
  font-size: 15px;
  font-style: italic;
  line-height: 20px;
  color: var(--b-ink);
}

.review::before {
  content: '“';
  position: absolute;
  left: -0.42em;
}

.review::after {
  content: '”';
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 12px;
}

.tag {
  position: relative;
  display: inline-flex;
  height: 34px;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  border: 1px solid var(--b-rule-strong);
  border-radius: 2px;
  font-size: 15px;
}

.tag::after {
  content: '';
  position: absolute;
  inset: -5px 0;
}

.tag.add {
  border-style: dashed;
  border-color: var(--b-ink-3);
  font-style: italic;
  color: var(--b-ink-2);
}

.about {
  margin: 12px 0 0;
  font-size: 16px;
  line-height: 24px;
  color: var(--b-ink);
  hyphens: auto;
}

.dropcap {
  --size: 58;
  float: left;
  margin: 3px 5px -4px -2px;
  line-height: 0.82;
  color: var(--b-accent);
}
</style>
