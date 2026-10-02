<script setup lang="ts">
// D's tab bar: a small floating capsule of three icons over a fade to the
// room colour, the content running on underneath. Home and Library are pages;
// Search is not — it opens the search palette over the page you are on
// (stores/search.ts). The current tab is full ink with a lamp-coloured dot;
// the others recede. Labels are for assistive tech (and the tests).
import { useSearchStore } from '~/stores/search'

const { t } = useI18n()
const route = useRoute()
const search = useSearchStore()

const PAGES = [
  { key: 'home', to: '/', icon: 'home' },
  { key: 'library', to: '/library', icon: 'library' },
] as const

const current = (to: string) => !search.isOpen && route.path === to
</script>

<template>
  <div
    class="pointer-events-none fixed inset-x-0 bottom-0 z-10 h-(--size-fade) bg-linear-to-b from-transparent to-surface to-62%"
    aria-hidden="true"
  />
  <nav
    :aria-label="t('shell.tabsLabel')"
    class="float-bottom glass fixed left-1/2 z-20 flex -translate-x-1/2 rounded-pill px-xs edge shadow-float transition-opacity duration-(--duration-standard) ease-standard"
    :class="search.isOpen && 'pointer-events-none opacity-0'"
    data-testid="shell.tabs"
  >
    <NuxtLink
      v-for="tab in PAGES"
      :key="tab.key"
      :to="tab.to"
      class="tab"
      :class="current(tab.to) ? 'text-ink' : 'text-ink-faint'"
      :aria-current="current(tab.to) ? 'page' : undefined"
      :data-testid="`shell.tab.${tab.key}`"
    >
      <UiIcon :name="tab.icon" :size="23" :bold="current(tab.to)" />
      <span class="sr-only">{{ t(`tabs.${tab.key}`) }}</span>
      <span class="dot" :class="current(tab.to) ? 'opacity-100' : 'opacity-0'" aria-hidden="true" />
    </NuxtLink>
    <button
      type="button"
      class="tab text-ink-faint"
      :aria-expanded="search.isOpen"
      aria-haspopup="dialog"
      data-testid="shell.tab.search"
      @click="search.open()"
    >
      <UiIcon name="search" :size="23" />
      <span class="sr-only">{{ t('tabs.search') }}</span>
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
  transition: color var(--duration-quick) var(--ease-standard);
}

.dot {
  position: absolute;
  bottom: calc(var(--spacing-xs) + var(--spacing-xxs));
  width: var(--spacing-xs);
  height: var(--spacing-xs);
  border-radius: var(--radius-pill);
  background: var(--color-accent);
  transition: opacity var(--duration-quick) var(--ease-standard);
}
</style>
