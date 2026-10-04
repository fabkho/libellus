<script setup lang="ts">
// Design round #65, Direction D "Counter + chart" (the owner's pick of B's
// flow with C's chart): nothing edits progress until you tap Update, which
// opens B's wheel sheet — with the last two weeks over the wheel, today's bar
// growing as it turns. Home's card and the book page carry C's glance:
// sparkline, pace, days to go, figures and the reading log. Query:
// `screen=home|book`, `book=eden|gods|leviathan`, `state=sheet|total|end|
// saved|done|finish`, `theme`, `bare`.
import { dayIndex, dayWords, maxOf, n, positionOf, setPosition, useProtoReads, usesPages, type ProtoRead } from '~/components/proto/progress/model'

definePageMeta({ layout: false })
useHead({ title: 'Progress · D Counter + chart' })

const route = useRoute()
const router = useRouter()
const { reads } = useProtoReads('d')
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
/** Where each read was before its last save, so its card can offer Undo. */
const undoFrom = reactive<Record<string, number | null>>({})
function saved(read: ProtoRead, from: number) {
  if (positionOf(read) === from) return
  undoFrom[read.book.key] = null
  void nextTick(() => (undoFrom[read.book.key] = from))
}
/** How the read went, for the Finish sheet (C's finish moment). */
function summaryOf(read: ProtoRead) {
  const span = dayIndex(read.startedOn) + 1
  return `Read in ${span} days · ${n(Math.round(maxOf(read) / span))}${usesPages(read) ? ' pages' : ' %'} a day`
}

const finishing = ref<ProtoRead | null>(null)
const finishOpen = ref(false)
const summary = ref<string | null>(null)
function finish(read: ProtoRead, line: string | null = null) {
  finishing.value = read
  summary.value = line
  // After the update sheet has gone.
  setTimeout(() => (finishOpen.value = true), sheetOpen.value ? 300 : 0)
}
function openBook(read: ProtoRead) {
  void router.push({ query: { ...route.query, screen: 'book', book: read.book.key, state: undefined } })
}
function back() {
  void router.push({ query: { ...route.query, screen: undefined, book: undefined, state: undefined } })
}

if (state.value === 'done') setPosition(reads[0]!, maxOf(reads[0]!))
if (state.value === 'saved') {
  const eden = reads[0]!
  const from = positionOf(eden)
  setPosition(eden, from + 24)
  undoFrom[eden.book.key] = from
}
onMounted(() => {
  const target = screen.value === 'book' ? current.value : reads[0]!
  if (state.value === 'sheet') update(target)
  if (state.value === 'total') update(screen.value === 'book' ? current.value : reads[1]!, 'total')
  if (state.value === 'end') update(target, 'end')
  if (state.value === 'finish') finish(target, summaryOf(target))
})

const history = computed(() => [...current.value.log].reverse().slice(0, 6))
</script>

<template>
  <ProtoProgressFrame direction="d">
    <ProtoProgressHome v-if="screen === 'home'" :reads="reads">
      <template #card="{ read }">
        <ProtoProgressDCard
          :read="read"
          :undo-from="undoFrom[read.book.key] ?? null"
          @book="openBook(read)"
          @update="update(read)"
          @finish="(line) => finish(read, line)"
        />
      </template>
    </ProtoProgressHome>
    <ProtoProgressBook v-else :read="current" @back="back" @finish="finish(current, summaryOf(current))">
      <ProtoProgressDPanel :read="current" @update="update(current)" @total="update(current, 'total')" />
      <template #below>
        <section class="relative px-ml pt-xl" data-testid="d.history">
          <h2 class="eyebrow mb-ms">Reading log</h2>
          <UiRowGroup>
            <UiRow v-for="day in history" :key="day.day" :label="dayWords(day.day)" mono>
              <span class="text-accent">+{{ n(day.to - day.from) }}{{ usesPages(current) ? '' : ' %' }}</span>
              <span class="text-ink-faint">{{ usesPages(current) ? `p. ${n(day.to)}` : `${day.to} %` }}</span>
            </UiRow>
          </UiRowGroup>
        </section>
      </template>
    </ProtoProgressBook>

    <ProtoProgressBSheet v-model:open="sheetOpen" :read="sheetRead" :start="sheetStart" chart @saved="saved" @finish="(read) => finish(read, summaryOf(read))" />
    <ProtoProgressFinishSheet v-model:open="finishOpen" :read="finishing" :summary="summary" />
  </ProtoProgressFrame>
</template>
