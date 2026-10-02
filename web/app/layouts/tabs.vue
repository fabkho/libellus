<script setup lang="ts">
// The signed-in shell: the page's header with the avatar, the page, D's
// floating tab bar, and the search overlay that opens over all of it. A phone
// layout first; on a wide screen the same layout sits in a centred column.
//
// Each tab page names its header in its page meta:
//   definePageMeta({ layout: 'tabs', screen: 'home', titleSize: 'title', dated: true })
// `screen` is the test-ID prefix and the copy key (`<screen>.title`).
// A pushed screen (`pushed: true`, the book page) draws its own top bar over
// its cover's light instead of the header, edge to edge; the tab bar and
// search stay, so search works from every page. Pushed screens live in this
// layout too, so going to one and back keeps the tab pages alive.
const { t, locale } = useI18n()
const route = useRoute()

const screen = computed(() => String(route.meta.screen ?? 'home'))
const pushed = computed(() => Boolean(route.meta.pushed))
const titleSize = computed(() => (route.meta.titleSize === 'title' ? 'title' : 'large'))
const eyebrow = computed(() => (route.meta.dated ? t('home.today', dateParts(new Date(), locale.value)) : undefined))
</script>

<template>
  <div class="safe-x mx-auto flex min-h-dvh w-full max-w-(--size-max-content) flex-col sm:border-x-(length:--stroke-hairline) sm:border-hairline">
    <ShellHeader v-if="!pushed" :screen="screen" :title="t(`${screen}.title`)" :size="titleSize" :eyebrow="eyebrow" />

    <main class="clear-tab-bar flex-1" :class="!pushed && 'px-screen pt-lg'">
      <slot />
    </main>

    <ShellTabBar />
    <ShellSearchOverlay><SearchResults /></ShellSearchOverlay>
    <BookAddSheet />
  </div>
</template>
