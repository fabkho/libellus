<script setup lang="ts">
// Design round #78, Direction C "In the Library": no profile screen (DESIGN.md
// keeps that rule). The stats fold into the Library — the years over
// Finished, a year's review in a sheet, how long each read took on its row,
// the days read lately over Currently reading — and Home's tally opens its
// year. The account stays in the avatar menu. Query: `screen=library|home`,
// `segment=want_to_read|reading|finished`, `filter=notFinished`, `year=2025`
// (the year's sheet), `menu` (the avatar menu open), `at=<id>`, `theme`, `bare`.
import { THIS_YEAR } from '~/components/proto/profile/model'

definePageMeta({ layout: false })
useHead({ title: 'Profile · C In the Library' })

type Segment = 'want_to_read' | 'reading' | 'finished'
const route = useRoute()
const router = useRouter()
const screen = computed(() => (route.query.screen === 'home' ? 'home' : 'library'))
const segment = computed<Segment>(() => (['want_to_read', 'reading'].includes(String(route.query.segment)) ? (route.query.segment as Segment) : 'finished'))
const filter = computed(() => (route.query.filter === 'notFinished' ? 'notFinished' : 'all'))
// The year sheet and the menu are local state (a query only opens them on
// load, for the screenshots): a sheet that writes the route fights its own
// Back handling.
const year = ref<number | null>(route.query.year ? Number(route.query.year) : null)
const shownYear = ref(year.value ?? THIS_YEAR)
watch(year, (y) => y && (shownYear.value = y))
const sheetOpen = computed({
  get: () => year.value !== null,
  set: (open: boolean) => !open && (year.value = null),
})
const menu = ref('menu' in route.query)

function set(query: Record<string, string | null | undefined>) {
  void router.replace({ query: { ...route.query, at: undefined, ...query } })
}
function tab(to: string) {
  void router.push({ query: { theme: route.query.theme, bare: route.query.bare, screen: to === 'library' ? undefined : to } })
  window.scrollTo({ top: 0, behavior: 'instant' })
}
function openYear() {
  void router.push({ query: { theme: route.query.theme, bare: route.query.bare, segment: 'finished' } })
  window.scrollTo({ top: 0, behavior: 'instant' })
  setTimeout(() => (year.value = THIS_YEAR), 350)
}
</script>

<template>
  <ProtoProfileFrame
    direction="c"
    :screens="[
      { key: 'library', label: 'Library' },
      { key: 'home', label: 'Home' },
    ]"
  >
    <ProtoProfileHome v-if="screen === 'home'">
      <template #tally>
        <button type="button" class="figures -mb-sm flex h-(--size-touch) items-center gap-xxs self-end text-footnote text-ink-faint" data-testid="c.tallyYear" @click="openYear">
          {{ THIS_YEAR }} in the Library<UiIcon name="chevron" :size="13" />
        </button>
      </template>
    </ProtoProfileHome>
    <ProtoProfileCLibrary
      v-else
      :segment="segment"
      :filter="filter"
      :menu="menu"
      @segment="set({ segment: $event === 'finished' ? undefined : $event, filter: undefined })"
      @filter="set({ filter: $event === 'all' ? undefined : $event })"
      @year="year = $event"
      @menu="menu = $event"
    />
    <ProtoProfileCYearSheet v-model:open="sheetOpen" :year="shownYear" />
    <ProtoProfileTabBar :current="screen" @go="tab" />
  </ProtoProfileFrame>
</template>
