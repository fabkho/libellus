<script setup lang="ts">
// The small menu of one Currently reading card on Home (docs/plans/buddy-read-shared.md W5), opened by the card's "...": **Read together**, which opens the
// setup sheet (W3) for the card's Library entry, or, when she is already in an active read of that Book, **Open the buddy read**, which goes into its
// room. The app's small-menu pattern, a plain `UiSheet` with a group of rows (as Next in your series). Home renders it only with buddy reads on (the
// build's flag and her switch) and the card draws the "..." only then, so with them off neither exists. The setup sheet is this component's second
// sheet: the menu closes as it opens.
//
// Props: `entry` (the card's Library entry, null before the first press). v-model:open. Test ids: `homeTogetherMenu` (+ `.start`, `.open`), the sheet's own `buddySetup`.
import type { LibraryEntry } from '~/data/library'
import { useBuddyReadStore } from '~/stores/buddyRead'
import { readOfBook } from '~/utils/buddyEntry'
import { roomPath } from '~/utils/buddyRoute'

const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{ entry: LibraryEntry | null }>()

const { t } = useI18n()
const store = useBuddyReadStore()

/** Kept while the sheet slides away, so its title does not empty mid-exit. */
const shown = ref<LibraryEntry | null>(props.entry)
watch(
  () => props.entry,
  (value) => {
    if (value) shown.value = value
  },
)

const read = computed(() => readOfBook(store.mine?.reads, shown.value?.book.id))
const setupOpen = ref(false)

function start() {
  open.value = false
  setupOpen.value = true
}
</script>

<template>
  <UiSheet v-model:open="open" :title="shown?.book.title ?? ''" testid="homeTogetherMenu">
    <div class="pt-xs pb-sm">
      <UiRowGroup>
        <UiRow v-if="read" :to="roomPath(read.id)" icon="chat" :label="t('together.entry.openRoom')" chevron data-testid="homeTogetherMenu.open" @click="open = false" />
        <UiRow v-else as="button" icon="chat" :label="t('together.entry.start')" aria-haspopup="dialog" data-testid="homeTogetherMenu.start" @click="start" />
      </UiRowGroup>
      <p v-if="!read" class="mt-ms px-xs text-caption text-ink-faint">{{ t('together.entry.hint') }}</p>
    </div>
  </UiSheet>
  <TogetherSetupSheet v-model:open="setupOpen" :entry="shown" />
</template>
