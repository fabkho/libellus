<script setup lang="ts">
// Design round #65: the frame every Update progress prototype sits in. The
// screen at the phone's width (centred on a wide one, as the app does), and a
// small proto bar at the top centre — the direction, Home or the book page,
// the theme, Reset — that the screenshots leave out (`?bare`). The theme comes
// from `?theme=light|dark` or the bar; it is not stored.
import { hapticsAvailable, useProtoReads, type Direction } from './model'

const props = defineProps<{ direction: Direction }>()

const route = useRoute()
const router = useRouter()
const bare = computed(() => 'bare' in route.query)
const screen = computed(() => (route.query.screen === 'book' ? 'book' : 'home'))
const { reset } = useProtoReads(props.direction)

const theme = ref<'light' | 'dark'>('light')
function applyTheme(value: 'light' | 'dark') {
  theme.value = value
  document.documentElement.dataset.theme = value
}
onMounted(() => {
  const asked = route.query.theme
  if (asked === 'light' || asked === 'dark') applyTheme(asked)
  else applyTheme(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
})

const buzz = ref<string>('')
onMounted(() => (buzz.value = { vibrate: 'Haptics on', 'ios-switch': 'iOS ticks', none: 'No haptics' }[hapticsAvailable()]))

function go(query: Record<string, string | undefined>) {
  void router.replace({ query: { ...route.query, ...query } })
}
</script>

<template>
  <div class="safe-x mx-auto min-h-dvh w-full max-w-(--size-max-content) sm:border-x-(length:--stroke-hairline) sm:border-hairline">
    <slot />

    <nav
      v-if="!bare"
      class="proto-bar glass fixed left-1/2 z-40 flex -translate-x-1/2 items-center gap-xxs rounded-pill p-xxs edge shadow-float"
      aria-label="Prototype"
      data-testid="proto.bar"
    >
      <NuxtLink
        to="/prototype/progress"
        class="flex size-(--size-button-sm) items-center justify-center rounded-pill text-ink-muted"
        aria-label="All directions"
        data-testid="proto.index"
      >
        <UiIcon name="stack" :size="15" />
      </NuxtLink>
      <NuxtLink
        v-for="key in ['a', 'b', 'c']"
        :key="key"
        :to="{ path: `/prototype/progress/${key}`, query: { screen, theme } }"
        class="figures flex size-(--size-button-sm) items-center justify-center rounded-pill text-meta uppercase"
        :class="key === direction ? 'bg-ink text-on-ink' : 'text-ink-muted'"
        :data-testid="`proto.direction.${key}`"
      >
        {{ key }}
      </NuxtLink>
      <span class="mx-xxs h-ms w-(--stroke-hairline) bg-hairline-strong" aria-hidden="true" />
      <button
        type="button"
        class="eyebrow flex h-(--size-button-sm) items-center rounded-pill px-sm"
        :class="screen === 'home' ? 'text-ink' : 'text-ink-faint'"
        data-testid="proto.home"
        @click="go({ screen: undefined, book: undefined, state: undefined })"
      >
        Home
      </button>
      <button
        type="button"
        class="eyebrow flex h-(--size-button-sm) items-center rounded-pill px-sm"
        :class="screen === 'book' ? 'text-ink' : 'text-ink-faint'"
        data-testid="proto.book"
        @click="go({ screen: 'book', book: String(route.query.book ?? 'eden'), state: undefined })"
      >
        Book
      </button>
      <span class="mx-xxs h-ms w-(--stroke-hairline) bg-hairline-strong" aria-hidden="true" />
      <button
        type="button"
        class="flex size-(--size-button-sm) items-center justify-center rounded-pill text-ink-muted"
        :aria-label="theme === 'dark' ? 'Light' : 'Dark'"
        data-testid="proto.theme"
        @click="applyTheme(theme === 'dark' ? 'light' : 'dark')"
      >
        <UiIcon :name="theme === 'dark' ? 'sun' : 'moon'" :size="15" />
      </button>
      <button
        type="button"
        class="flex size-(--size-button-sm) items-center justify-center rounded-pill text-ink-muted"
        aria-label="Reset"
        :title="`Reset · ${buzz}`"
        data-testid="proto.reset"
        @click="reset()"
      >
        <UiIcon name="repeat" :size="15" />
      </button>
    </nav>
  </div>
</template>

<style scoped>
/* In the empty middle of the header's controls row (Home) or the top bar (book). */
.proto-bar {
  top: calc(var(--bar-top) + (var(--size-touch) - var(--size-button-sm)) / 2 - var(--spacing-xxs));
}
</style>
