<script setup lang="ts">
// Direction C on the book page: the read as a habit. Four figures (where you
// are of how many — the page count of your copy one tap away, #60 — how far,
// your pace, how long to go), three weeks of reading as bars with the day
// letters, and "Log today's reading", which opens the logger in place.
import {
  daysLeftOf,
  fractionOf,
  haptic,
  maxOf,
  n,
  paceOf,
  percentOf,
  positionOf,
  setPosition,
  todayOf,
  totalOf,
  usesPages,
  valueWords,
  type ProtoRead,
} from '../model'

const props = defineProps<{ read: ProtoRead; open?: boolean }>()
const emit = defineEmits<{ total: [] }>()

const logging = ref(Boolean(props.open))
const amount = ref(0)
const pages = computed(() => usesPages(props.read))
const pace = computed(() => paceOf(props.read))
const days = computed(() => daysLeftOf(props.read))
const today = computed(() => todayOf(props.read))
const atEnd = computed(() => positionOf(props.read) >= maxOf(props.read))

function openLog() {
  amount.value = Math.min(Math.max(5, Math.round((pace.value ?? 20) / 5) * 5), maxOf(props.read) - positionOf(props.read))
  logging.value = true
}
if (props.open) openLog()
function log(to: number) {
  setPosition(props.read, to)
  logging.value = false
  haptic(to >= maxOf(props.read) ? 'done' : 'step', { fromClick: true })
}
</script>

<template>
  <div class="mb-ml flex flex-col gap-md" data-testid="c.panel">
    <UiProgress :fraction="fractionOf(read)" label="Reading progress" :value-text="valueWords(read)" />
    <dl class="grid grid-cols-4 gap-sm">
      <div class="flex flex-col gap-xs">
        <dt class="eyebrow">{{ pages ? 'Page' : 'Read' }}</dt>
        <dd class="figures text-callout">{{ pages ? n(positionOf(read)) : `${positionOf(read)} %` }}</dd>
        <dd>
          <button v-if="pages" type="button" class="total figures text-meta text-ink-faint" data-testid="c.total" @click="emit('total')">
            of {{ n(totalOf(read)!) }}
          </button>
          <button v-else type="button" class="total text-meta text-ink-faint" data-testid="c.addTotal" @click="emit('total')">Add pages</button>
        </dd>
      </div>
      <div class="flex flex-col gap-xs">
        <dt class="eyebrow">{{ pages ? 'Done' : 'Left' }}</dt>
        <dd class="figures text-callout">{{ pages ? percentOf(read) : 100 - percentOf(read) }} %</dd>
        <dd v-if="read.total" class="figures text-meta text-ink-faint">{{ read.book.format === 'ebook' ? 'ebook' : 'your copy' }}</dd>
      </div>
      <div class="flex flex-col gap-xs">
        <dt class="eyebrow">A day</dt>
        <dd class="figures text-callout">{{ pace ?? '–' }}{{ pace && !pages ? ' %' : '' }}</dd>
        <dd class="figures text-meta text-ink-faint">{{ pages ? 'pages' : '' }}</dd>
      </div>
      <div class="flex flex-col gap-xs">
        <dt class="eyebrow">To go</dt>
        <dd class="figures text-callout">{{ atEnd ? '0' : (days ?? '–') }}</dd>
        <dd class="figures text-meta text-ink-faint">days</dd>
      </div>
    </dl>

    <div class="flex flex-col gap-sm">
      <ProtoProgressCSpark :read="read" :days="21" size="lg" :pending="logging ? amount : 0" />
    </div>

    <div v-if="!logging && !atEnd">
      <UiButton tone="quiet" block data-testid="c.logOpen" @click="openLog">
        <UiIcon name="plus" :size="18" bold />{{ today ? `Today +${n(today.to - today.from)}${pages ? ' pages' : ' %'} · log more` : "Log today's reading" }}
      </UiButton>
    </div>
    <p v-else-if="atEnd" class="text-center text-body">That's the last page. Finished it?</p>
    <div v-if="logging" class="rounded-lg bg-surface-raised p-inset shadow-raised edge-faint">
      <ProtoProgressCLog v-model:amount="amount" :read="read" @log="log" @cancel="logging = false" />
    </div>
  </div>
</template>

<style scoped>
.total {
  min-height: var(--size-touch);
  margin-block: calc((var(--size-touch) - 1lh) / -2);
  text-align: left;
  text-decoration: underline dotted var(--color-ink-ghost);
  text-underline-offset: var(--spacing-xs);
}
</style>
