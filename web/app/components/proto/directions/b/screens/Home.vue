<script setup lang="ts">
// home: the week's issue. Masthead and dateline, the books being read set as
// features (the lead one larger, the second mirrored), the "Read in 2026"
// figure as a stat block, and Up next as a strip of small plates.
import { computed } from 'vue'
import { formatAuthors, formatDate, latestSession } from '../../../data'
import { useProto } from '../../../contract'
import Avatar from '../kit/Avatar.vue'
import Button from '../kit/Button.vue'
import Cover from '../kit/Cover.vue'
import Kicker from '../kit/Kicker.vue'
import TabBar from '../kit/TabBar.vue'
import { dayOf, firstSentence, fullDate, isoWeek, roman, weekday } from '../kit/type'

const proto = useProto()
const data = computed(() => proto.value.data)
const features = computed(() =>
  data.value.reading.map((entry, i) => {
    const started = latestSession(entry)?.startedOn ?? data.value.today
    return {
      entry,
      lead: i === 0,
      started,
      day: dayOf(started, data.value.today),
    }
  }),
)
</script>

<template>
  <div class="home">
    <header class="masthead">
      <div class="title-row">
        <h1 class="b-display wordmark">Libellus</h1>
        <Avatar />
      </div>
      <div class="b-rule-double" />
      <div class="dateline b-label">
        <span>{{ weekday(data.today) }}, {{ fullDate(data.today) }}</span>
        <span>No. {{ isoWeek(data.today) }}</span>
      </div>
    </header>

    <main class="page">
      <Kicker label="Now reading" />

      <article v-for="feature in features" :key="feature.entry.id" class="feature" :class="{ lead: feature.lead }">
        <Cover
          :book="feature.entry.book"
          :width="feature.lead ? 100 : 64"
          plate
          :caption="`Pl. ${roman(feature.lead ? 1 : 2)}`"
        />
        <div class="story">
          <h2 class="b-display headline" :style="{ '--size': feature.lead ? 34 : 30 }">{{ feature.entry.book.title }}</h2>
          <p class="byline b-italic">{{ formatAuthors(feature.entry.book.authors) }}</p>
          <p v-if="feature.lead" class="standfirst">{{ firstSentence(feature.entry.book.description) }}</p>
          <p class="meta b-faint">
            Begun {{ formatDate(feature.started, 'short') }} · <span class="b-figures">day {{ feature.day }}</span>
          </p>
          <span class="finish"><Button tone="outline" compact>Finish</Button></span>
        </div>
      </article>

      <section class="tally">
        <span class="figure b-display">{{ data.readInYear.count }}</span>
        <span class="words">
          <span class="b-label">Read in {{ data.readInYear.year }}</span>
          <span class="b-italic b-muted">books finished this year, re-reads included</span>
        </span>
      </section>

      <section class="up-next">
        <Kicker label="Up next"><span>See all {{ data.wantToRead.length }}</span></Kicker>
        <div class="strip">
          <figure v-for="(entry, i) in data.upNext" :key="entry.id" class="next">
            <Cover :book="entry.book" :height="80" />
            <figcaption class="b-figures">{{ i + 1 }}</figcaption>
          </figure>
        </div>
      </section>
    </main>

    <TabBar active="home" />
  </div>
</template>

<style scoped>
.home {
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
  padding-bottom: 4px;
}

.wordmark {
  --size: 46;
  margin: 0 0 -4px;
  line-height: 1;
}

.title-row :deep(.avatar) {
  margin-right: -5px;
  margin-bottom: 0;
}

.dateline {
  display: flex;
  justify-content: space-between;
  padding-top: 6px;
  color: var(--b-ink-2);
  font-size: 10px;
}

.page {
  display: flex;
  flex-direction: column;
  padding: 16px var(--b-margin) 0;
}

.feature {
  display: flex;
  gap: 16px;
  padding: 12px 0 14px;
}

.feature + .feature {
  flex-direction: row-reverse;
  border-top: 1px solid var(--b-rule);
}

.feature + .feature .story {
  align-items: flex-start;
}

.story {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  padding-top: 4px;
}

.headline {
  margin: 0;
  line-height: 0.98;
}

.byline {
  margin: 8px 0 0;
  font-size: 17px;
  line-height: 20px;
}

.standfirst {
  display: -webkit-box;
  margin: 8px 0 0;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  font-size: 14px;
  line-height: 20px;
  color: var(--b-ink-2);
}

.meta {
  margin: 6px 0 0;
  font-size: 13px;
  line-height: 20px;
}

.finish {
  display: block;
  width: 108px;
  margin-top: auto;
  padding-top: 12px;
}

.feature:not(.lead) .finish {
  width: 108px;
}

.tally {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 6px 0 8px;
  border-top: 1px solid var(--b-rule-strong);
  border-bottom: 1px solid var(--b-rule-strong);
}

.tally .figure {
  --size: 50;
  min-width: 50px;
  color: var(--b-accent);
  line-height: 0.85;
  font-variant-numeric: lining-nums;
}

.words {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.words .b-italic {
  font-size: 15px;
  line-height: 20px;
}

.up-next {
  padding-top: 16px;
}

.strip {
  display: flex;
  align-items: flex-end;
  gap: 14px;
  margin-right: calc(var(--b-margin) * -1);
  padding-top: 10px;
  overflow: hidden;
}

.next {
  display: flex;
  flex-shrink: 0;
  flex-direction: column;
  margin: 0;
}

.next figcaption {
  padding-top: 4px;
  font-size: 11px;
  font-style: italic;
  line-height: 16px;
  color: var(--b-ink-3);
}
</style>
