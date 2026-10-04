<script setup lang="ts">
// Design round #78, Direction A "Ledger": a fourth tab, You — the reading in
// figures, by year, with the account at the end. Home loses its avatar (the
// tab is the account now). Query: `screen=you|home`, `year=2026|…|all`,
// `month=0–11` (a month's books), `at=<section>`, `theme`, `bare`.
import { THIS_YEAR, type Year } from '~/components/proto/profile/model'

definePageMeta({ layout: false })
useHead({ title: 'Profile · A Ledger' })

const route = useRoute()
const router = useRouter()
const screen = computed(() => (route.query.screen === 'home' ? 'home' : 'you'))
const year = computed<Year>(() => (route.query.year === 'all' ? 'all' : Number(route.query.year ?? THIS_YEAR)))
// The month sheet is local state (a query only opens it on load, for the
// screenshots): a sheet that writes the route fights its own Back handling.
const month = ref<number | null>(route.query.month == null ? null : Number(route.query.month))

function set(query: Record<string, string | undefined>) {
  void router.replace({ query: { ...route.query, at: undefined, ...query } })
}
function tab(to: string) {
  if (to === screen.value) return window.scrollTo({ top: 0, behavior: 'smooth' })
  void router.push({ query: { theme: route.query.theme, bare: route.query.bare, screen: to === 'you' ? undefined : to } })
  window.scrollTo({ top: 0, behavior: 'instant' })
}
</script>

<template>
  <ProtoProfileFrame
    direction="a"
    :screens="[
      { key: 'you', label: 'You' },
      { key: 'home', label: 'Home' },
    ]"
  >
    <ProtoProfileHome v-if="screen === 'home'" avatar="none" />
    <ProtoProfileAYou
      v-else
      :year="year"
      :month="month"
      @year="set({ year: String($event) })"
      @month="month = $event"
    />
    <ProtoProfileTabBar you :current="screen" @go="tab" />
  </ProtoProfileFrame>
</template>
