<script setup lang="ts">
// library-want / library-reading / library-finished: the Library tab. The
// way into Collections, the Status segments with counts, then the books on
// shelves. The Shelf toggle picks how they stand:
//   spines — a bookcase; a typed sticker on each spine carries the date
//            (added / started / finished), a mustard dot the rating;
//   stacks — piles of books lying down, spine out: a legible list;
//   covers — face-out on shelves, date and rating on the shelf edge.
// Finished adds the *Not finished* filter; the abandoned book leans with a
// slip in it, the re-read one carries "2×".
import { computed } from 'vue'
import type { LibraryEntry, Status } from '../../../data'
import { formatDate, formatRating, latestSession } from '../../../data'
import Chip from '../kit/Chip.vue'
import Cover from '../kit/Cover.vue'
import Icon from '../kit/Icon.vue'
import LyingBook from '../kit/LyingBook.vue'
import NavBar from '../kit/NavBar.vue'
import Plank from '../kit/Plank.vue'
import Segmented from '../kit/Segmented.vue'
import Spine from '../kit/Spine.vue'
import Stars from '../kit/Stars.vue'
import TabBar from '../kit/TabBar.vue'
import { daysBetween, packRows, paint, stickerDate, thickness } from '../kit/paint'
import { useShelf } from '../kit/useShelf'

const props = defineProps<{ status: Status }>()
const { data, view, palette } = useShelf()

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

interface Item {
  entry: LibraryEntry
  date: string | null
  rating: number | null
  abandoned: boolean
  reads: number
}

const items = computed<Item[]>(() =>
  entries.value.map((entry) => {
    const latest = latestSession(entry)
    const date =
      props.status === 'want_to_read'
        ? entry.addedOn
        : props.status === 'reading'
          ? (latest?.startedOn ?? null)
          : (latest?.endedOn ?? null)
    return {
      entry,
      date,
      rating: latest?.outcome === 'finished' ? latest.rating : null,
      abandoned: latest?.outcome === 'abandoned',
      reads: entry.sessions.length,
    }
  }),
)

const SHELF = 318
const rows = computed(() => packRows(items.value, (item) => thickness(item.entry.book.pageCount), SHELF, 1, 3))
/** A single, short shelf gets slightly bigger books, like a hardcover edition on display. */
const spineScale = computed(() => {
  if (rows.value.length > 1) return 1
  const used = items.value.reduce((sum, item) => sum + thickness(item.entry.book.pageCount) + 3, 0)
  const room = props.status === 'reading' ? 120 : SHELF
  return Math.max(1, Math.min(1.16, room / used))
})
const coverRows = computed(() => {
  const out: Item[][] = []
  for (let i = 0; i < items.value.length; i += 3) out.push(items.value.slice(i, i + 3))
  return out
})

const legend = computed(() =>
  props.status === 'want_to_read'
    ? 'Stickers show the day you added a book'
    : props.status === 'reading'
      ? 'Stickers show the day you started'
      : 'Stickers show the day you finished',
)

const collectionSpines = computed(() =>
  data.value.collections.map((c) => paint(data.value.collectionEntries(c)[0]!.book, palette.value).bg),
)

function dayOf(item: Item) {
  return item.date ? daysBetween(item.date, data.value.today) + 1 : null
}
</script>

