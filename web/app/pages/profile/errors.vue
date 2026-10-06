<script setup lang="ts">
// The client error log, for the instance's owner (docs/OPERATIONS.md, Client
// errors): the last 7 days' errors grouped by kind and message, newest first.
// Reached from the Profile's Account section (its Errors row); only the owner's
// account has it (stores/ownerErrors.ts), and for anyone else the address is a
// page that doesn't exist (`validate`, the same 404 as any unknown address) and
// nothing is asked of the server, which refuses them as well (`not_owner`).
//
// A pushed screen in the tab layout, built like Ebooks: the round back and a
// Refresh button in the bar, the large title, the kind filter (All first, then
// the kinds there are, lit like the Profile's year pills), then one row a
// group: a chip with its kind, ×times, the message, and a mono line of when
// (relative), which build and which route. A group first seen in the last day
// says New. A tap opens its latest stack in a sheet (components/errors/
// DetailSheet.vue). Nothing logged: D's empty state. The list cannot be loaded:
// why, and Try again (a load that fails keeps the groups on screen).
import { kindsOf, ofKind, type OwnerErrorGroup, type OwnerErrorKind } from '~/data/ownerErrors'
import { isShelfOwner } from '~/utils/shelfOwner'
import { relativeTime } from '~/utils/relativeTime'
import { useOwnerErrorsStore } from '~/stores/ownerErrors'
import { useSessionStore } from '~/stores/session'

definePageMeta({
  layout: 'tabs',
  screen: 'errors',
  pushed: true,
  // Runs in the app's entry, before this page's chunk loads: the session and the config only.
  validate: () => isShelfOwner(useSessionStore().member?.id, useRuntimeConfig().public.shelfOwnerId),
})

const { t, locale } = useI18n()
const router = useRouter()
const errors = useOwnerErrorsStore()
const online = useOnline()
const { count } = useFigures()

useHead({ title: () => `${t('ownerErrors.title')} · ${t('app.name')}` })

function back() {
  if (window.history.state?.back) router.back()
  else void navigateTo('/profile')
}

onMounted(() => void errors.load())
// Back online with nothing to show: load without a tap.
watch(online, (now) => now && errors.loadError === 'offline' && void errors.load())

const groups = computed(() => errors.groups ?? [])
const kinds = computed(() => kindsOf(groups.value))
const kind = ref<OwnerErrorKind | 'all'>('all')
// A refresh that no longer has the kind in view goes back to All.
watch(kinds, (now) => {
  if (kind.value !== 'all' && !now.some((entry) => entry.kind === kind.value)) kind.value = 'all'
})
const shown = computed(() => ofKind(groups.value, kind.value))

const empty = computed(() => errors.groups !== null && !groups.value.length)
const failed = computed(() => errors.loadError !== null && errors.groups === null)

const ago = (group: OwnerErrorGroup) => relativeTime(group.lastSeen, errors.now, locale.value)
const isNew = (group: OwnerErrorGroup) => errors.now - group.firstSeen.getTime() < 24 * 60 * 60 * 1000
/** "3 minutes ago · b4f2c1 · /library" */
const meta = (group: OwnerErrorGroup) => [ago(group), group.versions[0], group.routes[0]].filter(Boolean).join(' · ')

const opening = ref<OwnerErrorGroup | null>(null)
const detailOpen = ref(false)
function open(group: OwnerErrorGroup) {
  opening.value = group
  detailOpen.value = true
}
</script>

