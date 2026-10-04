<script setup lang="ts">
// Direction A on Home: the reading card as it is, but its bar is the
// scrubber. Slide along it and let go: saved, right there, no sheet. The line
// under it says where you are and how much is left; for a few seconds after a
// slide it says what changed, with Undo. Slid to the last page, the line
// becomes "Finished it?" with Finish lit.
import { leftWords, maxOf, n, positionOf, setPosition, usesPages, valueWords, haptic, type ProtoRead } from '../model'

const props = defineProps<{ read: ProtoRead; demo?: number | null; saved?: boolean }>()
const emit = defineEmits<{ open: []; finish: [] }>()

const { t } = useI18n()
const { formatDay, dayOfRead } = useDays()
const since = computed(() => t('book.since', { date: formatDay(props.read.startedOn), day: dayOfRead(props.read.startedOn) }))
const authorLine = computed(() => formatAuthors(props.read.book.authors, t('common.etAl')))

const live = ref<number | null>(null)
const undo = ref<{ from: number; to: number } | null>(null)
let timer: ReturnType<typeof setTimeout> | undefined
const hint = ref(false)

function commit(from: number, to: number) {
  setPosition(props.read, to)
  undo.value = { from, to }
  if (to === maxOf(props.read)) haptic('done')
  clearTimeout(timer)
  timer = setTimeout(() => (undo.value = null), 5000)
}
function revert() {
  if (!undo.value) return
  setPosition(props.read, undo.value.from)
  undo.value = null
  haptic('step', { fromClick: true })
}
function tapped() {
  hint.value = true
  clearTimeout(timer)
  timer = setTimeout(() => (hint.value = false), 1800)
}
onMounted(() => {
  if (props.saved) undo.value = { from: positionOf(props.read) - 36, to: positionOf(props.read) }
})

const atEnd = computed(() => live.value === null && positionOf(props.read) >= maxOf(props.read))
const shown = computed(() => live.value ?? props.demo ?? positionOf(props.read))
const gain = computed(() => (undo.value ? undo.value.to - undo.value.from : 0))
</script>

<template>
  <article class="relative flex gap-md overflow-hidden rounded-lg bg-surface-raised p-inset shadow-raised edge-faint" data-testid="a.card">
    <UiAmbient :colors="read.book.coverColors" shape="card" />
    <button type="button" class="relative" tabindex="-1" aria-hidden="true" @click="emit('open')">
      <UiCover
        :title="read.book.title"
        :authors="read.book.authors"
        :src="coverSrc(read.book.coverUrl, 'lg')"
        :thumbhash="read.book.coverThumbhash"
        :colors="read.book.coverColors"
        size="lg"
        glow
        eager
      />
    </button>
    <div class="relative flex min-w-0 flex-1 flex-col pt-xxs">
      <button type="button" class="flex flex-col gap-xs text-left" @click="emit('open')">
        <span class="book-title line-clamp-2 text-book-title">{{ read.book.title }}</span>
        <span class="truncate text-body text-ink-muted">{{ authorLine }}</span>
        <span class="figures mt-xs text-meta text-ink-faint">{{ since }}</span>
      </button>
      <div class="-mb-ms mt-auto pt-xs">
        <ProtoProgressAScrub :read="read" :demo="demo" @commit="commit" @live="live = $event" @tap="tapped" />
      </div>
      <div class="flex min-h-(--size-touch) items-center justify-between gap-ms">
        <template v-if="atEnd">
          <span class="text-body">Finished it?</span>
          <UiButton size="sm" data-testid="a.finish" @click="emit('finish')"><UiIcon name="check" :size="15" bold />{{ t('book.finish') }}</UiButton>
        </template>
        <template v-else-if="undo && live === null">
          <span class="figures truncate text-meta text-ink-muted">
            {{ valueWords(read) }}
            <span class="text-accent">· {{ gain >= 0 ? '+' : '−' }}{{ n(Math.abs(gain)) }}{{ usesPages(read) ? '' : ' %' }}</span>
          </span>
          <UiButton tone="plain" size="sm" class="-mr-sm" data-testid="a.undo" @click="revert">Undo</UiButton>
        </template>
        <template v-else>
          <span class="figures truncate text-meta" :class="hint ? 'text-accent' : 'text-ink-muted'">
            {{ hint ? 'Slide along the line' : valueWords(read, shown) }}
          </span>
          <span v-if="!hint" class="figures shrink-0 text-meta text-ink-faint">{{ leftWords(read, shown).replace(' pages', '') }}</span>
        </template>
      </div>
    </div>
  </article>
</template>
