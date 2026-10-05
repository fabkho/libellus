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
// search stay, so search works from every page (the bar steps away while any
// page scrolls down, ShellTabBar / useHideOnScroll). Pushed screens live in this
// layout too, so going to one and back keeps the tab pages alive.
//
// The top scroll edge: the installed app draws under a transparent status bar
// (viewport-fit=cover), so what scrolls up there runs under the clock. A thin
// veil of the room colour keeps the clock legible: solid behind the status bar,
// fading out `ms` below it — no blur, and nothing under a pushed screen's top
// bar (its round buttons stand on their own). Where there is no status bar to
// clear (a browser tab, the installed Android app: the inset is 0) it is only
// that short fade at the top edge. It shows only once something has scrolled
// under it (a book's light at the top of its page stays clear) and never takes
// a tap (#62: the blurred band reaching under the top bar read too heavy).
//
// The header and `main` are the page (`data-flight="page"`): what fades when a
// cover flies into a book page and back (ShellBookFlight, docs/MOTION.md).
const { t, locale } = useI18n()
const route = useRoute()
// The shortcuts' addresses (`/?search=1`, `/?progress=1`) and a share that found no Book (composables/useLaunch.ts).
useLaunch()

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
      :class="scrolled ? 'opacity-100' : 'opacity-0'"
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
/* Solid room colour behind the status bar's glyphs (the top inset), then a
   short fade to nothing; the page shows through it unblurred. */
.scroll-edge {
  height: calc(var(--safe-area-top) + var(--spacing-ms));
  background: linear-gradient(
    to bottom,
    var(--color-surface) var(--safe-area-top),
    color-mix(in srgb, var(--color-surface) 70%, transparent) calc(var(--safe-area-top) + var(--spacing-xs)),
    transparent
  );
  transition: opacity var(--duration-quick) var(--ease-standard);
}
</style>
