<script setup lang="ts">
// The iOS keyboard, drawn, for screens shown mid-typing. Light, with the
// return key reading "search".
import Icon from './Icon.vue'

const rows = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm']
</script>

<template>
  <div class="keyboard" aria-hidden="true">
    <div class="row">
      <span v-for="key in rows[0]" :key="key" class="key">{{ key }}</span>
    </div>
    <div class="row inset">
      <span v-for="key in rows[1]" :key="key" class="key">{{ key }}</span>
    </div>
    <div class="row">
      <span class="key fn wide"><Icon name="shift" :size="20" :stroke="1.6" /></span>
      <span class="gap" />
      <span v-for="key in rows[2]" :key="key" class="key">{{ key }}</span>
      <span class="gap" />
      <span class="key fn wide"><Icon name="delete" :size="21" :stroke="1.6" /></span>
    </div>
    <div class="row">
      <span class="key fn num">123</span>
      <span class="key space">space</span>
      <span class="key go">search</span>
    </div>
    <div class="extras">
      <Icon name="globe" :size="25" :stroke="1.5" />
      <Icon name="mic" :size="25" :stroke="1.5" />
    </div>
  </div>
</template>

<style scoped>
.keyboard {
  position: absolute;
  inset: auto 0 0;
  z-index: 35;
  display: flex;
  flex-direction: column;
  gap: 11px;
  height: 336px;
  padding: 9px 3px 0;
  border-radius: 28px 28px 0 0;
  background: rgb(43 43 45 / 0.94);
  -webkit-backdrop-filter: blur(20px) saturate(1.4);
  backdrop-filter: blur(20px) saturate(1.4);
  box-shadow: 0 -0.5px 0 rgb(255 255 255 / 0.08);
  font-family: -apple-system, 'SF Pro Text', system-ui, sans-serif;
  color: #fff;
}

.row {
  display: flex;
  gap: 6px;
  height: 45px;
}

.row.inset {
  padding: 0 19px;
}

.key {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  border-radius: 8.5px;
  background: #6b6b6e;
  box-shadow: 0 1px 0 rgb(0 0 0 / 0.5);
  font-size: 23px;
  font-weight: 400;
  letter-spacing: 0;
}

.fn {
  background: #464649;
}

.wide {
  flex: 0 0 45px;
}

.gap {
  flex: 0 0 6px;
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
  background: #0a84ff;
  color: #fff;
  font-size: 16px;
}

.extras {
  display: flex;
  justify-content: space-between;
  padding: 12px 22px 0;
  color: #c4c4c8;
}
</style>
