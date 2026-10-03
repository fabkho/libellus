<script setup lang="ts">
// Collections (D's collections), reached from the Library tab: every
// Collection as a small lit mosaic of its first covers, its name and how many
// Books are on it, in her order; "New collection" at the end and in the top
// bar. A pushed screen in the tab layout, so the Library stays alive under it.
import { useCollectionsStore } from '~/stores/collections'

definePageMeta({ layout: 'tabs', screen: 'collections', pushed: true })

const { t } = useI18n()
const router = useRouter()
const collections = useCollectionsStore()
// Making a Collection writes: offline both ways to it say so instead (#15).
const online = useOnline()

useHead({ title: () => `${t('collections.title')} · ${t('app.name')}` })

onMounted(() => void collections.loadList())

// Collections belong to the Library tab: back always leads there, by history when it came from it.
function back() {
  if (window.history.state?.back === '/library') router.back()
  else void navigateTo('/library')
}
</script>

<template>
  <div class="relative min-h-dvh">
    <UiTopBar :back-label="t('collections.back')" back-testid="collections.back" @back="back">
      <template #trailing>
        <UiRoundButton
          :icon="online ? 'plus' : 'offline'"
          :label="online ? t('collections.new') : t('common.offline')"
          :disabled="!online"
          class="disabled:opacity-50"
          data-testid="collections.newTop"
          @click="collections.openCreate()"
        />
      </template>
    </UiTopBar>

    <header class="px-screen pt-sm">
      <h1 class="text-large-title" data-testid="collections.title">{{ t('collections.title') }}</h1>
      <p class="mt-xs text-subhead text-ink-muted">{{ t('collections.intro') }}</p>
    </header>

    <div v-if="collections.loaded && collections.list.length" class="px-screen pt-ms" data-testid="collections.list">
      <NuxtLink
        v-for="(collection, index) in collections.list"
        :key="collection.id"
        :to="`/collections/${collection.id}`"
        class="item flex items-center gap-ml py-ms active:opacity-70"
        data-testid="collections.item"
      >
        <CollectionsMosaic :covers="collection.covers" :eager="index < 4" />
        <span class="flex min-w-0 flex-1 flex-col gap-xs">
          <span class="book-title truncate text-callout" data-testid="collections.itemName">{{ collection.name }}</span>
          <span class="text-caption text-ink-muted" data-testid="collections.itemCount">{{
            t('collections.count', { count: collection.count }, collection.count)
          }}</span>
        </span>
        <UiIcon name="chevron" :size="16" class="text-ink-ghost" />
      </NuxtLink>

      <button
        type="button"
        class="item flex w-full items-center gap-ml py-ms text-left text-ink-muted disabled:opacity-50"
        :disabled="!online"
        data-testid="collections.new"
        @click="collections.openCreate()"
      >
        <span class="new flex shrink-0 items-center justify-center rounded-md text-ink-faint"><UiIcon :name="online ? 'plus' : 'offline'" :size="22" /></span>
        <span class="text-body">{{ online ? t('collections.new') : t('common.offline') }}</span>
      </button>
    </div>

    <UiEmptyState
      v-else-if="collections.loaded"
      screen="collections"
      :title="t('collections.emptyTitle')"
      :text="t('collections.empty')"
      class="pt-lg"
    >
      <UiButton block :offline="!online" data-testid="collections.new" @click="collections.openCreate()">
        <UiIcon name="plus" :size="18" bold />{{ t('collections.new') }}
      </UiButton>
    </UiEmptyState>

    <div v-else-if="collections.loadError" class="px-lg pt-xxl text-center" data-testid="collections.loadError">
      <p class="text-subhead text-ink-muted">{{ t('collections.loadError') }}</p>
      <UiButton tone="secondary" size="md" class="mt-md" data-testid="collections.retry" @click="collections.loadList()">
        {{ t('collections.retry') }}
      </UiButton>
    </div>

    <CollectionsNameSheet />
  </div>
</template>

<style scoped>
.item + .item {
  border-top: var(--stroke-hairline) solid var(--color-hairline);
}

/* The size of a mosaic, dashed: a shelf still to be made. */
.new {
  width: calc(2 * var(--size-cover-sm) + 3 * var(--spacing-xs));
  height: calc(var(--size-cover-sm) * 1.5 + 2 * var(--spacing-xs));
  border: var(--stroke-rule) dashed var(--color-hairline-strong);
}
</style>
