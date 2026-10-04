<script setup lang="ts">
// Design round #65, Direction B "Counter": a number wheel in a compact sheet,
// with last-session memory and a one-tap repeat on Home. Query: `screen=home|
// book`, `book=eden|gods|leviathan`, `state=sheet|total|end|saved|finish`,
// `theme`, `bare`.
import { maxOf, setPosition, useProtoReads, type ProtoRead } from '~/components/proto/progress/model'

definePageMeta({ layout: false })
useHead({ title: 'Progress · B Counter' })

const route = useRoute()
const router = useRouter()
const { reads } = useProtoReads('b')
const screen = computed(() => (route.query.screen === 'book' ? 'book' : 'home'))
const state = computed(() => String(route.query.state ?? ''))
const current = computed(() => reads.find((r) => r.book.key === route.query.book) ?? reads[0]!)

const sheetRead = ref<ProtoRead | null>(null)
const sheetOpen = ref(false)
const sheetStart = ref<'total' | 'end' | null>(null)
function update(read: ProtoRead, start: 'total' | 'end' | null = null) {
  sheetRead.value = read
  sheetStart.value = start
  sheetOpen.value = true
}
const finishing = ref<ProtoRead | null>(null)
const finishOpen = ref(false)
function finish(read: ProtoRead) {
  finishing.value = read
  // After the update sheet has gone.
  setTimeout(() => (finishOpen.value = true), sheetOpen.value ? 300 : 0)
}
function openBook(read: ProtoRead) {
  void router.push({ query: { ...route.query, screen: 'book', book: read.book.key, state: undefined } })
}
function back() {
  void router.push({ query: { ...route.query, screen: undefined, book: undefined, state: undefined } })
}

onMounted(() => {
  const target = screen.value === 'book' ? current.value : reads[0]!
  if (state.value === 'sheet') update(target)
  if (state.value === 'total') update(screen.value === 'book' ? current.value : reads[1]!, 'total')
  if (state.value === 'end') update(target, 'end')
  if (state.value === 'done') setPosition(reads[0]!, maxOf(reads[0]!))
  if (state.value === 'finish') finish(target)
})
</script>

<template>
  <ProtoProgressFrame direction="b">
    <ProtoProgressHome v-if="screen === 'home'" :reads="reads">
      <template #card="{ read, index }">
        <ProtoProgressBCard :read="read" :saved="state === 'saved' && index === 0" @open="openBook(read)" @update="update(read)" @finish="finish(read)" />
      </template>
    </ProtoProgressHome>
    <ProtoProgressBook v-else :read="current" @back="back" @finish="finish(current)">
      <ProtoProgressBPanel :read="current" @update="update(current)" />
    </ProtoProgressBook>

    <ProtoProgressBSheet v-model:open="sheetOpen" :read="sheetRead" :start="sheetStart" @finish="finish" />
    <ProtoProgressFinishSheet v-model:open="finishOpen" :read="finishing" />
  </ProtoProgressFrame>
</template>
