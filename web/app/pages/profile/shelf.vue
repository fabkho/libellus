<script setup lang="ts">
// Your shelf (#23): the owner's Library as Regal's 3D Stack, the one the
// portfolio shows (the same published library file: editions, dates, ratings,
// the art). Only the owner's account has it (runtimeConfig shelfOwnerId,
// stores/shelf.ts); for anyone else the address is a page that doesn't exist
// (`validate`, the same 404 as any unknown address) and nothing links here.
//
// A pushed screen in the tab layout that fills it: the night room in either
// theme (`data-theme="dark"` on the page, so every token takes its Night value
// inside, and the status bar the room's colour while it is open), the round
// back button pinned, the count beside the title, and the Stack filling what is
// left; the tab bar steps away (`immersive`). Regal does the rest: scroll,
// drag or flick through the pile, tap a Book to take it out, tap again for its
// back, drag to turn it. Back (the round button or the system's) puts a Book
// that is out away first.
//
// Loading: the Books as a pile of slabs in their Spines' colours (ShelfPile),
// at once from the library file, while Regal and three.js come
// (`LazyShelfStage`, the `regal` chunk); the 3D fades in over it. The file
// can't be read: why, and Try again (offline: when the connection is back).
// `?year=2025` (a year in review's stack, opened full screen): that year only.
import { applyPreference } from '~/utils/theme'
import { isShelfOwner } from '~/utils/shelfOwner'
import { useSessionStore } from '~/stores/session'
import { useShelfStore } from '~/stores/shelf'
import { useThemeStore } from '~/stores/theme'

definePageMeta({
  layout: 'tabs',
  screen: 'shelf',
  pushed: true,
  immersive: true,
  // Runs in the app's entry, before this page's chunk loads: the session and the config only.
  // A build without Regal (appConfig.regal, regal.config.ts) has no shelf for anyone.
  validate: () => useAppConfig().regal === true && isShelfOwner(useSessionStore().member?.id, useRuntimeConfig().public.shelfOwnerId),
})

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const shelf = useShelfStore()
const theme = useThemeStore()
const { count } = useFigures()

useHead({ title: () => `${t('shelf.title')} · ${t('app.name')}` })

/** `?year=2025`: only the Books finished that year. */
const year = computed(() => {
  const value = Number(route.query.year)
  return Number.isInteger(value) && value >= 1000 && value <= 9999 ? value : null
})
const books = computed(() => (year.value ? shelf.readIn(year.value) : (shelf.shelf?.books ?? [])))
const countText = computed(() =>
  year.value
    ? t('shelf.yearCount', { year: year.value, count: count(books.value.length) }, books.value.length)
    : t('shelf.count', { count: count(books.value.length) }, books.value.length),
)

// The 3D has drawn: the pile hands over to it.
const ready = ref(false)
const stage = ref<{ picked: boolean; putAway: () => void } | null>(null)

onMounted(() => {
  void shelf.load()
  // The browser's bar and the installed app's status bar: the night room's colour while it is open.
  for (const tag of document.querySelectorAll('meta[name="theme-color"]')) tag.setAttribute('content', theme.colors.dark)
})
onBeforeUnmount(() => applyPreference(document, theme.preference, theme.colors))

// A Book that is out goes back first, for the round button as for the system Back (a layer
// over the page, like a sheet: useBackDismiss); then back to where the shelf was opened from.
useBackDismiss(
  () => stage.value?.picked ?? false,
  () => stage.value?.putAway(),
)
function back() {
  if (stage.value?.picked) return stage.value.putAway()
  if (String(window.history.state?.back ?? '').startsWith('/profile')) router.back()
  else void navigateTo(year.value ? `/profile/${year.value}` : '/profile')
}
</script>

<template>
  <div data-theme="dark" class="fixed inset-0 mx-auto flex max-w-(--size-max-content) flex-col overflow-hidden bg-surface text-ink" data-testid="shelf">
    <UiTopBar :title="t('shelf.title')" :back-label="t('shelf.back')" back-testid="shelf.back" @back="back">
      <template #trailing>
        <span v-if="shelf.shelf" class="figures pr-xs text-meta text-ink-muted" data-testid="shelf.count">{{ countText }}</span>
      </template>
    </UiTopBar>

    <div class="safe-bottom relative min-h-0 flex-1">
      <div class="relative h-full">
        <!-- Regal's Stack starts with the top of the pile in the middle of its view. Its view reaches
             up behind the top bar, so the pile starts above the middle and fills the rest, and a
             Book taken out stands clear of the card about it at the bottom. -->
        <div v-if="shelf.shelf" class="lift absolute inset-x-0 bottom-0">
          <LazyShelfStage ref="stage" :year="year" class="room-3d" :class="ready && 'ready'" data-testid="shelf.stage" @ready="ready = true" />
        </div>
        <ShelfBookList :books="books" :label="t('shelf.title')" />

        <Transition name="hand-over">
          <div v-if="!ready && !(shelf.loadError && !shelf.shelf)" class="pointer-events-none absolute inset-0 flex items-center justify-center px-xxl" data-testid="shelf.loading">
            <ShelfPile :books="books" :limit="22" class="w-full" />
            <span class="sr-only" aria-live="polite">{{ t('shelf.loading') }}</span>
          </div>
        </Transition>

        <div v-if="shelf.loadError && !shelf.shelf" class="absolute inset-0 flex flex-col items-center justify-center gap-md px-xl text-center" data-testid="shelf.error">
          <p class="text-subhead text-ink-muted">{{ shelf.loadError === 'offline' ? t('shelf.offline') : t('shelf.loadError') }}</p>
          <UiButton v-if="shelf.loadError !== 'offline'" tone="secondary" size="md" :disabled="shelf.loading" data-testid="shelf.retry" @click="shelf.load()">
            {{ t('shelf.retry') }}
          </UiButton>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lift {
  top: -20%;
}
.room-3d {
  opacity: 0;
  transition: opacity var(--duration-standard) var(--ease-standard);
}
.room-3d.ready {
  opacity: 1;
}
.hand-over-leave-active {
  transition: opacity var(--duration-standard) var(--ease-standard);
}
.hand-over-leave-to {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .room-3d,
  .hand-over-leave-active {
    transition: none;
  }
}
</style>
