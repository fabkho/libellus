<script setup lang="ts">
// Design round #65: the three Update progress directions side by side. On a
// phone a list to open each one from; on a wide screen the three running live
// next to each other, at the phone's size.
import { hapticsAvailable } from '~/components/proto/progress/model'

definePageMeta({ layout: false })
useHead({ title: 'Progress · Design round' })

const DIRECTIONS = [
  {
    key: 'a',
    name: 'Scrub',
    pitch: 'The bar is the control. Slide along it on Home or the book page and let go: saved, with Undo. No sheet.',
    good: [
      'One gesture from Home; nothing opens',
      'Haptic ticks every few pages, firmer at each tenth and at the end (Android)',
      'Slide up from the line for fine control; − / + on the book page',
      'The glance is today’s bar plus pages left and roughly how long',
    ],
    trade: [
      'An exact page on a long book takes fine mode or a few taps on +',
      'Needs discovering: the lit thumb and a hint on tap',
      'iOS gets no haptics while dragging',
    ],
  },
  {
    key: 'b',
    name: 'Counter',
    pitch: 'A compact sheet around one number: a wheel you spin, − / +, and smart steps. “+24 like last time” right on the card.',
    good: [
      'Exact and familiar (the platform picker), a tick per number',
      'Most evenings are one tap: repeat your last session from Home',
      '“of 608” edits your page count with the same wheel (#60)',
      'Closest to today’s code: a better sheet, same data',
    ],
    trade: [
      'Anything but a repeat still opens a sheet',
      'Far jumps need a flick or typing (tap the number)',
      'The card glance stays as it is',
    ],
  },
  {
    key: 'c',
    name: 'Sessions',
    pitch: 'Log what you read today, not where you are. The total runs on; a sparkline and your pace give the glance.',
    good: [
      'Matches the moment: you just read 30 pages',
      'The card opens in place, chips around your pace',
      'Pace, days to go and a three-week sparkline make the card alive',
      'The end comes with a summary of the read',
    ],
    trade: [
      'Needs a progress log per day (a new table and RPC)',
      'Correcting the page is a second mode (“I’m on page…”)',
      'More on every card; quieter readers may not want the streak',
    ],
  },
  {
    key: 'd',
    name: 'Counter + chart',
    pitch: 'B’s flow with C’s glance: nothing edits until you tap Update; the wheel sheet shows your last two weeks, and today’s bar grows as it turns.',
    good: [
      'No accidental edits: every change starts with a tap on Update',
      'The wheel, − / + and smart steps from B, “of 608” sets your page count',
      'C’s sparkline, pace and days to go on the card; figures, three weeks and the log on the book page',
      'The end comes with a summary of the read',
    ],
    trade: [
      'Every update is a sheet (by design)',
      'The chart needs a progress log per day (a new table and RPC)',
      'Denser card than today’s',
    ],
  },
] as const

const buzz = ref('')
onMounted(() => (buzz.value = { vibrate: 'This browser vibrates: haptics on.', 'ios-switch': 'iOS: taps tick, drags do not.', none: 'No haptics in this browser (try Android Chrome).' }[hapticsAvailable()]))
</script>

<template>
  <div class="mx-auto min-h-dvh w-full max-w-(--size-max-content) bar-top px-screen pb-xxl lg:max-w-none">
    <header class="flex flex-col gap-sm py-lg">
      <p class="eyebrow">Design round · #65</p>
      <h1 class="text-large-title">Update progress</h1>
      <p class="text-subhead text-ink-muted">
        Four directions, all on Home’s card and the book page, with a page count, without one, and an ebook with its own total.
        Stub data; nothing is saved. {{ buzz }}
      </p>
    </header>

    <div class="grid gap-lg lg:grid-cols-4">
      <section v-for="d in DIRECTIONS" :key="d.key" class="flex flex-col gap-md rounded-lg bg-surface-raised p-inset shadow-raised edge-faint" :data-testid="`proto.compare.${d.key}`">
        <div class="flex items-baseline gap-sm">
          <span class="figures text-title text-accent uppercase">{{ d.key }}</span>
          <h2 class="book-title text-book-title">{{ d.name }}</h2>
        </div>
        <p class="text-subhead text-ink-muted">{{ d.pitch }}</p>
        <div class="flex gap-sm">
          <UiButton size="sm" :to="`/prototype/progress/${d.key}`">Home</UiButton>
          <UiButton tone="secondary" size="sm" :to="`/prototype/progress/${d.key}?screen=book&book=eden`">Book page</UiButton>
          <UiButton tone="plain" size="sm" :to="`/prototype/progress/${d.key}?screen=book&book=leviathan`">Ebook</UiButton>
        </div>
        <iframe
          class="phone hidden lg:block"
          :src="`/prototype/progress/${d.key}`"
          :title="d.name"
          loading="lazy"
        />
        <div class="grid gap-md sm:grid-cols-2 lg:grid-cols-1">
          <div>
            <h3 class="eyebrow mb-sm">Does well</h3>
            <ul class="flex flex-col gap-xs text-caption">
              <li v-for="line in d.good" :key="line" class="flex gap-sm"><span class="text-accent">+</span>{{ line }}</li>
            </ul>
          </div>
          <div>
            <h3 class="eyebrow mb-sm">Trade-offs</h3>
            <ul class="flex flex-col gap-xs text-caption text-ink-muted">
              <li v-for="line in d.trade" :key="line" class="flex gap-sm"><span class="text-ink-faint">−</span>{{ line }}</li>
            </ul>
          </div>
        </div>
      </section>
    </div>

    <section class="mt-lg flex flex-col gap-sm rounded-lg bg-fill p-inset edge-faint">
      <h2 class="eyebrow">Recommendation</h2>
      <p class="text-subhead">
        <strong class="font-medium">D, Counter + chart</strong>: the owner’s pick after the first round (A is out: progress should only change
        behind a button). Build B’s sheet first; the chart, pace and log come with a per-day progress log in the database.
      </p>
    </section>
  </div>
</template>

<style scoped>
/* A phone, scaled to fit the column. */
.phone {
  width: 393px;
  height: 852px;
  margin-bottom: calc(852px * -0.25);
  border: 0;
  border-radius: var(--radius-sheet);
  box-shadow: var(--shadow-raised);
  transform: scale(0.75);
  transform-origin: top left;
}
</style>
