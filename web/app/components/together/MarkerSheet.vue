<script setup lang="ts">
// "Where are you?" (docs/plans/buddy-read-shared.md part 5.2, 5.3, 5.5): the Section the others see her in. "Automatic" follows her
// reading (the Book's progress in her Library); a choice below it is her own say, the hand, for a Book she reads on paper or an edition
// she cannot link: Section 1…N, or "I've read it" (every part, so the whole book opens). The hand can only open more: her reading
// opens what it opens whatever she sets here, so a choice below where her reading is changes nothing, and the sheet says so. A radio
// group (APG) in a sheet that scrolls: 44 px rows, the chosen one marked by a check and by `aria-checked`, never by colour alone.
// The write goes through the store (`setHand`) and the room's track follows at once; a refusal stays in the sheet, worded.
import type { BuddyErrorCode, BuddyRead } from '~/data/buddyReads'
import { buddyErrorKey } from '~/utils/buddyRead'
import { currentChoice, markerChoices } from '~/utils/buddyRoom'
import { useBuddyReadStore } from '~/stores/buddyRead'

const props = defineProps<{ read: BuddyRead }>()
const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const store = useBuddyReadStore()
const online = useOnline()

const parts = computed(() => props.read.chapters.filter((c) => c.kind === 'chapter').length)
const choices = computed(() => markerChoices(parts.value))
const chosen = computed(() => currentChoice(props.read.me.hand, parts.value))

const busy = ref<string | null>(null)
const error = ref<BuddyErrorCode | null>(null)
const said = ref('')

watch(open, (now) => {
  if (!now) return
  error.value = null
  said.value = ''
})

const label = (kind: 'auto' | 'section' | 'end', section: number | null) =>
  kind === 'auto' ? t('together.marker.auto') : kind === 'end' ? t('together.marker.end') : t('together.marker.section', { n: section })

async function pick(key: string, through: number | null, kind: 'auto' | 'section' | 'end', section: number | null) {
  if (busy.value || key === chosen.value) return
  busy.value = key
  error.value = null
  const answer = await store.setHand(props.read.id, through)
  busy.value = null
  if (answer.error) {
    error.value = answer.error
    return
  }
  said.value = t('together.marker.saved', { where: label(kind, section) })
}

/** Her reading cannot be followed: nothing linked, or no page count to work a fraction from. */
const noAuto = computed(() => props.read.me.auto === null)
</script>

<template>
  <UiSheet v-model:open="open" :title="t('together.marker.title')" :cancel="false" :action="t('together.done')" testid="together.marker" @action="open = false">
    <div class="flex flex-col gap-md pt-xs pb-lg">
      <p class="text-subhead text-ink-muted" data-testid="together.marker.hint">{{ t('together.marker.hint') }}</p>
      <p v-if="noAuto" class="text-footnote text-ink-faint" data-testid="together.marker.noAuto">{{ t('together.marker.noAuto') }}</p>

      <UiRowGroup>
        <div role="radiogroup" :aria-label="t('together.marker.title')">
          <button
            v-for="c in choices"
            :key="c.key"
            type="button"
            role="radio"
            :aria-checked="c.key === chosen"
            :disabled="busy !== null || !online"
            class="flex min-h-(--size-row) w-full items-center gap-ms border-hairline px-inset text-left text-body not-first:border-t not-disabled:active:bg-fill-strong focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
            :data-testid="`together.marker.${c.kind}`"
            :data-choice="c.key"
            @click="pick(c.key, c.through, c.kind, c.section)"
          >
            <span class="min-w-0 flex-1">
              <span class="block">{{ label(c.kind, c.section) }}</span>
              <span v-if="c.kind === 'auto'" class="block text-footnote text-ink-faint">{{ t('together.marker.autoHint') }}</span>
            </span>
            <UiIcon v-if="c.key === chosen" name="check" :size="18" class="text-accent-ink" />
          </button>
        </div>
      </UiRowGroup>

      <p v-if="!online" class="text-footnote text-ink-faint" data-testid="together.marker.offline">{{ t('common.offline') }}</p>
      <p v-if="error" class="text-footnote text-error" role="alert" data-testid="together.marker.error">{{ t(buddyErrorKey(error)) }}</p>
      <p class="sr-only" role="status" data-testid="together.marker.status">{{ said }}</p>
    </div>
  </UiSheet>
</template>
