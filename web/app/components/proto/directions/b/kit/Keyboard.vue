<script setup lang="ts">
// The iOS light keyboard, drawn, for frames shown mid-typing. System font on
// purpose: it belongs to the phone, not to the magazine.
const rows = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
]
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
      <span class="key mod wide">
        <svg width="20" height="18" viewBox="0 0 20 18" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M10 2 2 10h4.5v6h7v-6H18z" stroke-linejoin="round" />
        </svg>
      </span>
      <span class="spacer" />
      <span v-for="key in rows[2]" :key="key" class="key">{{ key }}</span>
      <span class="spacer" />
      <span class="key mod wide">
        <svg width="24" height="18" viewBox="0 0 24 18" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M8 2h13v14H8l-6-7z" stroke-linejoin="round" />
          <path d="m12 6 6 6M18 6l-6 6" stroke-linecap="round" />
        </svg>
      </span>
    </div>
    <div class="row">
      <span class="key mod fn">123</span>
      <span class="key space">space</span>
      <span class="key go">search</span>
    </div>
    <div class="bottom">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" />
      </svg>
      <svg width="22" height="26" viewBox="0 0 20 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
        <rect x="6.5" y="2" width="7" height="13" rx="3.5" />
        <path d="M3 11a7 7 0 0 0 14 0M10 18v4" />
      </svg>
    </div>
  </div>
</template>

<style scoped>
.keyboard {
  position: absolute;
  inset: auto 0 0;
  z-index: 20;
  display: flex;
  height: 336px;
  flex-direction: column;
  gap: 12px;
  padding: 8px 3px 0;
  background: #d2d4da;
  font-family: -apple-system, 'SF Pro Text', system-ui, sans-serif;
  color: #000;
}

.row {
  display: flex;
  justify-content: center;
  gap: 6px;
}

.row.inset {
  padding: 0 19px;
}

.key {
  display: flex;
  height: 42px;
  flex: 0 0 32px;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  background: #fff;
  box-shadow: 0 1px 0 #898a8d;
  font-size: 23px;
  line-height: 1;
  padding-bottom: 3px;
}

.mod {
  background: #abb0ba;
  font-size: 16px;
}

.wide {
  flex-basis: 42px;
}

.spacer {
  width: 6px;
}

.fn {
  flex-basis: 88px;
}

.space {
  flex: 1;
  font-size: 16px;
  color: #000;
}

.go {
  flex-basis: 88px;
  background: #abb0ba;
  font-size: 16px;
}

.bottom {
  display: flex;
  justify-content: space-between;
  padding: 10px 22px 0;
  color: #50555c;
}
</style>
