<script setup lang="ts">
// The signed-in shell: the page's header with the avatar, the page, D's
// floating tab bar, and the search overlay that opens over all of it. A phone
// layout first; on a wide screen the same layout sits in a centred column.
//
// Each tab page names its header in its page meta:
//   definePageMeta({ layout: 'tabs', screen: 'home', titleSize: 'title', dated: true, greeting: true })
// `screen` is the test-ID prefix and the copy key (`<screen>.title`).
// A pushed screen (`pushed: true`, the book page) draws its own top bar over
// its cover's light instead of the header, edge to edge; the tab bar and
// search stay, so search works from every page. Pushed screens live in this
// layout too, so going to one and back keeps the tab pages alive.
//
// The top scroll edge: the installed app draws under a transparent status bar
// (viewport-fit=cover), so what scrolls up there fades and blurs into the room
// colour instead of running under the clock — iOS's scroll edge effect, the
// top mirror of the tab bar's fade. Like iOS's it shows only once something
// has scrolled under it (a book's light at the top of its page stays clear),
// and on a pushed screen it reaches under the pinned top bar too. It never
// takes a tap.
//
// The header and `main` are the page (`data-flight="page"`): what fades when a
// cover flies into a book page and back (ShellBookFlight, docs/MOTION.md).
const { t, locale } = useI18n()
const route = useRoute()

const screen = computed(() => String(route.meta.screen ?? 'home'))
const pushed = computed(() => Boolean(route.meta.pushed))
const titleSize = computed(() => (route.meta.titleSize === 'title' ? 'title' : 'large'))
// Home (`greeting: true`) is headed by a greeting for the time of day, not by its name.
const { now, greeting } = useGreeting()
const title = computed(() => (route.meta.greeting ? greeting.value : t(`${screen.value}.title`)))
const eyebrow = computed(() => (route.meta.dated ? t('home.today', dateParts(now.value, locale.value)) : undefined))

const scrolled = ref(false)
const measureScroll = () => (scrolled.value = window.scrollY > 0)
onMounted(() => {
  measureScroll()
  window.addEventListener('scroll', measureScroll, { passive: true })
})
onUnmounted(() => window.removeEventListener('scroll', measureScroll))
</script>

<template>
  <div class="safe-x mx-auto flex min-h-dvh w-full max-w-(--size-max-content) flex-col sm:border-x-(length:--stroke-hairline) sm:border-hairline">
    <ShellHeader v-if="!pushed" :screen="screen" :title="title" :size="titleSize" :eyebrow="eyebrow" data-flight="page" />

    <main class="clear-tab-bar flex-1" :class="!pushed && 'px-screen pt-lg'" data-flight="page">
      <slot />
    </main>

    <div
      class="scroll-edge pointer-events-none fixed inset-x-0 top-0 z-20"
      :class="[pushed && 'under-bar', scrolled ? 'opacity-100' : 'opacity-0']"
      aria-hidden="true"
      data-testid="shell.scrollEdge"
    />
    <ShellBookFlight />
    <ShellTabBar />
    <ShellSearchOverlay><SearchResults /></ShellSearchOverlay>
    <BookAddSheet />
    <BookManualSheet />
    <BookStartSheet />
    <BookFinishSheet />
    <BookProgressSheet />
    <BookAbandonSheet />
  </div>
</template>

<style scoped>
/* The safe area and `md` more (on a pushed screen the top bar's row too):
   solid room colour behind the status bar's glyphs, fading out below, with the
   page blurred under the fade. */
.scroll-edge {
  --edge-solid: var(--safe-area-top);
  height: calc(var(--edge-solid) + var(--spacing-md));
  background: linear-gradient(to bottom, var(--color-surface) calc(var(--edge-solid) * 0.8), transparent);
  -webkit-backdrop-filter: blur(var(--blur-chrome));
  backdrop-filter: blur(var(--blur-chrome));
  mask-image: linear-gradient(to bottom, #000 var(--edge-solid), transparent);
  transition: opacity var(--duration-quick) var(--ease-standard);
}
.under-bar {
  --edge-solid: calc(var(--safe-area-top) + var(--size-touch));
}
</style>
