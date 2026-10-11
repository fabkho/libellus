<script setup lang="ts">
// The pick's result on the Book page (PROTOTYPE, #259): a light floating card above the tab bar,
// in the app's glass. Left, which pick this is; right, ONE row of small covers of the Books still
// in the running (so she remembers what else was in her range; a tap only lights one and says its
// title); under them the two answers: Not this one (the rest are dealt again) and Start reading
// (stores/pick.ts `accept`: the entry's Start reading, or the Add sheet on Currently reading for
// a Book from search). The last one left says so; none left is a quiet end with Choose again.
// The result is announced (`aria-live`) and takes the focus; Escape leaves the pick.
import { othersOf } from '~/data/pick'
import { usePickStore } from '~/stores/pick'
import { coverSrc } from '~/utils/cover'

const { t } = useI18n()
const pick = usePickStore()
const online = useOnline()
/** A sheet is open over the page (the Add sheet of an Accept): Escape is its own. */
const modal = useModalShown()

const round = computed(() => pick.round)
const others = computed(() => (round.value ? othersOf(round.value) : []))
const title = computed(() => pick.winner?.book.title ?? '')

/** The other Book tapped in the row: lit, its title said (nothing else in the prototype). */
const lit = ref<string | null>(null)
const litTitle = computed(() => others.value.find((c) => c.key === lit.value)?.book.title ?? null)
watch(round, () => (lit.value = null))

const heading = useTemplateRef<HTMLElement>('heading')
// The result takes the focus once its page is there (keyboard and screen readers start from it).
onMounted(() => setTimeout(() => heading.value?.focus({ preventScroll: true }), 400))

function decline() {
  pick.decline()
  // The last one left has no deal: its page, as it is.
  if (pick.phase === 'shown' && pick.pagePath) void navigateTo(pick.pagePath, { replace: true })
}

function chooseAgain() {
  pick.chooseAgain()
  void navigateTo('/pick')
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || modal.value) return
  pick.leave()
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <section
    class="pick-bar glass edge shadow-float fixed inset-x-0 z-30 rounded-lg px-md pt-ms pb-md"
    :aria-label="t('pick.title')"
    data-testid="pick.bar"
  >
    <template v-if="pick.phase === 'empty'">
      <h2 ref="heading" tabindex="-1" class="book-title text-callout outline-none" aria-live="polite" data-testid="pick.emptyTitle">{{ t('pick.emptyTitle') }}</h2>
      <p class="mt-xxs text-caption text-ink-muted">{{ t('pick.emptyText') }}</p>
      <div class="mt-ms flex gap-sm">
        <UiButton tone="secondary" size="md" class="flex-1" data-testid="pick.done" @click="pick.leave()">{{ t('pick.done') }}</UiButton>
        <UiButton size="md" class="flex-1" data-testid="pick.chooseAgain" @click="chooseAgain">{{ t('pick.chooseAgain') }}</UiButton>
      </div>
    </template>

    <template v-else-if="pick.phase === 'accepted'">
      <h2 ref="heading" tabindex="-1" class="book-title text-callout outline-none" aria-live="polite" data-testid="pick.accepted">
        {{ t('pick.accepted', { title }) }}
      </h2>
      <div class="mt-ms flex">
        <UiButton size="md" class="flex-1" data-testid="pick.done" @click="pick.leave()">{{ t('pick.done') }}</UiButton>
      </div>
    </template>

    <template v-else>
      <div class="flex items-center gap-sm">
        <div class="min-w-0 flex-1">
          <p class="eyebrow truncate text-ink-faint" data-testid="pick.round">
            {{ round?.alone ? t('pick.lastOne') : t('pick.round', { round: round?.number ?? 1, count: round?.candidates.length ?? 0 }, round?.candidates.length ?? 0) }}
          </p>
          <h2 ref="heading" tabindex="-1" class="truncate text-footnote text-ink outline-none" aria-live="polite" data-testid="pick.picked">
            <template v-if="litTitle">
              <span class="text-ink-muted">{{ t('pick.others') }}:</span> <span class="book-title">{{ litTitle }}</span>
            </template>
            <template v-else>{{ t('pick.picked', { title }) }}</template>
          </h2>
        </div>
        <!-- The others still in the running: one row of small covers, bottom right. -->
        <ul v-if="others.length" class="others flex shrink-0 items-center" :aria-label="t('pick.others')" data-testid="pick.others">
          <li v-for="candidate in others.slice(0, 6)" :key="candidate.key">
            <button
              type="button"
              class="other block rounded-cover-sm transition-transform duration-(--duration-quick) ease-standard"
              :class="lit === candidate.key && 'lit'"
              :aria-label="candidate.book.title"
              :aria-pressed="lit === candidate.key"
              data-testid="pick.other"
              @click="lit = lit === candidate.key ? null : candidate.key"
            >
              <UiCover
                decorative
                :title="candidate.book.title"
                :authors="candidate.book.authors"
                :src="coverSrc(candidate.book.coverUrl, 'xs')"
                :thumbhash="candidate.book.coverThumbhash"
                :colors="candidate.book.coverColors"
                size="xs"
                eager
              />
            </button>
          </li>
          <li v-if="others.length > 6" class="figures pl-xs text-meta text-ink-faint">+{{ others.length - 6 }}</li>
        </ul>
      </div>

      <p v-if="pick.acceptError" class="mt-xs text-caption text-error" role="alert" data-testid="pick.error">
        {{ t(`library.error.${pick.acceptError}`) }}
      </p>

      <div class="mt-ms flex gap-sm">
        <UiButton
          tone="secondary"
          size="md"
          class="flex-1"
          :disabled="pick.phase === 'accepting'"
          data-testid="pick.decline"
          @click="decline"
        >
          {{ t('pick.decline') }}
        </UiButton>
        <UiButton
          size="md"
          class="flex-1"
          :disabled="pick.phase === 'accepting'"
          :offline="!online && pick.winner?.kind === 'search'"
          :aria-busy="pick.phase === 'accepting'"
          data-testid="pick.accept"
          @click="pick.accept()"
        >
          <UiIcon name="arrow" :size="16" bold />{{ pick.phase === 'accepting' ? t('pick.accepting') : t('pick.accept') }}
        </UiButton>
      </div>
    </template>
  </section>
</template>

<style scoped>
/* Above the floating tab bar, the width of the content column less the screen's margins. */
.pick-bar {
  bottom: calc(var(--float-bottom) + var(--size-tab-bar) + var(--spacing-sm));
  max-width: calc(var(--size-max-content) - 2 * var(--spacing-screen));
  margin-inline: max(var(--spacing-screen), calc((100vw - var(--size-max-content)) / 2 + var(--spacing-screen)));
}

/* The row overlaps a little, like a hand of cards; a lit one rises out of it. */
.other {
  margin-left: calc(-1 * var(--spacing-sm));
  box-shadow: 0 0 0 var(--stroke-hairline) var(--color-surface);
}
li:first-child > .other {
  margin-left: 0;
}
.other.lit {
  transform: translateY(calc(-1 * var(--spacing-xs)));
  box-shadow: 0 0 0 var(--stroke-focus) var(--color-accent);
}

@media (prefers-reduced-motion: reduce) {
  .other {
    transition: none;
  }
}
</style>
