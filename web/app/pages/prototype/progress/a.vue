<script setup lang="ts">
// Design round #65, Direction A "Scrub": the bar is the control, on Home's
// card and on the book page; no sheet. Query: `screen=home|book`, `book=eden|
// gods|leviathan`, `state=scrub|saved|end|total|finish` (a still for the
// screenshots), `theme`, `bare`.
import { maxOf, setPosition, useProtoReads, type ProtoRead } from '~/components/proto/progress/model'

definePageMeta({ layout: false })
useHead({ title: 'Progress · A Scrub' })

const route = useRoute()
const router = useRouter()
const { reads } = useProtoReads('a')
const screen = computed(() => (route.query.screen === 'book' ? 'book' : 'home'))
const state = computed(() => String(route.query.state ?? ''))
const current = computed(() => reads.find((r) => r.book.key === route.query.book) ?? reads[0]!)

const finishing = ref<ProtoRead | null>(null)
const finishOpen = ref(false)
const totalOpen = ref(false)
function finish(read: ProtoRead) {
  finishing.value = read
  finishOpen.value = true
}
function openBook(read: ProtoRead) {
  void router.push({ query: { ...route.query, screen: 'book', book: read.book.key, state: undefined } })
}
function back() {
  void router.push({ query: { ...route.query, screen: undefined, book: undefined, state: undefined } })
}

onMounted(() => {
  const eden = reads[0]!
  if (state.value === 'end') setPosition(eden, maxOf(eden))
  if (state.value === 'total') totalOpen.value = true
  if (state.value === 'finish') finish(screen.value === 'book' ? current.value : eden)
})
const demo = (read: ProtoRead) => (state.value === 'scrub' && read === (screen.value === 'book' ? current.value : reads[0]) ? 248 : null)
</script>

<template>
  <ProtoProgressFrame direction="a">
    <ProtoProgressHome v-if="screen === 'home'" :reads="reads">
      <template #card="{ read, index }">
        <ProtoProgressACard :read="read" :demo="demo(read)" :saved="state === 'saved' && index === 0" @open="openBook(read)" @finish="finish(read)" />
      </template>
    </ProtoProgressHome>
    <ProtoProgressBook v-else :read="current" @back="back" @finish="finish(current)">
      <ProtoProgressAPanel :read="current" :demo="demo(current)" @total="totalOpen = true" />
    </ProtoProgressBook>

    <ProtoProgressFinishSheet v-model:open="finishOpen" :read="finishing" />
    <ProtoProgressTotalSheet v-model:open="totalOpen" :read="current" />
  </ProtoProgressFrame>
</template>
