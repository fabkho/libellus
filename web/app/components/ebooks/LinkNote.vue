<script setup lang="ts">
// The note after Find book linked a file (#131): "Linked to Men at Arms", the
// title opening its book page, and Undo (the file waits again as it did) for
// LINK_UNDO_MS. After a replace there is nothing to go back to (the old copy
// is gone), so it has no Undo. Floats above the tab bar, a polite status.
import { useEbooksStore } from '~/stores/ebooks'

const { t } = useI18n()
const ebooks = useEbooksStore()
// Kept while it fades away.
const shown = shallowRef(ebooks.linkUndo)
watch(
  () => ebooks.linkUndo,
  (note) => {
    if (note) shown.value = note
  },
)
</script>

<template>
  <div class="note-place pointer-events-none fixed inset-x-ms z-30 mx-auto flex max-w-(--size-max-content) justify-center" role="status">
    <Transition name="note">
      <div
        v-if="ebooks.linkUndo && shown"
        class="pointer-events-auto flex min-h-(--size-button) max-w-full items-center gap-sm rounded-pill bg-surface-raised py-xs pr-xs pl-md text-subhead shadow-raised edge"
        data-testid="ebooks.linkNote"
      >
        <UiIcon name="ebook" :size="15" class="shrink-0 text-ink-faint" />
        <NuxtLink :to="`/book/${shown.bookId}`" class="min-w-0 truncate text-ink" data-testid="ebooks.linkNoteBook">
          {{ t('ebooks.linkedNote', { title: shown.title }) }}
        </NuxtLink>
        <UiButton v-if="shown.before" tone="plain" size="sm" data-testid="ebooks.linkUndo" @click="ebooks.undoLink()">{{ t('ebooks.undo') }}</UiButton>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* Above the tab bar, where it floats (or would). */
.note-place {
  bottom: calc(var(--float-bottom) + var(--size-tab-bar) + var(--spacing-sm));
}

.note-enter-active {
  transition:
    opacity var(--duration-standard) var(--ease-standard),
    translate var(--duration-standard) var(--ease-standard);
}
.note-leave-active {
  transition: opacity var(--duration-exit) var(--ease-exit);
}
.note-enter-from {
  opacity: 0;
  translate: 0 var(--spacing-sm);
}
.note-leave-to {
  opacity: 0;
}
</style>
