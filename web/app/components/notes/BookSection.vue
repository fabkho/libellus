<script setup lang="ts">
// The *Notes* section of a Book's page (docs/plans/book-notes.md part 5; docs/parity.md, *Notes, the Book page section*), below the actions, and only when there is something to say:
// **From friends** (up to three faces, "Ben and Jo · 14 notes · chapters 1–9") and **Public** (a globe, "6 notes from 3 members"), each a link to the Notes page. A row is absent when its count
// is 0, the section when both are. The numbers are `notes_summary(book)`: only what she may see, never her own, nothing of the words. Read when the page opens, fresh each time through the
// small store (stores/notesSummary.ts: no chat layer, no Realtime; tests/notes-entry.test.ts). Test ids: `book.notes.section`, `book.notes.friends`, `book.notes.public`.
import type { Book, BookSnapshot } from '~/data/books'
import { friendsNameParts } from '~/utils/friendsNames'
import { notesPath } from '~/utils/notesRoute'
import { summaryRows } from '~/utils/notesSummary'
import { useNotesSummaryStore } from '~/stores/notesSummary'

const props = defineProps<{ book: Book | BookSnapshot }>()
const { t } = useI18n()
const store = useNotesSummaryStore()

const bookId = computed(() => ('id' in props.book && props.book.source !== 'manual' ? props.book.id : null))
const rows = computed(() => summaryRows(store.of(bookId.value)))

watch(bookId, (id) => id && void store.load(id), { immediate: true })

const friendsLine = computed(() => {
  const f = rows.value.friends
  if (!f) return ''
  const names = friendsNameParts(f.authors.map((a) => a.name?.trim() || t('member.someone')), Math.max(0, f.authorCount - f.authors.length))
  const where = f.first === null || f.last === null ? '' : f.first === f.last ? t('notes.section.chapter', { n: f.first }) : t('notes.section.chapters', { from: f.first, to: f.last })
  return [t(`social.friends.names.${names.key}`, names.args, names.count), t('notes.section.notes', { count: f.count }, f.count), where].filter(Boolean).join(t('notes.section.dot'))
})
const publicLine = computed(() => {
  const p = rows.value.public
  return p ? t('notes.section.publicLine', { notes: t('notes.section.notes', { count: p.count }, p.count), members: t('notes.section.members', { count: p.authorCount }, p.authorCount) }) : ''
})
const faceCard = (a: { id: string; name: string | null; photo: string | null }) => a
</script>

<template>
  <section v-if="bookId && (rows.friends || rows.public)" class="relative px-ml pt-xl" aria-labelledby="book-notes-title" data-testid="book.notes.section">
    <h2 id="book-notes-title" class="eyebrow mb-ms">{{ t('notes.title') }}</h2>
    <UiRowGroup>
      <NuxtLink
        v-if="rows.friends"
        :to="notesPath(bookId)"
        class="flex min-h-(--size-row) w-full items-center gap-ms px-inset py-xs text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent active:bg-fill-strong"
        data-testid="book.notes.friends"
      >
        <span class="flex shrink-0 -space-x-2" aria-hidden="true"><FriendsAvatar v-for="a in rows.friends.authors" :key="a.id" :card="faceCard(a)" /></span>
        <span class="min-w-0 flex-1">
          <span class="block text-body">{{ t('notes.section.friends') }}</span>
          <span class="block text-subhead text-ink-muted wrap-anywhere">{{ friendsLine }}</span>
        </span>
        <UiIcon name="chevron" :size="15" bold class="text-ink-ghost" />
      </NuxtLink>
      <NuxtLink
        v-if="rows.public"
        :to="notesPath(bookId)"
        class="flex min-h-(--size-row) w-full items-center gap-ms border-hairline px-inset py-xs text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent active:bg-fill-strong not-first:border-t"
        data-testid="book.notes.public"
      >
        <span class="flex w-(--size-avatar) shrink-0 justify-center text-ink-faint" aria-hidden="true"><UiIcon name="globe" :size="22" /></span>
        <span class="min-w-0 flex-1">
          <span class="block text-body">{{ t('notes.section.public') }}</span>
          <span class="block text-subhead text-ink-muted wrap-anywhere">{{ publicLine }}</span>
        </span>
        <UiIcon name="chevron" :size="15" bold class="text-ink-ghost" />
      </NuxtLink>
    </UiRowGroup>
  </section>
</template>