<template>
  <div class="screen c-paper-grain">
    <NavBar title="Library" avatar />

    <div class="controls">
      <div class="collections">
        <span class="mini" aria-hidden="true">
          <span v-for="(color, i) in collectionSpines" :key="i" class="mini-spine" :style="{ background: color }" />
        </span>
        <span class="collections-label">Collections</span>
        <span class="collections-count">{{ data.collections.length }}</span>
        <Icon name="chevron" :size="18" class="chev" />
      </div>

      <Segmented :options="segments" :value="status" />

      <div v-if="status === 'finished'" class="filters">
        <Chip selected>All</Chip>
        <Chip><Icon name="flag" :size="15" />Not finished · {{ data.notFinished.length }}</Chip>
      </div>
    </div>

    <!-- Spines: a bookcase -->
    <div v-if="view === 'spines'" class="case">
      <p class="legend">
        <span class="legend-sticker">2<br />OCT</span>{{ legend }}<template v-if="status === 'finished'"
          >, <span class="legend-dot" />the rating</template
        >
      </p>
      <Plank
        v-for="(row, r) in rows"
        :key="r"
        :gap="3"
        :bookend="r === rows.length - 1 && status !== 'reading'"
        class="row"
      >
        <Spine
          v-for="item in row"
          :key="item.entry.id"
          :book="item.entry.book"
          :sticker="stickerDate(item.date)"
          :rating="item.rating"
          :reads="item.reads"
          :bookmark="status === 'reading'"
          :slip="item.abandoned"
          :lean="item.abandoned ? -6 : 0"
          :scale="spineScale"
        />
        <div v-if="status === 'reading'" class="talker">
          <span class="talker-pin" />
          <span class="talker-title">On the go</span>
          <span v-for="item in items" :key="item.entry.id" class="talker-line">
            <b>Day {{ dayOf(item) }}</b> of {{ item.entry.book.title }}
          </span>
        </div>
      </Plank>
      <div v-if="rows.length === 1" class="ghost">
        <span class="ghost-books" aria-hidden="true">
          <span v-for="n in 5" :key="n" class="ghost-spine" :style="{ height: `${86 + ((n * 23) % 4) * 9}px` }" />
        </span>
        <span v-if="status === 'reading'" class="ghost-text">
          <b>Room for one more?</b>
          Start a book from Want to read and it moves onto this shelf.
        </span>
        <span v-else class="ghost-text">
          <b>A shelf to fill</b>
          Find your next book in Search, or tap + on any result.
        </span>
      </div>
    </div>

    <!-- Stacks: piles of books lying down -->
    <div v-else-if="view === 'stacks'" class="stacks">
      <LyingBook
        v-for="item in items"
        :key="item.entry.id"
        :book="item.entry.book"
        :bookmark="status === 'reading'"
        :jitter="10"
      >
        <template #label>
          <span class="label" :class="{ muted: item.abandoned }">
            <span v-if="item.abandoned" class="label-flag">Not finished</span>
            <span v-else-if="item.rating" class="label-dot">{{ formatRating(item.rating) }}</span>
            <span v-if="item.reads > 1" class="label-reads">{{ item.reads }}×</span>
            <span class="label-date">{{ formatDate(item.date, 'short') }}</span>
          </span>
        </template>
      </LyingBook>
      <span class="stack-base c-wood" />
    </div>

    <!-- Covers: face-out on shelves -->
    <div v-else class="covers">
      <div v-for="(row, r) in coverRows" :key="r" class="cover-row">
        <Plank :gap="18" :inset="20">
          <div v-for="item in row" :key="item.entry.id" class="cover-cell">
            <Cover :book="item.entry.book" :width="92" :tilt="item.abandoned ? -4 : 0" />
            <span v-if="item.abandoned" class="cover-slip">DNF</span>
          </div>
        </Plank>
        <div class="captions">
          <span v-for="item in row" :key="item.entry.id" class="caption">
            <template v-if="item.abandoned">Not finished</template>
            <Stars v-else-if="item.rating" :rating="item.rating" :size="10" :gap="1" />
            <span class="caption-date"
              >{{ status === 'want_to_read' ? 'Added ' : status === 'reading' ? 'Since ' : ''
              }}{{ formatDate(item.date, 'short') }}<template v-if="item.reads > 1"> · 2×</template></span
            >
          </span>
        </div>
      </div>
    </div>

    <TabBar active="library" />
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

.controls {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 10px 20px 0;
}

.collections {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 56px;
  padding: 0 14px 0 12px;
  border-radius: 18px;
  background: var(--c-card);
  box-shadow: 0 0 0 1px var(--c-line);
}

.mini {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 30px;
  padding: 0 4px;
  border-bottom: 3px solid var(--c-wood);
  border-radius: 0 0 2px 2px;
}

.mini-spine {
  width: 7px;
  height: 24px;
  border-radius: 2px;
}

.mini-spine:nth-child(2) {
  height: 20px;
}

.mini-spine:nth-child(3) {
  height: 22px;
  transform: rotate(10deg);
  transform-origin: bottom left;
}

.collections-label {
  flex: 1;
  font-size: 17px;
  font-weight: 800;
}

.collections-count {
  font-size: 15px;
  font-weight: 600;
  color: var(--c-ink-soft);
}

.chev {
  color: var(--c-muted);
}

.filters {
  display: flex;
  gap: 8px;
}

/* --- Spines ----------------------------------------------------------- */

.case {
  display: flex;
  flex-direction: column;
  gap: 22px;
  padding-top: 14px;
}

