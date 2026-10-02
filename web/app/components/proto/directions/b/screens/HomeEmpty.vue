<script setup lang="ts">
// home-empty: the first issue, still blank. The masthead as on Home, an empty
// plate where the feature will go, a short invitation and one way forward:
// search for a book.
import { computed } from 'vue'
import { formatDate } from '../../../data'
import { useProto } from '../../../contract'
import Avatar from '../kit/Avatar.vue'
import Button from '../kit/Button.vue'
import Icon from '../kit/Icon.vue'
import Kicker from '../kit/Kicker.vue'
import TabBar from '../kit/TabBar.vue'
import { fullDate, isoWeek, weekday } from '../kit/type'

const proto = useProto()
const data = computed(() => proto.value.data)
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

      <div class="blank">
        <figure class="plate">
          <span class="frame"><span class="hole" /></span>
          <figcaption>Pl. I — awaiting a cover</figcaption>
        </figure>
      </div>

      <h2 class="b-display headline">The first issue is <em>still blank.</em></h2>
      <p class="lede">
        Find the book on your nightstand, or one you mean to read. It will be set here, with the date you began.
      </p>
      <span class="cta"><Button><Icon name="search" :size="20" :stroke="1.5" />Find a book</Button></span>
      <p class="since b-italic b-faint">Your Library is empty · {{ formatDate(data.today) }}</p>
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
}

.title-row :deep(.avatar) {
  margin-right: -5px;
}

.dateline {
  display: flex;
  justify-content: space-between;
  padding-top: 6px;
  font-size: 10px;
  color: var(--b-ink-2);
}

.page {
  display: flex;
  flex-direction: column;
  padding: 16px var(--b-margin) 0;
}

.blank {
  display: flex;
  justify-content: center;
  padding: 24px 0 8px;
}

.plate {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin: 0;
}

.frame {
  display: flex;
  padding: 6px;
  border: 1px solid var(--b-rule);
}

/* An empty plate: a hairline box crossed corner to corner, like a printer's
   placeholder for an image still to come. */
.hole {
  width: 112px;
  height: 168px;
  background:
    linear-gradient(to top right, transparent calc(50% - 0.5px), var(--b-rule) 50%, transparent calc(50% + 0.5px)),
    linear-gradient(to bottom right, transparent calc(50% - 0.5px), var(--b-rule) 50%, transparent calc(50% + 0.5px)),
    var(--b-paper-2);
}

figcaption {
  margin-top: 8px;
  font-size: 12px;
  font-style: italic;
  line-height: 16px;
  color: var(--b-ink-3);
}

.headline {
  --size: 40;
  margin: 20px 0 0;
  line-height: 1;
}

.headline em {
  color: var(--b-accent);
}

.lede {
  margin: 12px 0 0;
  font-size: 17px;
  line-height: 24px;
  color: var(--b-ink-2);
}

.cta {
  display: block;
  margin-top: 22px;
}

.since {
  margin: 12px 0 0;
  font-size: 13px;
  line-height: 20px;
  text-align: center;
}
</style>
