<script setup lang="ts">
// One Collection (D's collection): its Books in her order under the first
// cover's light, numbered like a reading list, each with a grip to drag it
// elsewhere (or arrow keys on the grip). Rename and delete live behind the
// more button in the top bar. A pushed screen in the tab layout.
import { useCollectionsStore } from '~/stores/collections'

definePageMeta({ layout: 'tabs', screen: 'collection', pushed: true })

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const collections = useCollectionsStore()
// Renaming, deleting and reordering work offline too: they wait to sync (#93).

const id = computed(() => String(route.params.id))
const page = computed(() => collections.page(id.value))
const collection = computed(() => page.value?.collection ?? null)
const entries = computed(() => collection.value?.entries ?? [])

watch(id, (value) => void collections.loadCollection(value), { immediate: true })

useHead({ title: () => (collection.value ? `${collection.value.name} · ${t('app.name')}` : t('app.name')) })

function back() {
  if (window.history.state?.back) router.back()
  else void navigateTo('/collections')
}

// ---------------------------------------------------------------- options

const optionsOpen = ref(false)
const confirmingDelete = ref(false)
const deleting = ref(false)
const deleteError = ref<string | null>(null)
watch(optionsOpen, (open) => {
  if (open) {
    confirmingDelete.value = false
    deleteError.value = null
  }
})

function rename() {
  optionsOpen.value = false
  collections.openRename(id.value)
}

async function confirmDelete() {
  if (deleting.value) return
  deleting.value = true
  deleteError.value = null
  const failed = await collections.remove(id.value)
  deleting.value = false
  if (failed) {
    deleteError.value = failed
    return
  }
  optionsOpen.value = false
  // Back to the list it was opened from; a Collection opened from a link puts the list in its place.
  if (window.history.state?.back === '/collections') router.back()
  else await router.replace('/collections')
}
</script>

<template>
  <div class="relative min-h-dvh">
    <UiAmbient :colors="entries[0]?.book.coverColors ?? null" />
    <UiTopBar :back-label="t('collection.back')" back-testid="collection.back" @back="back">
      <template v-if="collection && page?.phase !== 'missing'" #trailing>
        <UiRoundButton icon="more" :label="t('collection.more')" data-testid="collection.more" @click="optionsOpen = true" />
      </template>
    </UiTopBar>

    <template v-if="collection">
      <header class="relative px-screen pt-bar">
        <h1 class="book-title text-large-title text-balance" data-testid="collection.title">{{ collection.name }}</h1>
        <p class="mt-xs text-caption text-ink-muted" data-testid="collection.summary">
{{ t('collection.count', { count: entries.length }, entries.length) }}
          <template v-if="entries.length > 1"> · {{ t('collection.order') }}</template>
        </p>
      </header>

      <p v-if="collections.reorderError" class="relative mx-screen mt-ms text-caption text-error" role="alert" data-testid="collection.reorderError">
        {{ t('collection.reorderError') }}
      </p>

      <CollectionsEntryList v-if="entries.length" :collection-id="collection.id" :entries="entries" class="relative px-ms pt-ms" />

      <UiEmptyState
        v-else-if="page?.phase === 'ready'"
        screen="collection"
        :title="t('collection.emptyTitle')"
        :text="t('collection.empty')"
        class="relative pt-lg"
      >
        <UiSearchPrompt testid="collection.search" />
      </UiEmptyState>
    </template>

    <div v-else-if="page?.phase === 'missing' || page?.phase === 'error'" class="relative px-ml pt-xxl text-center" data-testid="collection.missing">
      <p class="book-title text-headline">{{ t(page.phase === 'error' ? 'collection.errorTitle' : 'collection.missingTitle') }}</p>
      <p class="mt-sm text-subhead text-ink-muted">{{ t(page.phase === 'error' ? 'collection.error' : 'collection.missing') }}</p>
      <div class="mt-lg flex justify-center">
        <UiButton v-if="page.phase === 'error'" tone="secondary" size="md" data-testid="collection.retry" @click="collections.loadCollection(id)">
          {{ t('collection.retry') }}
        </UiButton>
        <UiButton v-else tone="secondary" size="md" to="/collections" data-testid="collection.toCollections">
          {{ t('collection.toCollections') }}
        </UiButton>
      </div>
    </div>

    <UiSheet v-model:open="optionsOpen" :title="collection?.name ?? ''" testid="collectionOptions">
      <div class="pt-xs pb-sm">
        <template v-if="!confirmingDelete">
          <UiRowGroup>
            <UiRow
              as="button"
              icon="pencil"
              :label="t('collection.rename')"
              data-testid="collectionOptions.rename"
              @click="rename"
            />
            <UiRow
              as="button"
              icon="close"
              tone="danger"
              :label="t('collection.delete')"
              data-testid="collectionOptions.delete"
              @click="confirmingDelete = true"
            />
          </UiRowGroup>
        </template>
        <template v-else>
          <p class="px-xs text-subhead text-ink" data-testid="collectionOptions.confirmText">{{ t('collection.deleteConfirm', { name: collection?.name ?? '' }) }}</p>
          <p class="mt-xs px-xs text-caption text-ink-muted">{{ t('collection.deleteKeeps') }}</p>
          <p v-if="deleteError" class="mt-ms px-xs text-caption text-error" role="alert" data-testid="collectionOptions.error">
            {{ t(`collections.error.${deleteError}`) }}
          </p>
          <div class="mt-lg">
            <UiButton block tone="danger" :disabled="deleting" data-testid="collectionOptions.confirmDelete" @click="confirmDelete">
              {{ deleting ? t('collection.deleting') : t('collection.delete') }}
            </UiButton>
          </div>
        </template>
      </div>
    </UiSheet>

    <CollectionsNameSheet />
  </div>
</template>
