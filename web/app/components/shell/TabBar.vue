<script setup lang="ts">
// D's tab bar: a small floating capsule of three icons over a soft scroll edge
// (a masked blur of what runs under it, only while something does), the
// content running on underneath. Home and Library are pages;
// Search is not — it opens the search palette over the page you are on
// (stores/search.ts), and the capsule itself turns into that palette
// (docs/MOTION.md, Search morph): while it does, this bar stays where it is
// under the veil and the overlay flies its own Search icon, so this one hides;
// once the palette is open it has taken the bar's place (useSearchChrome).
// The current tab is full ink with a lamp-coloured dot; the others recede.
// Labels are for assistive tech (and the tests). `data-morph` marks what the
// overlay measures to start from, and the tabs it keeps out of the Search
// icon's way.
//
// On every page the bar and its scroll edge slide away while the member reads
// down and come back on a short scroll up, at the top and at the end of the
// page (useHideOnScroll, docs/MOTION.md, Tab bar away). Never while search, a
// sheet or a field is in play, with Reduce Motion on, nor once focus is in the
// bar (a screen reader or keyboard reaching it brings it back): search opening
// snaps it back to its place first, without a transition, so the morph always
// grows out of the capsule where it rests.
import { useSearchStore } from '~/stores/search'

const { t } = useI18n()
const route = useRoute()
const search = useSearchStore()
const chrome = useSearchChrome()
const modal = useModalShown()

const { hidden: scrolledAway, reveal } = useHideOnScroll(() => !search.isOpen && chrome.value === 'tabs' && !modal.value)
/** Content runs under the capsule's scroll edge (composables/useContentUnderBar.ts). */
const under = useContentUnderBar()
// A screen that fills the room (`immersive`: Your shelf, #23) has the bar away for as long as it shows.
const away = computed(() => scrolledAway.value || Boolean(route.meta.immersive))
/** Search is taking the bar over: it is where it rests at once, for the morph to measure. */
const still = computed(() => search.isOpen || chrome.value !== 'tabs')

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
    class="edge-bottom bar pointer-events-none fixed inset-x-0 bottom-0 z-10"
    :class="[away && 'away', still && 'still', !under && 'empty']"
    aria-hidden="true"
    data-testid="shell.tabsEdge"
  />
  <nav
    :aria-label="t('shell.tabsLabel')"
    class="bar float-bottom glass fixed left-1/2 z-20 flex -translate-x-1/2 rounded-pill px-xs edge shadow-float"
    :class="[chrome === 'palette' && 'invisible', away && 'away', still && 'still']"
    :data-away="away || undefined"
    data-morph="capsule"
    data-testid="shell.tabs"
    @focusin="reveal"
  >
    <NuxtLink
      v-for="tab in PAGES"
      :key="tab.key"
      data-morph="tab"
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

/* Away and back (docs/MOTION.md, Tab bar away): down past the screen edge and
   out, transform and opacity only, so nothing is laid out again. Back over
   `standard`, away over `exit`; the fade travels with the capsule. */
.bar {
  transition:
    transform var(--duration-standard) var(--ease-standard),
    opacity var(--duration-standard) var(--ease-standard);
}

.bar.away {
  pointer-events: none;
  opacity: 0;
  transition-duration: var(--duration-exit);
  transition-timing-function: var(--ease-exit);
}

nav.away {
  transform: translateY(calc(100% + var(--float-bottom)));
}

.edge-bottom.away {
  transform: translateY(100%);
}

.bar.still {
  transition: none;
}

/* The scroll edge (iOS 26's, Material's toolbar has none): a very subtle
   blur of what runs under the capsule (half of `blurVeil`), strongest at the screen
   edge and gone by the capsule's top, with a faint tint of the room colour. It is as
   tall as the capsule and what lies under it (where it floats, the inset
   included) and no taller, and it shows only while content runs under it. It
   takes no tap. Where there is no backdrop blur (an old WebView) a very light,
   short gradient stands in. */
.edge-bottom {
  height: calc(var(--float-bottom) + var(--size-tab-bar));
  background: linear-gradient(to top, color-mix(in srgb, var(--color-surface) 20%, transparent), transparent);
  -webkit-backdrop-filter: blur(calc(var(--blur-veil) / 2));
  backdrop-filter: blur(calc(var(--blur-veil) / 2));
  -webkit-mask-image: linear-gradient(to top, black 10%, transparent);
  mask-image: linear-gradient(to top, black 10%, transparent);
}

@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .edge-bottom {
    background: linear-gradient(to top, color-mix(in srgb, var(--color-surface) 15%, transparent), transparent);
    -webkit-mask-image: none;
    mask-image: none;
  }
}

/* Nothing runs under it (the page's end, a page that fits): no edge. */
.edge-bottom.empty {
  opacity: 0;
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
