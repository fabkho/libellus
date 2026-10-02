<script setup lang="ts">
// home-empty: a new Member, an empty Library. An empty shelf under the lamp,
// and one way forward — the search palette, waiting to be tapped.
import { useProto } from '../../../contract'
import { formatDate } from '../../../data'
import Avatar from '../kit/Avatar.vue'
import Icon from '../kit/Icon.vue'
import TabBar from '../kit/TabBar.vue'

const proto = useProto()
</script>

<template>
  <div class="page">
    <header class="head">
      <div>
        <p class="dl-eyebrow">Friday · {{ formatDate(proto.data.today, 'short') }}</p>
        <h1 class="hello">Welcome, {{ proto.data.member.firstName }}</h1>
      </div>
      <Avatar />
    </header>

    <div class="scene" aria-hidden="true">
      <span class="pool" />
      <svg width="240" height="250" viewBox="0 0 240 250" fill="none" class="art">
        <!-- a reading lamp over an empty shelf: cord, shade, cone of light -->
        <path d="M120 0v52" stroke="currentColor" stroke-width="1" />
        <path d="M104 52h32l12 26H92z" stroke="currentColor" stroke-width="1" stroke-linejoin="round" />
        <path d="M92 78 52 214h136L148 78" fill="url(#dl-cone)" />
        <rect x="80" y="132" width="22" height="82" rx="2" stroke="currentColor" stroke-width="1" />
        <rect x="106" y="146" width="18" height="68" rx="2" stroke="currentColor" stroke-width="1" />
        <rect
          x="132"
          y="140"
          width="20"
          height="74"
          rx="2"
          stroke="currentColor"
          stroke-width="1"
          stroke-dasharray="3 4"
          transform="rotate(12 142 214)"
        />
        <path d="M36 214.5h168" stroke="currentColor" stroke-width="1" />
        <defs>
          <linearGradient id="dl-cone" x1="120" y1="78" x2="120" y2="214" gradientUnits="userSpaceOnUse">
            <stop stop-color="#efb768" stop-opacity="0.22" />
            <stop offset="1" stop-color="#efb768" stop-opacity="0" />
          </linearGradient>
        </defs>
      </svg>
    </div>

    <div class="copy">
      <p class="title">Nothing on the shelf yet</p>
      <p class="text">Find the book on your nightstand, or the one you want to read next.</p>
    </div>

    <div class="palette">
      <Icon name="search" :size="19" />
      <span>Title, author or ISBN</span>
    </div>

    <TabBar active="home" />
  </div>
</template>

<style scoped>
.page {
  position: relative;
  height: 100%;
  overflow: hidden;
  background: var(--dl-bg);
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

.scene {
  position: relative;
  display: flex;
  height: 250px;
  margin-top: 64px;
  align-items: flex-end;
  justify-content: center;
}

.pool {
  position: absolute;
  inset: 40px 20px -40px;
  background: radial-gradient(50% 50% at 50% 60%, rgb(239 183 104 / 0.14), transparent 72%);
}

.art {
  position: relative;
  color: var(--dl-ink-3);
}

.copy {
  padding: 26px 40px 0;
  text-align: center;
}

.title {
  font-family: var(--dl-title-font);
  font-size: calc(22px * var(--dl-title-k));
  font-weight: 500;
  letter-spacing: var(--dl-title-tracking);
}

.text {
  margin-top: 8px;
  font-size: 14.5px;
  line-height: 1.45;
  color: var(--dl-ink-2);
}

.palette {
  display: flex;
  height: 52px;
  margin: 30px 24px 0;
  align-items: center;
  gap: 10px;
  padding: 0 18px;
  border-radius: 18px;
  background: var(--dl-raised);
  box-shadow:
    inset 0 0 0 0.5px var(--dl-line-2),
    0 0 0 4px var(--dl-lamp-soft),
    0 20px 50px rgb(0 0 0 / 0.4);
  font-size: 16px;
  color: var(--dl-ink-3);
}
</style>
