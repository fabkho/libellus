<script setup lang="ts">
// Design round #78, Direction D "A + B" (round two, the owner's pick): B's
// place and hero — the avatar pushes a Profile page — over every stat of A
// and B as figures and covers (B's sentences are gone), and B's full-screen
// year in review, reached from the months ("2026 in review"), a year's column
// under All, or the year cards. Query: `screen=profile|year|home`,
// `year=2026|…|all` (the profile's year; the review's year on `screen=year`),
// `month=0–11` (a month's books, on load), `at=<section>`, `theme`, `bare`.
import { THIS_YEAR, type Year } from '~/components/proto/profile/model'

definePageMeta({ layout: false })
useHead({ title: 'Profile · D A + B' })

const route = useRoute()
const router = useRouter()
const screen = computed(() => (route.query.screen === 'home' ? 'home' : route.query.screen === 'year' ? 'year' : 'profile'))
const year = computed<Year>(() => (route.query.year === 'all' ? 'all' : Number(route.query.year ?? THIS_YEAR)))
const review = computed(() => (year.value === 'all' ? THIS_YEAR : year.value))

function open(query: Record<string, string | undefined>) {
  void router.push({ query: { theme: route.query.theme, bare: route.query.bare, ...query } })
  window.scrollTo({ top: 0, behavior: 'instant' })
}
</script>

<template>
  <ProtoProfileFrame
    direction="d"
    :screens="[
      { key: 'profile', label: 'Profile' },
      { key: 'year', label: 'Year' },
      { key: 'home', label: 'Home' },
    ]"
  >
    <ProtoProfileHome v-if="screen === 'home'" avatar="link" @avatar="open({ screen: 'profile' })" />
    <ProtoProfileDProfile
      v-else-if="screen === 'profile'"
      :year="year"
      :open-month="route.query.month == null ? null : Number(route.query.month)"
      @back="open({ screen: 'home' })"
      @year="router.replace({ query: { ...route.query, at: undefined, year: String($event) } })"
      @review="open({ screen: 'year', year: String($event) })"
    />
    <ProtoProfileDYear v-else :key="review" :year="review" @back="router.back()" @year="open({ screen: 'year', year: String($event) })" />
    <ProtoProfileTabBar :current="screen === 'home' ? 'home' : 'none'" @go="$event === 'home' && open({ screen: 'home' })" />
  </ProtoProfileFrame>
</template>
