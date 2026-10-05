<script setup lang="ts">
// The quiet sign in the header's controls row, opposite the avatar, that changes
// made on this device have not reached the database yet (#93): "Waiting to sync
// (3)" while writes wait, "Couldn't sync (1)" once only refusals are left to
// read. Nothing at all when everything has synced: the Library never claims a
// change is saved before it is. A tap opens the sync sheet with the list.
import { useSyncStore } from '~/stores/sync'

const { t } = useI18n()
const sync = useSyncStore()

const failed = computed(() => sync.failures.length)
const label = computed(() =>
  sync.pending ? t('sync.chip', { count: sync.pending }) : t('sync.chipFailed', { count: failed.value }),
)
</script>

<template>
  <div class="flex min-w-0 flex-1">
    <Transition name="chip">
      <button
        v-if="sync.pending || failed"
        type="button"
        class="-ml-xs flex h-(--size-touch) min-w-0 items-center px-xs"
        :aria-label="sync.pending ? t('sync.chipLabel', { count: sync.pending }) : label"
        data-testid="shell.sync"
        @click="sync.sheetOpen = true"
      >
        <span class="chip inline-flex h-(--size-button-sm) min-w-0 items-center gap-xs rounded-pill bg-fill px-ms text-caption edge" :class="sync.pending ? 'text-ink-muted' : 'text-error'">
          <UiIcon name="sync" :size="14" :class="sync.pending ? 'text-ink-faint' : ''" />
          <span class="truncate whitespace-nowrap" data-testid="shell.syncLabel">{{ label }}</span>
        </span>
      </button>
    </Transition>
    <ShellSyncSheet />
  </div>
</template>

<style scoped>
.chip-enter-active {
  transition: opacity var(--duration-standard) var(--ease-standard);
}
.chip-leave-active {
  transition: opacity var(--duration-exit) var(--ease-exit);
}
.chip-enter-from,
.chip-leave-to {
  opacity: 0;
}
</style>
