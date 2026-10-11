<script setup lang="ts">
// D's tab bar: a small floating capsule of icons (Home, Library, Friends while it is on, Search), the content running
// on underneath with nothing behind it (no fade, no scroll edge: the capsule's
// own glass, edge and shadow set it apart). Home, Library and Friends are pages;
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
// On a page long enough to be worth it the bar slides away while the member
// reads down and comes back on a short scroll up, at the top and at the end of
// the page; a page only a little longer than the screen keeps it (useHideOnScroll,
// docs/MOTION.md, Tab bar away). Never while search, a
// sheet or a field is in play, with Reduce Motion on, nor once focus is in the
// bar (a screen reader or keyboard reaching it brings it back): search opening
// snaps it back to its place first, without a transition, so the morph always
// grows out of the capsule where it rests.
import { useFriendsTabStore } from '~/stores/friendsTab'
import { useSearchStore } from '~/stores/search'
import { TABS, type Tab } from '~/utils/friendsTab'
import { withoutSlash } from '~/utils/signedOutRoute'

const { t } = useI18n()
const route = useRoute()
const search = useSearchStore()
const chrome = useSearchChrome()
const modal = useModalShown()

const { hidden: scrolledAway, reveal } = useHideOnScroll(() => !search.isOpen && chrome.value === 'tabs' && !modal.value)
// A screen that fills the room (`immersive`: Your shelf, #23) has the bar away for as long as it shows.
const away = computed(() => scrolledAway.value || Boolean(route.meta.immersive))
/** Search is taking the bar over: it is where it rests at once, for the morph to measure. */
const still = computed(() => search.isOpen || chrome.value !== 'tabs')

// Home, Library and, while its setting is on (Profile → Account), Friends: the feed as a tab of its own.
// Search comes after them: it is an action, the bar's detached last place.
const friendsTab = useFriendsTabStore()
const shown = (tab: Tab) => friendsTab.tabs.some((visible) => visible.key === tab.key)

// A reload or a link can leave the slash on (`/friends/`): the same tab.
const current = (to: string) => withoutSlash(route.path) === to

// Each tab keeps its place (utils/tabPlaces.ts): whatever leaves a tab page —
// a tab, a book, the search palette — notes how far down it was first, before
// the next page can change the scroll.
const router = useRouter()
const stopRemembering = router.beforeEach((_to, from) => tabPlaces.leave(from.path, window.scrollY, Boolean(from.meta.pushed)))
onUnmounted(stopRemembering)

/** The tab already showing, tapped again: back to its top, as iOS does. */
function tapped(event: MouseEvent, to: string) {
  if (!current(to)) return
  event.preventDefault()
  window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'instant' : 'smooth' })
}
</script>

<template>
  <nav
    :aria-label="t('shell.tabsLabel')"
    class="bar float-bottom glass fixed left-1/2 z-20 flex -translate-x-1/2 rounded-pill px-xs edge shadow-float"
    :class="[chrome === 'palette' && 'invisible', away && 'away', still && 'still']"
    :data-away="away || undefined"
    data-morph="capsule"
    data-testid="shell.tabs"
    @focusin="reveal"
  >
    <template v-for="tab in TABS" :key="tab.key">
      <!-- The Friends tab comes and goes with its setting: its width opens and closes, and the capsule, centred, follows. -->
      <Transition name="tab">
        <NuxtLink
          v-if="shown(tab)"
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
      </Transition>
    </template>
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
   `standard`, away over `exit`. */
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

.bar.still {
  transition: none;
}

/* The Friends tab turning on or off: its width opens or closes under a fade, so the capsule (centred
   on the screen) grows or shrinks about its middle and the tabs beside it slide to their new places.
   With Reduce Motion the transition is a swap (main.css). */
.tab-enter-active,
.tab-leave-active {
  overflow: hidden;
  transition:
    width var(--duration-standard) var(--ease-standard),
    opacity var(--duration-standard) var(--ease-standard);
}
.tab-enter-from,
.tab-leave-to {
  width: 0;
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
