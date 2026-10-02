<script setup lang="ts">
// The three tabs as a small floating capsule of icons over a fade to the room
// colour — the content runs on underneath. The active tab is full ink with a
// lamp-coloured dot; the others recede.
//
// With the `search` toggle on `tabbar` (after direction a): Home and Library
// stay in the capsule and Search becomes its own round button next to it. On
// the Search tab the capsule folds into one round button (back to the last
// tab) and the search field — the default slot — takes the rest of the row.
import { computed } from 'vue'
import { useProto } from '../../../contract'
import Icon from './Icon.vue'

const props = defineProps<{ active: 'home' | 'library' | 'search' }>()
const proto = useProto()
const inBar = computed(() => proto.value.toggles.search === 'tabbar')

const tabs = computed(() =>
  (
    [
      { key: 'home', label: 'Home' },
      { key: 'library', label: 'Library' },
      { key: 'search', label: 'Search' },
    ] as const
  ).filter((tab) => !inBar.value || tab.key !== 'search'),
)
const folded = computed(() => inBar.value && props.active === 'search')
</script>

<template>
  <div class="fade" :class="{ tall: folded }" aria-hidden="true" />
  <nav v-if="folded" class="row wide" aria-label="Tabs">
    <span class="circle small" aria-label="Library"><Icon name="library" :size="21" /></span>
    <div class="field-slot"><slot /></div>
  </nav>
  <nav v-else :class="inBar ? 'row' : 'solo'" aria-label="Tabs">
    <div class="bar">
      <span
        v-for="tab in tabs"
        :key="tab.key"
        class="tab"
        :class="{ active: tab.key === active }"
        :aria-label="tab.label"
        :aria-current="tab.key === active ? 'page' : undefined"
      >
        <Icon :name="tab.key" :size="23" :stroke="tab.key === active ? 1.7 : 1.5" />
        <span class="dot" />
      </span>
    </div>
    <span v-if="inBar" class="circle" aria-label="Search"><Icon name="search" :size="22" :stroke="1.6" /></span>
  </nav>
</template>

<style scoped>
.fade {
  position: absolute;
  inset: auto 0 0;
  z-index: 9;
  height: 128px;
  background: linear-gradient(to bottom, transparent, var(--d-bg) 62%);
  pointer-events: none;
}

/* Where the bar sits: alone and centred (the pitch), or in a row with the
   search button / field (search toggle on `tabbar`). */
.solo,
.row {
  position: absolute;
  bottom: calc(var(--safe-bottom) - 4px);
  left: 50%;
  z-index: 10;
  transform: translateX(-50%);
}

.row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.row.wide {
  right: 16px;
  left: 16px;
  transform: none;
}

.bar,
.circle {
  background: var(--d-glass);
  box-shadow:
    inset 0 0 0 0.5px var(--d-line-2),
    0 12px 30px rgb(0 0 0 / 0.35);
  backdrop-filter: blur(22px) saturate(1.6);
  -webkit-backdrop-filter: blur(22px) saturate(1.6);
}

.bar {
  display: flex;
  padding: 0 6px;
  border-radius: 999px;
}

.circle {
  display: flex;
  width: 52px;
  height: 52px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  color: var(--d-ink-2);
}

.circle.small {
  width: 48px;
  height: 48px;
}

.field-slot {
  min-width: 0;
  flex: 1;
}

.fade.tall {
  height: 150px;
}

.tab {
  position: relative;
  display: flex;
  width: 62px;
  height: 52px;
  align-items: center;
  justify-content: center;
  color: var(--d-ink-3);
}

.tab.active {
  color: var(--d-ink);
}

.dot {
  position: absolute;
  bottom: 6px;
  width: 4px;
  height: 4px;
  border-radius: 999px;
  background: var(--d-lamp);
  opacity: 0;
}

.active .dot {
  opacity: 1;
}
</style>
