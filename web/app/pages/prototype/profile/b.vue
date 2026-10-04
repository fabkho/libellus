<script setup lang="ts">
// Design round #78, Direction B "Reading life": the avatar opens a profile,
// pushed like a book page — the reading in sentences and covers, the years
// before as cards (each opens its year in review), the account at the end.
// No menu any more; no fourth tab. Query: `screen=home|profile|year`,
// `year=2023…2026`, `at=<section>`, `theme`, `bare`.
import { THIS_YEAR } from '~/components/proto/profile/model'

definePageMeta({ layout: false })
useHead({ title: 'Profile · B Reading life' })

const route = useRoute()
const router = useRouter()
const screen = computed(() => (route.query.screen === 'home' ? 'home' : route.query.screen === 'year' ? 'year' : 'profile'))
const year = computed(() => Number(route.query.year ?? THIS_YEAR))

function open(query: Record<string, string | undefined>) {
  void router.push({ query: { theme: route.query.theme, bare: route.query.bare, ...query } })
  window.scrollTo({ top: 0, behavior: 'instant' })
}
function back() {
  router.back()
}
</script>

<template>
  <ProtoProfileFrame
    direction="b"
    :screens="[
      { key: 'profile', label: 'Profile' },
      { key: 'year', label: 'Year' },
      { key: 'home', label: 'Home' },
    ]"
  >
    <ProtoProfileHome v-if="screen === 'home'" avatar="link" @avatar="open({ screen: 'profile' })" />
    <ProtoProfileBProfile v-else-if="screen === 'profile'" @back="open({ screen: 'home' })" @year="open({ screen: 'year', year: String($event) })" />
    <ProtoProfileBYear v-else :key="year" :year="year" @back="back" @year="open({ screen: 'year', year: String($event) })" />
    <ProtoProfileTabBar :current="screen === 'home' ? 'home' : 'none'" @go="$event === 'home' && open({ screen: 'home' })" />
  </ProtoProfileFrame>
</template>
