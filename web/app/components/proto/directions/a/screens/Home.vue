<script setup lang="ts">
// home: Currently reading as large cover cards (a carousel, the next one
// peeking), the "Read in 2026" counter, Up next as a shelf of covers that runs
// under the floating tab bar.
import { computed } from 'vue'
import { formatAuthors, formatDate, latestSession, type LibraryEntry } from '../../../data'
import { useProto } from '../../../contract'
import Cover from '../kit/Cover.vue'
import LargeTitle from '../kit/LargeTitle.vue'
import Pill from '../kit/Pill.vue'
import SectionHead from '../kit/SectionHead.vue'
import TabBar from '../kit/TabBar.vue'
import Icon from '../kit/Icon.vue'

const proto = useProto()
const data = computed(() => proto.value.data)

const DAY = 86_400_000
function daysIn(entry: LibraryEntry) {
  const started = latestSession(entry)?.startedOn
  if (!started) return null
  return Math.round((Date.parse(data.value.today) - Date.parse(started)) / DAY) + 1
}

/** The latest finished covers, fanned behind the counter. */
const recent = computed(() =>
  data.value.finished.filter((e) => latestSession(e)?.outcome === 'finished' && e.book.coverUrl).slice(0, 3),
)
</script>

<template>
  <div class="screen">
    <LargeTitle title="Home" avatar />

    <section class="reading">
      <div class="pad"><SectionHead title="Currently reading" /></div>
      <div class="carousel">
        <article v-for="entry in data.reading" :key="entry.id" class="card a-squircle">
          <div
            class="wash"
            :style="{
              '--d': entry.book.coverColors?.dominant ?? '#d8c8ad',
              '--s': entry.book.coverColors?.secondary ?? '#9fb0a4',
            }"
          >
            <Cover :book="entry.book" :height="150" shadow="lift" />
          </div>
          <div class="body">
            <p class="since">
              Since {{ formatDate(latestSession(entry)?.startedOn ?? null, 'short') }}
              <span class="dot">·</span> day {{ daysIn(entry) }}
            </p>
            <h3 class="a-serif">{{ entry.book.title }}</h3>
            <p class="author">{{ formatAuthors(entry.book.authors) }}</p>
            <div class="actions">
              <Pill size="md" icon="check">Finish</Pill>
              <span class="more" role="button" aria-label="More"><Icon name="more" :size="20" /></span>
            </div>
          </div>
        </article>
      </div>
    </section>

    <section class="counter a-squircle">
      <div class="count">
        <span class="label">Read in {{ data.readInYear.year }}</span>
        <span class="number a-serif a-num">{{ data.readInYear.count }}</span>
        <span class="unit">books finished</span>
      </div>
      <div class="fan" aria-hidden="true">
        <span v-for="(entry, i) in recent" :key="entry.id" class="fan-item" :style="{ '--i': i }">
          <Cover :book="entry.book" :height="74" shadow="soft" />
        </span>
      </div>
    </section>

    <section class="next">
      <div class="pad">
        <SectionHead title="Up next" chevron>
          <template #trailing><span class="see">{{ data.wantToRead.length }} want to read</span></template>
        </SectionHead>
      </div>
      <div class="shelf">
        <Cover v-for="entry in data.upNext" :key="entry.id" :book="entry.book" :height="138" />
      </div>
    </section>

    <TabBar active="home" />
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

.pad {
  padding: 0 20px;
}

.reading {
  margin-top: 20px;
}

.carousel {
  display: flex;
  gap: 12px;
  margin-top: 12px;
  padding: 0 20px;
}

.card {
  display: flex;
  flex: 0 0 300px;
  flex-direction: column;
  overflow: hidden;
  border-radius: 28px;
  background: var(--a-card);
  box-shadow: var(--a-card-shadow);
}

.wash {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 184px;
  padding-bottom: 0;
  overflow: hidden;
  background:
    radial-gradient(120% 90% at 15% 0%, color-mix(in oklab, var(--d) 55%, white) 0%, transparent 70%),
    radial-gradient(90% 80% at 100% 30%, color-mix(in oklab, var(--s) 45%, white) 0%, transparent 70%),
    color-mix(in oklab, var(--d) 22%, var(--a-card));
}

.body {
  padding: 13px 18px 16px;
}

.since {
  margin: 0;
  color: var(--a-ink-3);
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.dot {
  margin: 0 2px;
}

h3 {
  margin: 4px 0 0;
  overflow: hidden;
  font-size: 22px;
  font-weight: 600;
  line-height: 1.15;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.author {
  margin: 2px 0 0;
  color: var(--a-ink-2);
  font-size: 15px;
}

.actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12px;
}

.more {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 999px;
  background: var(--a-fill);
  color: var(--a-ink-2);
}

.counter {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 16px 20px 0;
  padding: 10px 18px 10px 20px;
  border-radius: 24px;
  background: var(--a-card);
  box-shadow: var(--a-card-shadow);
}

.count {
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-areas: 'label label' 'number unit';
  align-items: baseline;
  column-gap: 8px;
}

.label {
  grid-area: label;
  color: var(--a-ink-2);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.number {
  grid-area: number;
  font-size: 40px;
  font-weight: 500;
  line-height: 1.05;
}

.unit {
  grid-area: unit;
  color: var(--a-ink-2);
  font-size: 15px;
}

.fan {
  position: relative;
  width: 108px;
  height: 80px;
}

.fan-item {
  position: absolute;
  bottom: 0;
  right: calc(var(--i) * 26px);
  z-index: calc(3 - var(--i));
  transform: rotate(calc((1 - var(--i)) * -5deg));
  transform-origin: bottom center;
}

.next {
  margin-top: 22px;
}

.see {
  color: var(--a-ink-3);
  font-size: 14px;
}

.shelf {
  display: flex;
  align-items: flex-end;
  gap: 14px;
  margin-top: 12px;
  padding: 0 20px;
}
</style>
