<script setup lang="ts">
// home: the books on the nightstand. Each Currently reading card is lit by its
// own cover; then the year's tally and the Up next row.
import { formatAuthors, formatDate, latestSession } from '../../../data'
import { useProto } from '../../../contract'
import Ambient from '../kit/Ambient.vue'
import Avatar from '../kit/Avatar.vue'
import Button from '../kit/Button.vue'
import Cover from '../kit/Cover.vue'
import Icon from '../kit/Icon.vue'
import TabBar from '../kit/TabBar.vue'
import { daysBetween } from '../kit/night'

const proto = useProto()
const started = (id: string) => latestSession(proto.value.data.entry(id))?.startedOn ?? null
</script>

<template>
  <div class="page">
    <header class="head">
      <div>
        <p class="d-eyebrow">Friday · {{ formatDate(proto.data.today, 'short') }}</p>
        <h1 class="hello">Good evening, {{ proto.data.member.firstName }}</h1>
      </div>
      <Avatar />
    </header>

    <section class="block">
      <div class="label">
        <span class="d-eyebrow">Currently reading</span>
        <span class="d-eyebrow count">{{ proto.data.reading.length }}</span>
      </div>

      <article v-for="entry in proto.data.reading" :key="entry.id" class="card">
        <Ambient :colors="entry.book.coverColors" shape="card" />
        <Cover :book="entry.book" :width="82" halo />
        <div class="info">
          <h2 class="d-title book">{{ entry.book.title }}</h2>
          <p class="author">{{ formatAuthors(entry.book.authors) }}</p>
          <p class="since d-mono">
            <span>Since {{ formatDate(started(entry.id), 'short') }}</span>
            <span class="sep" />
            <span>day {{ daysBetween(started(entry.id)) }}</span>
          </p>
          <div class="actions">
            <Button size="sm" tone="quiet"><Icon name="check" :size="15" :stroke="1.8" />Finish</Button>
          </div>
        </div>
      </article>
    </section>

    <section class="tally">
      <div class="tally-text">
        <span class="tally-label">Read in {{ proto.data.readInYear.year }}</span>
        <span class="ticks" aria-hidden="true">
          <span v-for="n in proto.data.readInYear.count" :key="n" class="tick" :class="{ fifth: n % 5 === 0 }" />
        </span>
      </div>
      <span class="tally-count d-num">{{ proto.data.readInYear.count }}</span>
    </section>

    <section class="block">
      <div class="label">
        <span class="d-eyebrow">Up next</span>
        <span class="see">See all {{ proto.data.wantToRead.length }}<Icon name="chevron" :size="13" :stroke="1.8" /></span>
      </div>
      <div class="shelf">
        <div v-for="entry in proto.data.upNext" :key="entry.id" class="spine">
          <Cover :book="entry.book" :width="72" />
        </div>
      </div>
    </section>

    <TabBar active="home" />
  </div>
</template>

<style scoped>
.page {
  position: relative;
  height: 100%;
  overflow: hidden;
  background: var(--d-bg);
}

.head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  padding: calc(var(--safe-top) + 14px) 20px 0;
}

.hello {
  margin-top: 8px;
  font-size: 24px;
  font-weight: 500;
  line-height: 1.1;
  letter-spacing: -0.025em;
}

.block {
  padding: 0 16px;
  margin-top: 22px;
}

.label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 20px;
  margin: 0 4px 10px;
}

.count {
  color: var(--d-ink-4);
}

.card {
  position: relative;
  display: flex;
  gap: 16px;
  padding: 14px;
  margin-bottom: 10px;
  overflow: hidden;
  border-radius: 20px;
  background: var(--d-raised);
  box-shadow: inset 0 0 0 0.5px var(--d-line);
}

.info {
  position: relative;
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  padding-top: 2px;
}

.book {
  font-size: calc(19px * var(--d-title-k));
  line-height: 1.12;
}

.author {
  margin-top: 4px;
  font-size: 13.5px;
  color: var(--d-ink-2);
}

.since {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  font-size: 11px;
  color: var(--d-ink-3);
}

.sep {
  width: 2px;
  height: 2px;
  border-radius: 9px;
  background: currentColor;
}

.actions {
  display: flex;
  margin-top: auto;
}

.tally {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 14px 20px 0;
  padding: 12px 0;
  border-block: 0.5px solid var(--d-line-2);
}

.tally-text {
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.tally-label {
  font-size: 13.5px;
  color: var(--d-ink-2);
}

.ticks {
  display: flex;
  gap: 4px;
  height: 14px;
}

.tick {
  width: 1px;
  height: 100%;
  background: var(--d-lamp);
  opacity: 0.85;
}

.tick.fifth {
  margin-right: 6px;
}

.tally-count {
  font-size: 44px;
  font-weight: 300;
  line-height: 1;
  letter-spacing: -0.04em;
}

.see {
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: 12.5px;
  color: var(--d-ink-3);
}

.shelf {
  display: flex;
  gap: 12px;
  margin-right: -16px;
  padding: 0 4px;
}

.spine {
  display: flex;
  width: 72px;
  flex-direction: column;
  gap: 7px;
}

.spine-title {
  font-size: 11px;
  color: var(--d-ink-3);
}
</style>
