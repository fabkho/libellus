<script setup lang="ts">
// Direction D on the book page (B's flow, C's chart): the bar, C's four
// figures (page of how many — the page count of your copy one tap away, #60 —
// done, a day, to go) and three weeks of reading as bars, then "Last time" and
// Update progress, which opens B's wheel sheet. Nothing here edits by itself.
import { dayWords, daysLeftOf, fractionOf, lastSessionOf, maxOf, n, paceOf, percentOf, positionOf, totalOf, usesPages, valueWords, type ProtoRead } from '../model'

const props = defineProps<{ read: ProtoRead }>()
const emit = defineEmits<{ update: []; total: [] }>()

const pages = computed(() => usesPages(props.read))
const pace = computed(() => paceOf(props.read))
const days = computed(() => daysLeftOf(props.read))
const atEnd = computed(() => positionOf(props.read) >= maxOf(props.read))
const last = computed(() => lastSessionOf(props.read))
</script>

<template>
  <div class="mb-ml flex flex-col gap-md" data-testid="d.panel">
    <UiProgress :fraction="fractionOf(read)" label="Reading progress" :value-text="valueWords(read)" />
    <dl class="grid grid-cols-4 gap-sm">
      <div class="flex flex-col gap-xs">
        <dt class="eyebrow">{{ pages ? 'Page' : 'Read' }}</dt>
        <dd class="figures text-callout">{{ pages ? n(positionOf(read)) : `${positionOf(read)} %` }}</dd>
        <dd>
          <button v-if="pages" type="button" class="total figures text-meta text-ink-faint" data-testid="d.total" @click="emit('total')">
            of {{ n(totalOf(read)!) }}
          </button>
          <button v-else type="button" class="total text-meta text-ink-faint" data-testid="d.addTotal" @click="emit('total')">Add pages</button>
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

    <ProtoProgressCSpark :read="read" :days="21" size="lg" />

    <div class="flex items-center justify-between gap-ms">
      <p class="figures min-w-0 truncate text-meta text-ink-faint">
        <template v-if="atEnd"><span class="text-body text-ink">The last page. Finished it?</span></template>
        <template v-else-if="last"><span class="eyebrow mr-sm">Last time</span>{{ dayWords(last.day) }} · {{ n(last.to - last.from) }}{{ pages ? ' pages' : ' %' }}</template>
      </p>
      <UiButton v-if="!atEnd" tone="quiet" size="sm" data-testid="d.update" @click="emit('update')">Update progress</UiButton>
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