<template>
  <div class="relative min-h-dvh pb-xl">
    <UiTopBar :back-label="t('ownerErrors.back')" back-testid="errors.back" @back="back">
      <template #trailing>
        <UiRoundButton
          icon="repeat"
          :label="errors.loading ? t('ownerErrors.refreshing') : t('ownerErrors.refresh')"
          :disabled="errors.loading || !online"
          :class="errors.loading && 'spinning'"
          data-testid="errors.refresh"
          @click="errors.load()"
        />
      </template>
    </UiTopBar>

    <header class="px-screen pt-bar">
      <h1 class="text-large-title" data-testid="errors.title">{{ t('ownerErrors.title') }}</h1>
      <p class="mt-xs text-subhead text-ink-muted">{{ t('ownerErrors.intro') }}</p>
    </header>

    <div class="flex flex-col gap-lg px-screen pt-lg">
      <!-- The kinds there are; nothing to filter with one. -->
      <div
        v-if="kinds.length > 1"
        role="group"
        :aria-label="t('ownerErrors.filterLabel')"
        class="kinds scrollbar-none relative -mx-screen flex gap-sm overflow-x-auto px-screen"
        data-testid="errors.kinds"
      >
        <button
          v-for="entry in [{ kind: 'all' as const, groups: groups.length }, ...kinds]"
          :key="entry.kind"
          type="button"
          :aria-pressed="kind === entry.kind"
          class="pill figures relative inline-flex h-(--size-button-sm) shrink-0 items-center gap-xs rounded-pill px-md text-caption"
          :class="kind === entry.kind ? 'bg-ink text-on-ink' : 'edge text-ink-muted hover:bg-fill'"
          :data-testid="`errors.kind.${entry.kind}`"
          @click="kind = entry.kind"
        >
          {{ entry.kind === 'all' ? t('ownerErrors.all') : t(`ownerErrors.kind.${entry.kind}`) }}
          <span class="opacity-60">{{ entry.groups }}</span>
        </button>
      </div>

      <ul v-if="shown.length" class="flex flex-col divide-y divide-hairline" data-testid="errors.list">
        <li v-for="group in shown" :key="group.hash">
          <button
            type="button"
            class="row flex min-h-(--size-touch) w-full flex-col items-stretch gap-xs py-md text-left"
            data-testid="errors.group"
            @click="open(group)"
          >
            <span class="flex items-center gap-sm">
              <span class="chip eyebrow rounded-pill bg-fill-strong px-sm py-xxs" data-testid="errors.groupKind">{{ t(`ownerErrors.kind.${group.kind}`) }}</span>
              <span v-if="isNew(group)" class="eyebrow text-accent" data-testid="errors.groupNew">{{ t('ownerErrors.new') }}</span>
              <span class="figures ml-auto text-body text-ink" data-testid="errors.groupTimes">{{ t('ownerErrors.times', { count: count(group.times) }) }}</span>
              <UiIcon name="chevron" :size="15" bold class="-mr-xs text-ink-ghost" />
            </span>
            <span class="line-clamp-3 wrap-anywhere text-body text-ink" data-testid="errors.groupMessage">{{ group.message }}</span>
            <span class="figures truncate text-meta text-ink-faint" data-testid="errors.groupMeta">{{ meta(group) }}</span>
          </button>
        </li>
      </ul>

      <UiEmptyState v-else-if="empty" screen="errors" :title="t('ownerErrors.empty.title')" :text="t('ownerErrors.empty.text')" compact />

      <div v-else-if="failed" class="flex flex-col items-start gap-md" role="alert" data-testid="errors.loadFailed">
        <p class="text-subhead text-ink-muted">{{ t('ownerErrors.loadError') }}</p>
        <UiButton tone="secondary" size="md" :offline="!online" data-testid="errors.retry" @click="errors.load()">{{ t('ownerErrors.retry') }}</UiButton>
      </div>
    </div>

    <ErrorsDetailSheet v-model:open="detailOpen" :group="opening" />
  </div>
</template>

<style scoped>
.kinds {
  overscroll-behavior-x: contain;
  /* Room above and below for the pills' 44 pt touch targets, inside the scroller. */
  padding-block: calc((var(--size-touch) - var(--size-button-sm)) / 2);
  margin-block: calc((var(--size-button-sm) - var(--size-touch)) / 2);
}
/* The drawn pill is 32 px; the touch target stays 44. */
.pill::after {
  position: absolute;
  inset: 50% 0 auto;
  height: var(--size-touch);
  content: '';
  transform: translateY(-50%);
}
.row:active {
  background: var(--color-fill);
}
.spinning :deep(svg) {
  animation: spin 900ms linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .spinning :deep(svg) {
    animation: none;
  }
}
</style>
