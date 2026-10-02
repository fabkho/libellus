<script setup lang="ts">
// iOS status bar, so a frame reads as a phone and not as a web page. Drawn by
// Frame.vue above every screen; its colour is the direction's
// `--status-bar-ink` (default near-black).
</script>

<template>
  <div class="status-bar" aria-hidden="true">
    <span class="time">9:41</span>
    <span class="icons">
      <svg width="17" height="11" viewBox="0 0 17 11" fill="currentColor">
        <rect x="0" y="7.5" width="3" height="3.5" rx="1" />
        <rect x="4.6" y="5.5" width="3" height="5.5" rx="1" />
        <rect x="9.2" y="3" width="3" height="8" rx="1" />
        <rect x="13.8" y="0.5" width="3" height="10.5" rx="1" />
      </svg>
      <svg width="16" height="11" viewBox="0 0 16 11" fill="none">
        <path
          d="M1 3.6a10.5 10.5 0 0 1 14 0M3.6 6.3a6.8 6.8 0 0 1 8.8 0"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
        />
        <circle cx="8" cy="9.3" r="1.3" fill="currentColor" />
      </svg>
      <svg width="26" height="12" viewBox="0 0 26 12" fill="none">
        <rect x="0.6" y="0.6" width="21" height="10.8" rx="3.2" stroke="currentColor" stroke-opacity="0.4" />
        <rect x="2.2" y="2.2" width="15" height="7.6" rx="2" fill="currentColor" />
        <path d="M23.4 4.2v3.6a2 2 0 0 0 0-3.6Z" fill="currentColor" fill-opacity="0.4" />
      </svg>
    </span>
  </div>
</template>

<style scoped>
.status-bar {
  position: absolute;
  inset: 0 0 auto;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 54px;
  padding: 8px 32px 0 42px;
  color: var(--status-bar-ink, #111);
  pointer-events: none;
}

.time {
  font: 600 17px/1 -apple-system, 'SF Pro Text', system-ui, sans-serif;
  font-variant-numeric: tabular-nums;
}

.icons {
  display: flex;
  align-items: center;
  gap: 6px;
}
</style>
