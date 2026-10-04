<script setup lang="ts">
// Design round #78: the frame every Profile prototype sits in. The screen at
// the phone's width (centred on a wide one, as the app does), and a small proto
// bar at the top centre — the direction, the screens it touches, the theme,
// Reset — that the screenshots leave out (`?bare`). The theme comes from
// `?theme=light|dark` or the bar; it is not stored. `?at=<id>` scrolls to a
// section once the page is in (the screenshots use it).
import { applyTheme, protoTheme, type Direction } from './model'

const props = defineProps<{ direction: Direction; screens: readonly { key: string; label: string }[] }>()

const route = useRoute()
const router = useRouter()
const bare = computed(() => 'bare' in route.query)
const screen = computed(() => String(route.query.screen ?? props.screens[0]!.key))

onMounted(() => {
  const asked = route.query.theme
  if (asked === 'light' || asked === 'dark') applyTheme(asked)
  else applyTheme(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
})

async function scrollToAnchor() {
  const at = route.query.at
  if (typeof at !== 'string') return
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 60))
  const el = document.getElementById(at)
  if (!el) return
  window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - Number(route.query.offset ?? 56), behavior: 'instant' })
}
onMounted(scrollToAnchor)
watch(() => [route.query.at, route.query.screen], scrollToAnchor)

function go(key: string) {
  void router.replace({ query: { theme: route.query.theme, screen: key } })
  window.scrollTo({ top: 0, behavior: 'instant' })
}
function reset() {
  void router.replace({ query: { theme: protoTheme.value } })
  window.scrollTo({ top: 0, behavior: 'instant' })
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
        to="/prototype/profile"
        class="flex size-(--size-button-sm) items-center justify-center rounded-pill text-ink-muted"
        aria-label="All directions"
        data-testid="proto.index"
      >
        <UiIcon name="stack" :size="15" />
      </NuxtLink>
      <NuxtLink
        v-for="key in ['a', 'b', 'd']"
        :key="key"
        :to="{ path: `/prototype/profile/${key}`, query: { theme: protoTheme } }"
        class="figures flex size-(--size-button-sm) items-center justify-center rounded-pill text-meta uppercase"
        :class="key === direction ? 'bg-ink text-on-ink' : 'text-ink-muted'"
        :data-testid="`proto.direction.${key}`"
      >
        {{ key }}
      </NuxtLink>
      <span class="mx-xxs h-ms w-(--stroke-hairline) bg-hairline-strong" aria-hidden="true" />
      <button
        v-for="s in screens"
        :key="s.key"
        type="button"
        class="eyebrow flex h-(--size-button-sm) items-center rounded-pill px-xs"
        :class="screen === s.key ? 'text-ink' : 'text-ink-faint'"
        :data-testid="`proto.screen.${s.key}`"
        @click="go(s.key)"
      >
        {{ s.label }}
      </button>
      <span class="mx-xxs h-ms w-(--stroke-hairline) bg-hairline-strong" aria-hidden="true" />
      <button
        type="button"
        class="flex size-(--size-button-sm) items-center justify-center rounded-pill text-ink-muted"
        :aria-label="protoTheme === 'dark' ? 'Light' : 'Dark'"
        data-testid="proto.theme"
        @click="applyTheme(protoTheme === 'dark' ? 'light' : 'dark')"
      >
        <UiIcon :name="protoTheme === 'dark' ? 'sun' : 'moon'" :size="15" />
      </button>
      <button
        type="button"
        class="flex size-(--size-button-sm) items-center justify-center rounded-pill text-ink-muted"
        aria-label="Reset"
        data-testid="proto.reset"
        @click="reset()"
      >
        <UiIcon name="repeat" :size="15" />
      </button>
    </nav>
  </div>
</template>

<style scoped>
/* In the empty middle of the header's controls row (or a pushed screen's top bar). */
.proto-bar {
  top: calc(var(--bar-top) + (var(--size-touch) - var(--size-button-sm)) / 2 - var(--spacing-xxs));
}
</style>
