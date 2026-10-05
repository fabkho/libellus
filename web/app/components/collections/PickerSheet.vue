<script setup lang="ts">
// The collection picker: the Book it is about, then every Collection of the
// member's as a row — its first cover, its name, how many Books — with a lamp
// check on the ones the Book is on. A tap puts the Book on it or takes it off,
// at once (one call each). At the end, a new Collection: type a name and Create
// makes it with the Book on it. For a Book not in the Library yet, a line says
// that putting it on a Collection adds it to Want to read.
import { NAME_MAX } from '~/data/collections'
import { useCollectionsStore } from '~/stores/collections'

const { t } = useI18n()
const collections = useCollectionsStore()
// Putting a Book from the Library on a Collection, or taking it off, works
// offline too: it waits to sync (#93). A Book not in the Library yet, and a new
// Collection, need the connection: offline those rows stay, disabled, and say
// why (#15).
const online = useOnline()

const open = computed({
  get: () => collections.picking !== null,
  set: (value) => {
    if (!value) collections.closePicker()
  },
})

// Kept while the sheet slides away, so it does not empty mid-exit.
const picking = ref(collections.picking)
watch(
  () => collections.picking,
  (value) => {
    if (value) picking.value = value
  },
)

watch(open, (isOpen) => {
  if (isOpen) {
    newName.value = ''
    creating.value = false
  }
})

const newName = ref('')
const creating = ref(false)
const createBusy = ref(false)

async function create() {
  if (createBusy.value || !newName.value.trim()) return
  createBusy.value = true
  try {
    if (await collections.createAndPick(newName.value)) {
      newName.value = ''
      creating.value = false
    }
  } finally {
    createBusy.value = false
  }
}

const input = useTemplateRef<HTMLInputElement>('input')
// The field is focused in the tap's own task (the microtask after the render,
// not a timer), so iOS raises the keyboard instead of only lighting the row.
async function startCreating() {
  creating.value = true
  await nextTick()
  input.value?.focus({ preventScroll: true })
}
</script>

<template>
  <UiSheet v-model:open="open" :title="t('collections.pickerTitle')" testid="picker" :action="t('collections.done')" @action="open = false">
    <template v-if="picking">
      <UiBookLine
        :title="picking.book.title"
        :authors="picking.book.authors"
        :src="coverSrc(picking.book.coverUrl, 'xs')"
        :thumbhash="picking.book.coverThumbhash"
        :colors="picking.book.coverColors"
      />
      <p v-if="!picking.entry" class="mx-xs mb-ms text-caption text-ink-faint" data-testid="picker.addsToLibrary">
        {{ t('collections.addsToLibrary') }}
      </p>

      <UiRowGroup v-if="collections.list.length" role="group" :aria-label="t('collections.title')">
        <button
          v-for="collection in collections.list"
          :key="collection.id"
          type="button"
          role="checkbox"
          :aria-checked="collections.picked(collection.id)"
          :disabled="!collections.pickerReady || collections.pickerBusy.has(collection.id) || (!online && !picking?.entry)"
          class="option relative flex h-(--size-query) w-full items-center gap-ms px-inset text-left enabled:hover:bg-fill active:bg-fill-strong disabled:opacity-50"
          data-testid="picker.collection"
          @click="collections.toggle(collection.id)"
        >
          <UiCover
            v-if="collection.covers[0]"
            :title="collection.covers[0].title"
            :authors="collection.covers[0].authors"
            :src="coverSrc(collection.covers[0].coverUrl, 'xs')"
            :thumbhash="collection.covers[0].coverThumbhash"
            :colors="collection.covers[0].coverColors"
            size="xs"
          />
          <span v-else class="empty w-(--size-cover-xs) shrink-0 rounded-cover-sm" aria-hidden="true" />
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="truncate text-body text-ink" data-testid="picker.collectionName">{{ collection.name }}</span>
            <span class="text-footnote text-ink-faint">{{ t('collections.count', { count: collection.count }, collection.count) }}</span>
          </span>
          <span class="check flex size-(--size-star-lg) shrink-0 items-center justify-center rounded-pill" :class="collections.picked(collection.id) && 'on'" aria-hidden="true">
            <UiIcon v-if="collections.picked(collection.id)" name="check" :size="14" bold />
          </span>
        </button>
      </UiRowGroup>

      <UiRowGroup :class="collections.list.length && 'mt-ms'">
        <button
          v-if="!creating"
          type="button"
          class="flex h-(--size-row) w-full items-center gap-ms px-inset text-left text-body text-ink-muted enabled:hover:bg-fill active:bg-fill-strong disabled:opacity-50"
          :disabled="!online"
          data-testid="picker.new"
          @click="startCreating"
        >
          <UiIcon :name="online ? 'plus' : 'offline'" :size="18" class="text-ink-faint" />{{ online ? t('collections.new') : t('common.offline') }}
        </button>
        <form v-else class="flex h-(--size-row) items-center gap-ms pl-inset pr-xs focus-within:bg-accent-soft" novalidate @submit.prevent="create">
          <input
            ref="input"
            v-model="newName"
            type="text"
            :maxlength="NAME_MAX"
            autocapitalize="sentences"
            autocomplete="off"
            enterkeyhint="done"
            :placeholder="t('collections.namePlaceholder')"
            :aria-label="t('collections.nameLabel')"
            class="min-w-0 flex-1 bg-transparent text-body text-ink caret-accent outline-none placeholder:text-ink-ghost"
            data-testid="picker.newName"
          />
          <UiButton type="submit" size="sm" :disabled="createBusy || !newName.trim()" :offline="!online" data-testid="picker.create">
            {{ t('collections.create') }}
          </UiButton>
        </form>
      </UiRowGroup>

      <p v-if="collections.pickerError" class="mt-ms px-xs text-caption text-error" role="alert" data-testid="picker.error">
        {{ t(`collections.error.${collections.pickerError}`) }}
      </p>
      <div class="h-(--spacing-lg)" />
    </template>
  </UiSheet>
</template>

<style scoped>
.option + .option::before {
  position: absolute;
  top: 0;
  right: 0;
  left: calc(var(--spacing-inset) + var(--size-cover-xs) + var(--spacing-ms));
  height: var(--stroke-hairline);
  content: '';
  background: var(--color-hairline-strong);
}

.empty {
  aspect-ratio: 2 / 3;
  box-shadow: inset 0 0 0 var(--stroke-hairline) var(--color-hairline-strong);
}

/* D's check: a hairline ring; on, a lamp-lit disc with the tick in it. */
.check {
  box-shadow: inset 0 0 0 var(--stroke-rule) var(--color-ink-faint);
  color: var(--color-on-ink);
  transition:
    background-color var(--duration-quick) var(--ease-standard),
    box-shadow var(--duration-quick) var(--ease-standard);
}

.check.on {
  background: var(--color-accent);
  box-shadow: 0 0 var(--spacing-ms) var(--color-accent-soft);
}
</style>
