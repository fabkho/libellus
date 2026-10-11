<script setup lang="ts">
// Read as (issue #169): how the member read this Book, physical, ebook or audiobook. One row of
// three icon segments (UiIconSegments, as the edition's format row), in the Book's options sheet
// and in the Finish sheet (which passes `model` instead of `entry`: its choice is sent with the
// finish); not on the Book page, which keeps to its one action. It is hers, not
// the edition's: where she has not said, the edition's format is lit as the default
// (`readAsOf`), and tapping the lit segment of her own word takes it back. Setting it needs the
// connection (the segments are disabled and say Offline otherwise).
import { readAsOf, READ_AS, type ReadAs } from '~/data/readAs'
import type { LibraryEntry } from '~/data/library'
import type { IconSegment } from '~/components/ui/IconSegments.vue'
import { useLibraryStore } from '~/stores/library'

const props = defineProps<{ entry: LibraryEntry; testid: string }>()
/** The choice sent with an action elsewhere (the Finish sheet) instead of saved here. */
const model = defineModel<ReadAs | null>({ default: undefined })

const { t } = useI18n()
const library = useLibraryStore()
const online = useOnline()

const own = computed(() => (model.value !== undefined ? model.value : props.entry.readAs ?? null))
const shown = computed(() => own.value ?? readAsOf({ ...props.entry, readAs: null }))
const busy = ref(false)
const error = ref<string | null>(null)
const groupId = useId()

/** Paper is drawn as a book, an ebook as a reader, an audiobook as headphones (the edition format's icons). */
const ICONS = { physical: 'paperback', ebook: 'tablet', audiobook: 'audiobook' } as const
const options = computed<IconSegment<ReadAs>[]>(() => READ_AS.map((value) => ({ value, label: t(`readAs.${value}`), icon: ICONS[value] })))

async function choose(value: ReadAs) {
  if (busy.value) return
  // Her own word again takes it back (the edition's default lights again); the lit default is
  // tapped to make it hers.
  const next = own.value === value ? null : value
  error.value = null
  if (model.value !== undefined) {
    model.value = next
    return
  }
  busy.value = true
  try {
    const result = await library.setReadAs(props.entry, next)
    if ('error' in result) error.value = result.error
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="flex flex-col items-center gap-xs">
    <span :id="groupId" class="eyebrow text-ink-faint">{{ t('readAs.label') }}</span>
    <UiIconSegments
      class="w-full"
      :options="options"
      :value="shown"
      :labelledby="groupId"
      :disabled="(model === undefined && !online) || busy"
      :testid="testid"
      @choose="choose"
    />
    <p v-if="model === undefined && !online" class="text-footnote text-ink-faint" :data-testid="`${testid}.offline`">{{ t('readAs.offline') }}</p>
    <p v-if="error" class="text-footnote text-error" role="status" :data-testid="`${testid}.error`">{{ t(`library.error.${error}`) }}</p>
  </div>
</template>
