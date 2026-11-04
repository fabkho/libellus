<script setup lang="ts">
// "Reading together" on Home (docs/plans/buddy-read-shared.md W5): her active buddy reads, one raised row each, the Book's cover, its title, how many
// readers and the Section she is in, and how many comments are new (a number, never words: part 5.5). A row opens the room. The invitations that wait
// for her sit above them (the same rows as on Friends, `TogetherInvitations`; Home hands them what it read, so it asks once). Nothing here when she has
// neither, and nothing at all unless this build has buddy reads and she turned them on: the page renders this component only then, as a lazy one, so
// the store, the data layer and the chat layer are not even loaded otherwise.
//
// Read when Home opens and every time it is back on screen (`my_buddy_reads()`, one query): no Realtime on Home, so the unread counts are as old as the
// last time she came here or left a room (a room's own screen keeps its counts live). Offline, what was last read stays.
//
// Test ids: `home.together` (the card), `home.togetherCount`, `home.togetherRow`, `home.togetherRow.unread`; the invitations' own are `buddyInvites*`.
import { useBuddyInvitesStore } from '~/stores/buddyInvites'
import { useBuddyReadStore } from '~/stores/buddyRead'
import type { BuddyCard } from '~/data/buddyReads'
import { homeReads, whereWords } from '~/utils/buddyEntry'
import { roomPath } from '~/utils/buddyRoute'

// Direct, as the other Home cards: only the Library's row and the reel go through `/cover` (docs/plans/owned-covers.md §5).
const coverHosts = { ...useCoverHosts(), proxy: false }

const { t } = useI18n()
const allowed = useBuddyReadsOn()
const store = useBuddyReadStore()
const invites = useBuddyInvitesStore()
const headingId = useId()

const rows = computed(() => (allowed.value ? homeReads(store.mine?.reads) : []))
/** The copy question after Join is a sheet of the invitations' component: the card stays while it is open, though the invitation has left. */
const copying = ref(false)
const show = computed(() => allowed.value && (rows.value.length > 0 || invites.count > 0 || copying.value))

let asking: Promise<void> | null = null
/** One read at a time: the first showing and the page's activation come together. */
function load(): Promise<void> {
  if (!allowed.value) return Promise.resolve()
  asking ??= (async () => {
    const failed = await store.loadMine()
    // What she was invited to arrives in the same answer: the Friends row and the lamp dot follow it.
    if (!failed && store.mine) invites.take(store.mine.invitations)
  })().finally(() => (asking = null))
  return asking
}
onMounted(() => void load())
// Home is kept alive: coming back asks again.
onActivated(() => void load())

const readers = (read: BuddyCard) => t('together.count.readers', { count: read.memberCount }, read.memberCount)
const where = (read: BuddyCard) => {
  const words = whereWords(read.where)
  return t(words.key, words.values)
}
</script>

<template>
  <UiReveal :show="show">
    <section :aria-labelledby="headingId" data-testid="home.together">
      <div class="flex h-(--size-touch) items-center justify-between">
        <h2 :id="headingId" class="eyebrow">{{ t('together.card.title') }}</h2>
        <span v-if="rows.length" class="eyebrow text-ink-faint" data-testid="home.togetherCount">{{ rows.length }}</span>
      </div>
      <TogetherInvitations v-model:copying="copying" bare :load="false" />
      <ul v-if="rows.length" class="flex flex-col gap-ms" :class="invites.count && 'mt-ms'">
        <li v-for="(read, index) in rows" :key="read.id">
          <UiPressLink
            :to="roomPath(read.id)"
            class="flex items-center gap-ms rounded-lg bg-surface-raised p-ms shadow-raised edge-faint"
            data-testid="home.togetherRow"
          >
            <UiCover
              decorative
              :title="read.book.title"
              :authors="read.book.authors"
              v-bind="coverImage(read.book, 'sm', coverHosts)"
              :thumbhash="read.book.coverThumbhash"
              :colors="read.book.coverColors"
              size="sm"
              :eager="index < 2"
            />
            <span class="flex min-w-0 flex-1 flex-col gap-xxs">
              <span class="book-title line-clamp-2 text-subhead">{{ read.book.title }}</span>
              <span class="text-caption text-ink-muted wrap-anywhere">
                {{ readers(read) }}<span aria-hidden="true"> · </span><span class="sr-only">, </span>{{ where(read) }}
              </span>
            </span>
            <TogetherUnreadBadge :count="read.unread" :label="t('together.entry.unread', { count: read.unread })" />
            <UiIcon name="chevron" :size="15" bold class="shrink-0 text-ink-ghost" />
          </UiPressLink>
        </li>
      </ul>
    </section>
  </UiReveal>
</template>
