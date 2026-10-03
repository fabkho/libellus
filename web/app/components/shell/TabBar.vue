<script setup lang="ts">
// D's tab bar: a small floating capsule of three icons over a fade to the
// room colour, the content running on underneath. Home and Library are pages;
// Search is not — it opens the search palette over the page you are on
// (stores/search.ts), and the capsule itself turns into that palette
// (docs/MOTION.md, Search morph): while it does, this bar stays where it is
// under the veil and the overlay flies its own Search icon, so this one hides;
// once the palette is open it has taken the bar's place (useSearchChrome).
// The current tab is full ink with a lamp-coloured dot; the others recede.
// Labels are for assistive tech (and the tests). `data-morph` marks what the
// overlay measures to start from.
import { useSearchStore } from '~/stores/search'

const { t } = useI18n()
const route = useRoute()
const search = useSearchStore()
const chrome = useSearchChrome()

const PAGES = [
  { key: 'home', to: '/', icon: 'home' },
  { key: 'library', to: '/library', icon: 'library' },
] as const

const current = (to: string) => route.path === to

// Each tab keeps its place (utils/tabPlaces.ts): whatever leaves a tab page —
// a tab, a book, the search palette — notes how far down it was first, before
// the next page can change the scroll.
const router = useRouter()
const stopRemembering = router.beforeEach((_to, from) => tabPlaces.leave(from.path, window.scrollY))
onUnmounted(stopRemembering)

/** The tab already showing, tapped again: back to its top, as iOS does. */
function tapped(event: MouseEvent, to: string) {
  if (!current(to)) return
  event.preventDefault()
  window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'instant' : 'smooth' })
}
</script>

<template>
  <div
    class="pointer-events-none fixed inset-x-0 bottom-0 z-10 h-(--size-fade) bg-linear-to-b from-transparent to-surface to-62%"
    aria-hidden="true"
  />
  <nav
    :aria-label="t('shell.tabsLabel')"
    class="float-bottom glass fixed left-1/2 z-20 flex -translate-x-1/2 rounded-pill px-xs edge shadow-float"
    :class="chrome === 'palette' && 'invisible'"
    data-morph="capsule"
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
      @click="tapped($event, tab.to)"
    >
      <UiIcon :name="tab.icon" :bold="current(tab.to)" />
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
      <UiIcon name="search" :class="chrome !== 'tabs' && 'invisible'" data-morph="search" />
      <span class="sr-only">{{ t('tabs.search') }}</span>
    </button>
  </nav>
</template>

<style scoped>
/* iOS 26's tab bar, from tokens only (design/tokens.json `tabBar`, `tab`,
   `tabIcon`): a 62 pt capsule of 72 pt tabs with 26 px icons. */
.tab {
  position: relative;
  display: flex;
  width: var(--size-tab);
  height: var(--size-tab-bar);
  align-items: center;
  justify-content: center;
  transition: color var(--duration-quick) var(--ease-standard);
}

.tab svg {
  width: var(--size-tab-icon);
  height: var(--size-tab-icon);
}

/* 6 under the icon (`xs` + `xxs`), less the dot's own `xs`. */
.dot {
  position: absolute;
  bottom: calc((var(--size-tab-bar) - var(--size-tab-icon)) / 2 - var(--spacing-xs) * 2 - var(--spacing-xxs));
  width: var(--spacing-xs);
  height: var(--spacing-xs);
  border-radius: var(--radius-pill);
  background: var(--color-accent);
  transition: opacity var(--duration-quick) var(--ease-standard);
}
</style>
