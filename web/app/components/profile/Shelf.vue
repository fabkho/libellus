<script setup lang="ts">
// Your shelf on the Profile (#23): the owner's, and only hers (the Profile
// renders it for the owner alone, stores/shelf.ts). Like the Profile's other
// sections: "Your shelf" with how many Books stand on it, and under it a card
// with the newest of them as Regal's row (ShelfRowCard), up to SHELF_ROW_LIMIT.
// A Book tapped there breaks out to the whole screen. With more Books than the
// row holds, Show all opens the whole shelf, the full-screen Stack
// (/profile/shelf); below that the row is all of it, and nothing links there.
// Before the library file has come the section is there without its count, and
// the card its plain surface (the row appears with its intro, nothing loading
// shows: the shell has warmed it, useShelfPreload); when it can't be read, the
// card says why and tries again (offline: once the connection is back, stores/shelf.ts).
import { useShelfStore } from '~/stores/shelf'

const { t } = useI18n()
const { count } = useFigures()
const shelf = useShelfStore()

const books = computed(() => shelf.shelf?.books ?? [])
const more = computed(() => books.value.length > SHELF_ROW_LIMIT)
</script>

<template>
  <section id="shelf" :aria-label="t('shelf.card.title')" class="flex flex-col gap-md" data-testid="profile.shelf">
    <div class="flex h-(--size-button-sm) items-center justify-between gap-md">
      <h2 class="eyebrow">
        {{ t('shelf.card.title') }}
        <span v-if="shelf.shelf" class="figures ml-xs text-ink-ghost" data-testid="profile.shelfCount">{{ count(books.length) }}</span>
      </h2>
      <UiButton v-if="more" tone="quiet" size="sm" to="/profile/shelf" :aria-label="t('shelf.card.allLabel', { count: count(books.length) }, books.length)" data-testid="profile.shelfAll">
        {{ t('shelf.card.all') }}<UiIcon name="chevron" :size="13" />
      </UiButton>
    </div>
    <div
      v-if="shelf.loadError && !shelf.shelf"
      class="flex flex-col items-center justify-center gap-md rounded-lg bg-surface-raised px-xl py-xxl text-center shadow-raised edge-faint"
      data-testid="profile.shelfError"
    >
      <p class="text-subhead text-ink-muted">{{ shelf.loadError === 'offline' ? t('shelf.offline') : t('shelf.loadError') }}</p>
      <UiButton v-if="shelf.loadError !== 'offline'" tone="secondary" size="md" :disabled="shelf.loading" data-testid="profile.shelfRetry" @click="shelf.load()">
        {{ t('shelf.retry') }}
      </UiButton>
    </div>
    <ShelfRowCard v-else :limit="SHELF_ROW_LIMIT" :label="t('shelf.card.rowLabel')" data-testid="profile.shelfRow" />
  </section>
</template>