.legend {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0 0 -6px;
  padding: 0 20px;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--c-ink-soft);
}

.legend-sticker {
  display: inline-block;
  padding: 2px 3px 1px;
  border-radius: 2px;
  background: #fbf6ea;
  color: #2b1d14;
  font-family: var(--c-mono);
  font-size: 7px;
  font-weight: 700;
  line-height: 1;
  text-align: center;
  box-shadow: 0 0 0 0.5px rgb(0 0 0 / 0.25);
}

.legend-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  margin: 0 4px 0 2px;
  border-radius: 50%;
  background: var(--c-mustard);
  vertical-align: -1px;
}

.row {
  margin: 0 8px;
}

/* A bookshop shelf-talker leaning on the books. */
.talker {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-self: flex-end;
  width: 168px;
  margin: 0 0 6px 18px;
  padding: 14px 14px 12px;
  border-radius: 6px;
  background: var(--c-card);
  transform: rotate(2.5deg);
  box-shadow:
    0 0 0 1px var(--c-line),
    0 8px 14px -8px rgb(var(--c-shadow) / 0.4);
}

.talker-pin {
  position: absolute;
  top: -6px;
  left: 50%;
  width: 34px;
  height: 12px;
  margin-left: -17px;
  background: color-mix(in srgb, var(--c-mustard) 65%, transparent);
  transform: rotate(-4deg);
}

.talker-title {
  font-family: var(--c-serif);
  font-size: 17px;
}

.talker-line {
  font-size: 12.5px;
  line-height: 1.3;
  color: var(--c-ink-soft);
}

.talker-line b {
  color: var(--c-accent-deep);
}

[data-palette='ink'] .talker-line b {
  color: var(--c-accent);
}

/* Next to an almost empty shelf: a pencil sketch of the next one. */
.ghost {
  display: flex;
  align-items: flex-end;
  gap: 18px;
  margin: 6px 20px 0;
  padding: 0 4px 0 14px;
  border-bottom: 2px dashed var(--c-line-strong);
}

.ghost-books {
  display: flex;
  align-items: flex-end;
  gap: 3px;
}

.ghost-spine {
  width: 22px;
  border: 1.5px dashed var(--c-line-strong);
  border-bottom: 0;
  border-radius: 4px 4px 0 0;
}

.ghost-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-bottom: 12px;
  font-size: 14px;
  line-height: 1.35;
  color: var(--c-ink-soft);
}

.ghost-text b {
  font-size: 15px;
  color: var(--c-ink);
}

/* --- Stacks ----------------------------------------------------------- */

.stacks {
  display: flex;
  flex-direction: column;
  padding: 18px 20px 0;
}

.stack-base {
  height: 12px;
  margin: 1px -6px 0;
  border-radius: 4px;
}

.label {
  position: relative;
  z-index: 1;
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 7px 0 4px;
  border-radius: 6px;
  background: #fbf6ea;
  color: #2b1d14;
  box-shadow: 0 0.5px 1.5px rgb(0 0 0 / 0.3);
}

.label-date {
  padding-left: 3px;
  font-family: var(--c-mono);
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
}

.label-dot {
  display: grid;
  place-items: center;
  height: 19px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--c-mustard);
  font-size: 11px;
  font-weight: 800;
}

.label-reads {
  padding: 1px 4px;
  border-radius: 4px;
  background: #2b1d14;
  color: #fbf6ea;
  font-size: 10.5px;
  font-weight: 800;
}

.label-flag {
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #8a6f5a;
}

/* --- Covers ----------------------------------------------------------- */

.covers {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding-top: 20px;
}

.cover-row {
  margin: 0 8px;
}

.cover-cell {
  position: relative;
}

.cover-slip {
  position: absolute;
  top: 10px;
  right: -8px;
  padding: 2px 6px;
  border-radius: 3px;
  background: var(--c-card);
  font-family: var(--c-mono);
  font-size: 11px;
  font-weight: 700;
  transform: rotate(8deg);
  box-shadow: 0 2px 6px -2px rgb(var(--c-shadow) / 0.5);
}

.captions {
  display: flex;
  gap: 18px;
  padding: 8px 20px 0;
}

.caption {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 92px;
  font-size: 12px;
  font-weight: 600;
  color: var(--c-ink-soft);
}

.caption-date {
  font-family: var(--c-mono);
  font-size: 12px;
  font-weight: 700;
  color: var(--c-ink);
}
</style>
