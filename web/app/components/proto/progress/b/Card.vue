<script setup lang="ts">
// Direction B on Home: the reading card as it is (bar, value), with one more
// thing — "+24", the size of your last session, as a one-tap update. Most
// evenings are like the last one; the chip saves them without a sheet, says
// what it did, and offers Undo. Anything else: the value opens the wheel.
import { haptic, lastSessionOf, maxOf, n, positionOf, setPosition, usesPages, valueWords, fractionOf, type ProtoRead } from '../model'

const props = defineProps<{ read: ProtoRead; saved?: boolean }>()
const emit = defineEmits<{ open: []; update: []; finish: [] }>()

const { t } = useI18n()
const { formatDay, dayOfRead } = useDays()
const since = computed(() => t('book.since', { date: formatDay(props.read.startedOn), day: dayOfRead(props.read.startedOn) }))
const authorLine = computed(() => formatAuthors(props.read.book.authors, t('common.etAl')))

const last = computed(() => lastSessionOf(props.read))
const again = computed(() => (last.value ? last.value.to - last.value.from : 0))
const unit = computed(() => (usesPages(props.read) ? '' : ' %'))
const undo = ref<{ from: number; to: number } | null>(null)
let timer: ReturnType<typeof setTimeout> | undefined
const atEnd = computed(() => positionOf(props.read) >= maxOf(props.read))

function repeat() {
  const from = positionOf(props.read)
  const to = Math.min(from + again.value, maxOf(props.read))
  setPosition(props.read, to)
  haptic(to === maxOf(props.read) ? 'done' : 'step', { fromClick: true })
  undo.value = { from, to }
  clearTimeout(timer)
  timer = setTimeout(() => (undo.value = null), 5000)
}
function revert() {
  if (!undo.value) return
  setPosition(props.read, undo.value.from)
  undo.value = null
}
onMounted(() => {
  if (props.saved) undo.value = { from: positionOf(props.read) - 24, to: positionOf(props.read) }
})
</script>

<template>
  <article class="relative flex gap-md overflow-hidden rounded-lg bg-surface-raised p-inset shadow-raised edge-faint" data-testid="b.card">
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
      <div class="mt-auto pt-md">
        <UiProgress :fraction="fractionOf(read)" label="Reading progress" :value-text="valueWords(read)" />
      </div>
      <div class="flex items-center justify-between gap-ms pt-xs">
        <button
          type="button"
          class="figures -ml-xs min-h-(--size-touch) min-w-0 truncate px-xs text-left text-meta text-ink-muted hover:text-ink"
          data-testid="b.value"
          @click="emit('update')"
        >
          <template v-if="atEnd"><span class="text-ink">Finished it?</span></template>
          <template v-else>
            {{ valueWords(read) }}
            <span v-if="undo" class="text-accent">· +{{ n(undo.to - undo.from) }}{{ unit }}</span>
          </template>
        </button>
        <UiButton v-if="atEnd" size="sm" data-testid="b.finish" @click="emit('finish')"><UiIcon name="check" :size="15" bold />{{ t('book.finish') }}</UiButton>
        <UiButton v-else-if="undo" tone="plain" size="sm" class="-mr-sm" data-testid="b.undo" @click="revert">Undo</UiButton>
        <UiButton
          v-else-if="again"
          tone="quiet"
          size="sm"
          :aria-label="`Add ${again}${unit || ' pages'}, like last time`"
          data-testid="b.again"
          @click="repeat"
        >
          <UiIcon name="repeat" :size="14" />+{{ n(again) }}{{ unit }}
        </UiButton>
      </div>
    </div>
  </article>
</template>
