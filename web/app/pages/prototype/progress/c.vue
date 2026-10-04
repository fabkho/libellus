<script setup lang="ts">
// Design round #65, Direction C "Sessions": progress is logged as what you
// read today; the total runs on by itself, a sparkline and the pace give the
// glance. The logger opens in place on Home's card and the book page. Query:
// `screen=home|book`, `book=eden|gods|leviathan`, `state=log|saved|end|total|
// finish`, `theme`, `bare`.
import { dayWords, maxOf, n, setPosition, useProtoReads, usesPages, type ProtoRead } from '~/components/proto/progress/model'

definePageMeta({ layout: false })
useHead({ title: 'Progress · C Sessions' })

const route = useRoute()
const router = useRouter()
const { reads } = useProtoReads('c')
const screen = computed(() => (route.query.screen === 'book' ? 'book' : 'home'))
const state = computed(() => String(route.query.state ?? ''))
const current = computed(() => reads.find((r) => r.book.key === route.query.book) ?? reads[0]!)

const finishing = ref<ProtoRead | null>(null)
const finishOpen = ref(false)
const summary = ref<string | null>(null)
const totalOpen = ref(false)
function finish(read: ProtoRead, line: string | null = null) {
  finishing.value = read
  summary.value = line
  finishOpen.value = true
}
function openBook(read: ProtoRead) {
  void router.push({ query: { ...route.query, screen: 'book', book: read.book.key, state: undefined } })
}
function back() {
  void router.push({ query: { ...route.query, screen: undefined, book: undefined, state: undefined } })
}

if (state.value === 'end') setPosition(reads[0]!, maxOf(reads[0]!))
onMounted(() => {
  if (state.value === 'total') totalOpen.value = true
  if (state.value === 'finish') finish(screen.value === 'book' ? current.value : reads[0]!, 'Read in 12 days · 51 pages a day')
})

const history = computed(() => [...current.value.log].reverse().slice(0, 6))
</script>

<template>
  <ProtoProgressFrame direction="c">
    <ProtoProgressHome v-if="screen === 'home'" :reads="reads">
      <template #card="{ read, index }">
        <ProtoProgressCCard
          :read="read"
          :open="state === 'log' && index === 0"
          :preset="state === 'log' && index === 0 ? 30 : null"
          :saved="state === 'saved' && index === 0"
          @book="openBook(read)"
          @finish="(line) => finish(read, line)"
        />
      </template>
    </ProtoProgressHome>
    <ProtoProgressBook v-else :read="current" @back="back" @finish="finish(current)">
      <ProtoProgressCPanel :read="current" :open="state === 'log'" @total="totalOpen = true" />
      <template #below>
        <section v-if="!current.finished" class="relative px-ml pt-xl" data-testid="c.history">
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

    <ProtoProgressFinishSheet v-model:open="finishOpen" :read="finishing" :summary="summary" />
    <ProtoProgressTotalSheet v-model:open="totalOpen" :read="current" />
  </ProtoProgressFrame>
</template>
