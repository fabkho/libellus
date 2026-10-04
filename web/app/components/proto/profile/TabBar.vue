<script setup lang="ts">
// Design round #78: ShellTabBar's capsule, as a picture that switches the
// prototype's screens (Search does nothing here). Three tabs as today, or —
// direction A — four, with "You" drawn as the member's initials in a ring the
// size of a tab icon, after the account tabs of Apple Music and the App Store.
import { MEMBER } from './model'

type Tab = 'home' | 'library' | 'you' | 'search'
const props = withDefaults(defineProps<{ current?: Tab | 'none'; you?: boolean }>(), { current: 'home', you: false })
const emit = defineEmits<{ go: [tab: Tab] }>()

const tabs = computed<Tab[]>(() => (props.you ? ['home', 'library', 'you', 'search'] : ['home', 'library', 'search']))
const LABELS: Record<Tab, string> = { home: 'Home', library: 'Library', you: 'You', search: 'Search' }
</script>

<template>
  <div class="fade pointer-events-none fixed inset-x-0 bottom-0 z-10 bg-linear-to-b from-transparent to-surface to-62%" aria-hidden="true" />
  <nav class="float-bottom glass fixed left-1/2 z-20 flex -translate-x-1/2 rounded-pill px-xs edge shadow-float" aria-label="Tabs" data-testid="proto.tabs">
    <button
      v-for="tab in tabs"
      :key="tab"
      type="button"
      class="tab"
      :class="current === tab ? 'text-ink' : 'text-ink-faint'"
      :aria-label="LABELS[tab]"
      :aria-current="current === tab ? 'page' : undefined"
      :data-testid="`proto.tab.${tab}`"
      @click="tab !== 'search' && emit('go', tab)"
    >
      <span v-if="tab === 'you'" class="you figures" :class="current === 'you' && 'on'" aria-hidden="true">{{ MEMBER.initials }}</span>
      <UiIcon v-else :name="tab" :bold="current === tab" />
      <span class="dot" :class="current !== tab && 'opacity-0'" />
    </button>
  </nav>
</template>

<style scoped>
.tab {
  position: relative;
  display: flex;
  width: var(--size-tab);
  height: var(--size-tab-bar);
  align-items: center;
  justify-content: center;
}
.tab svg {
  width: var(--size-tab-icon);
  height: var(--size-tab-icon);
}
/* The member's initials in a ring the size of an icon, drawn with an icon's stroke. */
.you {
  display: flex;
  width: calc(var(--size-tab-icon) - 2 * var(--spacing-xxs));
  height: calc(var(--size-tab-icon) - 2 * var(--spacing-xxs));
  align-items: center;
  justify-content: center;
  border: var(--stroke-icon) solid currentColor;
  border-radius: var(--radius-pill);
  font-size: var(--text-eyebrow);
  font-weight: var(--font-weight-medium);
  letter-spacing: 0;
}
.you.on {
  border-width: var(--stroke-icon-bold);
}
.fade {
  height: calc(var(--float-bottom) + var(--size-tab-bar) + var(--size-fade-above));
}
.dot {
  position: absolute;
  bottom: calc((var(--size-tab-bar) - var(--size-tab-icon)) / 2 - var(--spacing-xs) * 2 - var(--spacing-xxs));
  width: var(--spacing-xs);
  height: var(--spacing-xs);
  border-radius: var(--radius-pill);
  background: var(--color-accent);
}
</style>
