<script setup lang="ts">
// Share a Book (issue #171; the book page's options → Share): its card on her
// reading page, `/r/<token>/book/<id>`, with her Rating and, if she says so,
// her review (Include my review: the per-review opt-in; it also shows the
// review on her page's Recently finished). Share hands the link to the
// platform's share sheet (the clipboard where there is none), Copy link copies
// it; either first writes the card as she set it. A card lives under her
// reading page's link, so with the page off the sheet says so and offers to
// turn it on. Writes wait for a connection.
import type { LibraryEntry } from '~/data/library'
import { useSharingStore } from '~/stores/sharing'
import { copyLink, shareLink, type ShareOutcome } from '~/utils/shareLink'

const props = defineProps<{ entry: LibraryEntry | null }>()
const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const sharing = useSharingStore()
const online = useOnline()

const book = computed(() => props.entry?.book ?? null)
const hasReview = computed(() => Boolean(props.entry?.latestSession?.review))
const review = ref(false)
const outcome = ref<ShareOutcome | null>(null)

watch(open, async (isOpen) => {
  if (!isOpen || !book.value) return
  sharing.clearError()
  outcome.value = null
  await sharing.load()
  const shared = await sharing.sharedBook(book.value.id)
  review.value = shared?.review ?? false
})

const on = computed(() => Boolean(sharing.settings?.token))
const disabled = computed(() => !online.value || sharing.busy)

// The card is written and the link handed over at once: Safari opens its share sheet (and lets the
// clipboard be written) only while the tap is fresh, which a round trip first would outlast. The
// address is known before the write (the page's token and the Book's id).
async function hand(how: 'share' | 'copy') {
  const url = book.value ? sharing.cardUrl(book.value.id) : null
  if (!book.value || !url || disabled.value) return
  outcome.value = null
  const written = sharing.shareBook(book.value.id, hasReview.value && review.value)
  const handed = how === 'share' ? shareLink({ url, title: book.value.title }, navigator) : copyLink(url, navigator)
  const [card, result] = await Promise.all([written, handed])
  outcome.value = card ? result : null
}
</script>

<template>
  <UiSheet v-model:open="open" :title="t('sharing.book.title')" testid="shareBook">
    <div class="flex flex-col gap-md pt-xs pb-lg">
      <UiBookLine
        v-if="book"
        :title="book.title"
        :authors="book.authors"
        :src="coverSrc(book.coverUrl, 'xs')"
        :thumbhash="book.coverThumbhash"
        :colors="book.coverColors"
      />

      <template v-if="sharing.settings && !on">
        <p class="text-subhead text-ink-muted" data-testid="shareBook.off">{{ t('sharing.book.off') }}</p>
        <UiButton tone="primary" size="md" block :offline="!online" :disabled="sharing.busy" data-testid="shareBook.turnOn" @click="sharing.setOn(true)">
          {{ t('sharing.book.turnOn') }}
        </UiButton>
      </template>

      <template v-else-if="sharing.settings">
        <UiRowGroup v-if="hasReview">
          <UiSwitchRow v-model="review" icon="pencil" :label="t('sharing.book.review')" testid="shareBook.review" />
        </UiRowGroup>
        <p v-if="hasReview && review" class="text-footnote text-ink-faint">{{ t('sharing.book.reviewNote') }}</p>
        <div class="flex gap-sm">
          <UiButton tone="primary" size="md" class="flex-1" :offline="!online" :disabled="sharing.busy" data-testid="shareBook.share" @click="hand('share')">
            <UiIcon name="share" :size="16" />{{ t('sharing.book.share') }}
          </UiButton>
          <UiButton tone="secondary" size="md" class="flex-1" :offline="!online" :disabled="sharing.busy" data-testid="shareBook.copy" @click="hand('copy')">
            <UiIcon name="copy" :size="16" />{{ t('sharing.book.copy') }}
          </UiButton>
        </div>
      </template>

      <p v-else-if="sharing.loadError" class="text-subhead text-ink-muted" data-testid="shareBook.loadError">
        {{ sharing.loadError === 'offline' ? t('sharing.error.offline') : t('sharing.loadError') }}
      </p>

      <p class="min-h-(--text-footnote--line-height) text-footnote" :class="sharing.error ? 'text-error' : 'text-ink-muted'" role="status" data-testid="shareBook.outcome">
        {{ sharing.error ? t(`sharing.error.${sharing.error}`) : outcome === 'copied' ? t('sharing.book.copied') : '' }}
      </p>
    </div>
  </UiSheet>
</template>
