<script setup lang="ts">
// Design round #65: ShellTabBar's capsule as a picture (Home lit), so the
// prototypes stand on the real chrome without the search store behind it.
defineProps<{ current?: 'home' | 'none' }>()
</script>

<template>
  <div class="fade pointer-events-none fixed inset-x-0 bottom-0 z-10 bg-linear-to-b from-transparent to-surface to-62%" aria-hidden="true" />
  <nav class="float-bottom glass fixed left-1/2 z-20 flex -translate-x-1/2 rounded-pill px-xs edge shadow-float" aria-hidden="true">
    <span class="tab" :class="current === 'none' ? 'text-ink-faint' : 'text-ink'">
      <UiIcon name="home" :bold="current !== 'none'" />
      <span class="dot" :class="current === 'none' && 'opacity-0'" />
    </span>
    <span class="tab text-ink-faint"><UiIcon name="library" /></span>
    <span class="tab text-ink-faint"><UiIcon name="search" /></span>
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
