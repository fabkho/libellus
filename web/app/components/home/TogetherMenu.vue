<script setup lang="ts">
// The small menu of one Currently reading card on Home (docs/parity.md, *Buddy read, Reading together on Home*), opened by the card's "...": **Read together**, which opens the
// setup sheet (W3) for the card's Library entry, or, when she is already in an active read of that Book, **Open the buddy read**, which goes into its
// room. The app's small-menu pattern, a plain `UiSheet` with a group of rows (as Next in your series). Home builds it (a chunk of its own, with the setup
// sheet and the big store) when a "..." is first pressed. The setup sheet is this component's second sheet: the menu closes as it opens.
//
// Props: `entry` (the card's Library entry, null before the first press). v-model:open. Test ids: `homeTogetherMenu` (+ `.start`, `.open`), the sheet's own `buddySetup`.
import type { LibraryEntry } from '~/data/library'
import { useBuddyInvitesStore } from '~/stores/buddyInvites'
import { readOfBook } from '~/utils/buddyEntry'
import { roomPath } from '~/utils/buddyRoute'

const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{ entry: LibraryEntry | null }>()

const { t } = useI18n()
const invites = useBuddyInvitesStore()

/** Kept while the sheet slides away, so its title does not empty mid-exit. */
const shown = ref<LibraryEntry | null>(props.entry)
watch(
  () => props.entry,
  (value) => {
    if (value) shown.value = value
  },
)

const read = computed(() => readOfBook(invites.reads, shown.value?.book.id))
const setupOpen = ref(false)

// Built open (the page builds this chunk when a "..." is pressed): the sheet is shown one tick after mounting, so it rises, takes focus and listens
// for Escape as it does when it is opened later (UiSheet reacts to a change of `open`, not to its first value).
const ready = ref(false)
onMounted(() => void nextTick(() => (ready.value = true)))

function start() {
  open.value = false
  setupOpen.value = true
}
</script>

<template>
  <UiSheet :open="ready && open" :title="shown?.book.title ?? ''" testid="homeTogetherMenu" @update:open="open = $event">
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
