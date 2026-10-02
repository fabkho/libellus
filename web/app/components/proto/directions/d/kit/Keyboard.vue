<script setup lang="ts">
// The iOS keyboard, warm dark appearance, with the predictive bar — drawn so a
// typing frame reads as typing. `action` labels the return key.
import Icon from './Icon.vue'

withDefaults(defineProps<{ action?: string; suggestions?: string[] }>(), {
  action: 'search',
  suggestions: () => ['“le gu”', 'le guin', 'leg'],
})

const rows = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm']
</script>

<template>
  <div class="k-keyboard" aria-hidden="true">
    <div class="predict">
      <span v-for="(word, i) in suggestions" :key="word" class="word" :class="{ mid: i === 1 }">{{ word }}</span>
    </div>
    <div class="keys">
      <div class="row">
        <span v-for="k in rows[0]" :key="k" class="key">{{ k }}</span>
      </div>
      <div class="row inset">
        <span v-for="k in rows[1]" :key="k" class="key">{{ k }}</span>
      </div>
      <div class="row">
        <span class="key mod wide"><Icon name="shift" :size="20" :stroke="1.4" /></span>
        <span class="gap" />
        <span v-for="k in rows[2]" :key="k" class="key">{{ k }}</span>
        <span class="gap" />
        <span class="key mod wide"><Icon name="delete" :size="21" :stroke="1.4" /></span>
      </div>
      <div class="row">
        <span class="key mod num">123</span>
        <span class="key space">space</span>
        <span class="key go">{{ action }}</span>
      </div>
    </div>
    <div class="system">
      <Icon name="globe" :size="25" :stroke="1.3" />
      <Icon name="mic" :size="25" :stroke="1.3" />
    </div>
  </div>
</template>

<style scoped>
.k-keyboard {
  position: absolute;
  inset: auto 0 0;
  z-index: 20;
  height: 336px;
  background: var(--d-kb);
  box-shadow: inset 0 0.5px 0 var(--d-line);
  font-family: -apple-system, 'SF Pro Text', system-ui, sans-serif;
  color: var(--d-key-ink);
}

.predict {
  display: flex;
  height: 44px;
  align-items: center;
}

.word {
  flex: 1;
  text-align: center;
  font-size: 16px;
  color: var(--d-key-ink);
}

.mid {
  border-inline: 0.5px solid var(--d-line-2);
}

.keys {
  display: flex;
  flex-direction: column;
  gap: 11px;
  padding: 2px 3px 0;
}

.row {
  display: flex;
  gap: 6px;
}

.inset {
  padding: 0 19px;
}

.key {
  display: flex;
  height: 43px;
  flex: 1;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: var(--d-key);
  box-shadow: 0 1px 0 rgb(0 0 0 / 0.35);
  font-size: 23px;
  font-weight: 400;
  line-height: 1;
}

.mod {
  background: var(--d-key-2);
}

.wide {
  flex: 0 0 44px;
}

.gap {
  flex: 0 0 4px;
}

.num {
  flex: 0 0 92px;
  font-size: 16px;
}

.space {
  flex: 1;
  font-size: 16px;
}

.go {
  flex: 0 0 92px;
  background: var(--d-lamp);
  color: #1a140c;
  font-size: 16px;
  font-weight: 500;
}

.system {
  display: flex;
  justify-content: space-between;
  padding: 16px 26px 0;
  color: var(--d-key-ink);
  opacity: 0.85;
}
</style>
