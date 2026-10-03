<script setup lang="ts">
// The Add to Library sheet (D's add-sheet), opened from a search result's +
// or a book page's Add. The Book it is about, then the Status to add it with
// and the dates that Status needs below the choice (AddStatusFields.vue; issue
// #9: Want to read, Currently reading, or a past read as Finished with its
// Rating and review). As in D, the one action is the button at the bottom; an
// error stays in the sheet, and the button tries again.
import { useLibraryStore } from '~/stores/library'

const { t } = useI18n()
const library = useLibraryStore()
// Adding, starting, finishing writes: offline the action says so instead (#15).
const online = useOnline()

const open = computed({
  get: () => library.adding !== null,
  set: (value) => {
    if (!value) library.closeAdd()
  },
})

// Kept while the sheet slides away, so it does not empty mid-exit.
const book = ref(library.adding)
watch(
  () => library.adding,
  (value) => {
    if (value) book.value = value
  },
)

async function add() {
  await library.confirmAdd()
}
</script>

<template>
  <UiSheet v-model:open="open" :title="t('add.title')" testid="add">
    <template v-if="book">
      <UiBookLine
        :title="book.title"
        :authors="book.authors"
        :src="coverSrc(book.coverUrl, 'xs')"
        :thumbhash="book.coverThumbhash"
        :colors="book.coverColors"
      />

      <BookAddStatusFields v-model="library.addDraft" testid="add" :error="library.addError" :busy="library.addBusy" />

      <p v-if="library.addError" class="mt-ms px-xs text-caption text-error" role="alert" data-testid="add.error">
        {{ t(`library.error.${library.addError}`) }}
      </p>

      <div class="mt-lg mb-sm">
        <UiButton block :disabled="library.addBusy" :offline="!online" data-testid="add.submit" @click="add">
          <UiIcon name="plus" :size="18" bold />{{ library.addBusy ? t('add.busy') : t('add.action') }}
        </UiButton>
      </div>
    </template>
  </UiSheet>
</template>
