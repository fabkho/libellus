<script setup lang="ts">
// The sync sheet (#93): what is waiting to sync and what could not be. The
// writes still waiting, oldest first, each by what it did and the Book (or
// Collection) it is about; they go by themselves once there is a connection.
// Below, the writes the database refused (another device changed the Book
// first, say): each says what could not be saved and why, in the words of the
// action's own error, and is dismissed with its ✕ once read. The Library
// already shows what the database has instead.
import { useSyncStore } from '~/stores/sync'

const { t } = useI18n()
const sync = useSyncStore()
const online = useOnline()

const open = computed({
  get: () => sync.sheetOpen,
  set: (value) => (sync.sheetOpen = value),
})

const waitingText = computed(() =>
  online.value && sync.syncing
    ? t('sync.syncing', { count: sync.pending }, sync.pending)
    : t('sync.waiting', { count: sync.pending }, sync.pending),
)

function reason(failure: { domain: 'library' | 'collections'; code: string }): string {
  return t(`${failure.domain === 'collections' ? 'collections' : 'library'}.error.${failure.code}`)
}
</script>

<template>
  <UiSheet v-model:open="open" :title="t('sync.title')" testid="sync">
    <div class="pt-xs pb-lg">
      <template v-if="sync.pending">
        <p class="px-xs text-subhead text-ink-muted" data-testid="sync.waiting">{{ waitingText }}</p>
        <h3 class="eyebrow mt-ml mb-sm px-xs">{{ t('sync.pendingTitle') }}</h3>
        <UiRowGroup>
          <UiRow v-for="item in sync.items" :key="item.id" icon="sync" :label="t(`sync.action.${item.action}`)" data-testid="sync.item">
            <span class="book-title truncate text-ink" data-testid="sync.itemAbout">{{ item.about }}</span>
          </UiRow>
        </UiRowGroup>
      </template>

      <template v-if="sync.failures.length">
        <h3 class="eyebrow mb-xs px-xs" :class="sync.pending ? 'mt-ml' : ''">{{ t('sync.failedTitle') }}</h3>
        <p class="mb-sm px-xs text-caption text-ink-faint">{{ t('sync.failedNote') }}</p>
        <UiRowGroup>
          <div
            v-for="failure in sync.failures"
            :key="failure.id"
            class="failure relative flex items-center gap-ms py-ms pl-inset pr-xs"
            data-testid="sync.failure"
          >
            <span class="flex min-w-0 flex-1 flex-col gap-xxs">
              <span class="book-title truncate text-body text-ink" data-testid="sync.failureAbout">{{ failure.about }}</span>
              <span class="text-caption text-error" data-testid="sync.failureText">{{ t('sync.failedItem', { action: t(`sync.action.${failure.action}`) }) }}</span>
              <span class="text-caption text-ink-muted" data-testid="sync.failureReason">{{ reason(failure) }}</span>
            </span>
            <button
              type="button"
              class="flex size-(--size-touch) shrink-0 items-center justify-center rounded-pill text-ink-faint hover:bg-fill active:bg-fill-strong"
              :aria-label="t('sync.dismissLabel', { about: failure.about })"
              data-testid="sync.dismiss"
              @click="sync.dismiss(failure.id)"
            >
              <UiIcon name="close" :size="18" />
            </button>
          </div>
        </UiRowGroup>
      </template>

      <p v-if="!sync.pending && !sync.failures.length" class="px-xs text-subhead text-ink-muted" data-testid="sync.allSynced">
        {{ t('sync.allSynced') }}
      </p>
    </div>
  </UiSheet>
</template>

<style scoped>
.failure + .failure::before {
  position: absolute;
  top: 0;
  right: 0;
  left: var(--spacing-inset);
  height: var(--stroke-hairline);
  content: '';
  background: var(--color-hairline-strong);
}
</style>
