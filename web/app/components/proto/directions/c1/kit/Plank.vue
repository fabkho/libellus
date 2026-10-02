<script setup lang="ts">
// One shelf: whatever stands in the slot sits on a wooden plank (grain when
// texture is on) with a soft shadow on the wall below. `bookend` puts a
// slim bookend after the last book.
withDefaults(defineProps<{ bookend?: boolean; gap?: number; inset?: number; align?: 'start' | 'center' }>(), {
  bookend: false,
  gap: 2,
  inset: 14,
  align: 'start',
})
</script>

<template>
  <div class="shelf">
    <div class="books" :style="{ gap: `${gap}px`, padding: `0 ${inset}px`, justifyContent: align === 'center' ? 'center' : 'flex-start' }">
      <slot />
      <span v-if="bookend" class="bookend"><span class="foot" /></span>
    </div>
    <div class="plank">
      <span class="top c1-wood" />
      <span class="front c1-wood" />
    </div>
  </div>
</template>

<style scoped>
.shelf {
  position: relative;
}

.books {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: flex-end;
  margin-bottom: -3px;
}

.plank {
  position: relative;
  display: flex;
  flex-direction: column;
  filter: drop-shadow(0 6px 6px var(--c1-wood-shadow));
}

.top {
  height: 4px;
  margin: 0 3px;
  border-radius: 3px 3px 0 0;
  background-color: var(--c1-wood-top) !important;
}

.front {
  height: 8px;
  border-radius: 2px 2px 4px 4px;
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.3),
    inset 0 -1px 0 rgb(0 0 0 / 0.08);
}

.bookend {
  position: relative;
  flex-shrink: 0;
  width: 7px;
  height: 56px;
  margin-left: 2px;
  border-radius: 5px 5px 2px 2px;
  background: var(--c1-accent);
  box-shadow:
    inset 2px 0 0 rgb(255 255 255 / 0.2),
    inset -2px 0 0 rgb(0 0 0 / 0.15);
}

.foot {
  position: absolute;
  bottom: 0;
  left: -18px;
  z-index: -1;
  width: 26px;
  height: 6px;
  border-radius: 2px 4px 2px 2px;
  background: var(--c1-accent-deep);
}
</style>
