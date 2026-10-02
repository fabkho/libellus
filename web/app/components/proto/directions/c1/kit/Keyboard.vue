<script setup lang="ts">
// The iOS keyboard, tinted to the room, for screens shown mid-typing:
// predictive bar, three letter rows, the bottom row with a "search" key.
import Icon from './Icon.vue'

defineProps<{ suggestions?: string[]; action?: string }>()

const rows = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm']
</script>

<template>
  <div class="kb">
    <div class="predict">
      <span v-for="(word, i) in suggestions ?? ['Le Guin', 'legend', 'leg']" :key="word" class="word" :class="{ first: i === 0 }">{{
        word
      }}</span>
    </div>
    <div class="row">
      <span v-for="key in rows[0]" :key="key" class="key">{{ key }}</span>
    </div>
    <div class="row mid">
      <span v-for="key in rows[1]" :key="key" class="key">{{ key }}</span>
    </div>
    <div class="row">
      <span class="key fn wide"><Icon name="shift" :size="20" /></span>
      <span class="gap" />
      <span v-for="key in rows[2]" :key="key" class="key">{{ key }}</span>
      <span class="gap" />
      <span class="key fn wide"><Icon name="delete" :size="22" /></span>
    </div>
    <div class="row">
      <span class="key fn num">123</span>
      <span class="key space">space</span>
      <span class="key go">{{ action ?? 'search' }}</span>
    </div>
    <div class="extras">
      <Icon name="globe" :size="26" />
      <Icon name="mic" :size="26" />
    </div>
  </div>
</template>

<style scoped>
.kb {
  position: absolute;
  inset: auto 0 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 11px;
  height: 336px;
  padding: 0 3px;
  background: var(--c1-keyboard);
  font-family: -apple-system, 'SF Pro Text', system-ui, sans-serif;
  color: var(--c1-ink);
}

.predict {
  display: flex;
  height: 44px;
  align-items: center;
  margin: 0 -3px -2px;
}

.word {
  flex: 1;
  text-align: center;
  font-size: 16px;
  border-left: 1px solid rgb(var(--c1-shadow) / 0.15);
}

.word.first {
  border-left: 0;
}

.row {
  display: flex;
  gap: 6px;
  justify-content: center;
  padding: 0 0;
}

.row.mid {
  padding: 0 18px;
}

.key {
  display: grid;
  flex: 1;
  place-items: center;
  height: 42px;
  border-radius: 5px;
  background: var(--c1-key);
  font-size: 22px;
  font-weight: 400;
  box-shadow: 0 1px 0 rgb(0 0 0 / 0.3);
}

.fn {
  background: color-mix(in srgb, var(--c1-keyboard) 60%, #8b8b8b);
  font-size: 16px;
}

[data-theme='dark'] .fn {
  background: color-mix(in srgb, var(--c1-key) 60%, #000);
}

.wide {
  flex: 0 0 42px;
}

.gap {
  flex: 0 0 6px;
}

.num {
  flex: 0 0 92px;
}

.space {
  flex: 1;
  font-size: 16px;
}

.go {
  flex: 0 0 92px;
  background: var(--c1-accent);
  color: var(--c1-accent-ink);
  font-size: 16px;
  font-weight: 600;
}

.extras {
  display: flex;
  justify-content: space-between;
  padding: 8px 22px 0;
  color: var(--c1-ink-soft);
}
</style>
