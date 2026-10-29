<script setup lang="ts">
// What stands under the Book in front of "You both read" (poster and reel alike): two glass pills, hers (her avatar
// and her rating) and yours, then the Book's title and author. A pill is absent when its rating is: hers where she
// shows no ratings (`hers.rating` null), yours where you gave none. Pills are drawn here by Libellus from its own
// `BothRead`, never by Regal: the reel's `#tooltip` slot places this under the front Book, the poster puts it under
// its own. Drawing only; the section hands in the item, her card and her name. `link`: the title and author are a
// link to the Book's page (the still, which has no events of its own, and where the caption is what a tap can reach).
import type { BothRead, MemberCard } from '~/data/socialShapes'
import { useAvatarStore } from '~/stores/avatar'
import { useSessionStore } from '~/stores/session'
import { bookPathOf } from '~/utils/memberProfile'

const props = defineProps<{ item: BothRead; card: MemberCard | null; name: string; link?: boolean }>()
const { t } = useI18n()

const PressLink = resolveComponent('UiPressLink')
/** Where the title leads (`link` only): null for a Manual book or an unverified one, which open nothing. */
const to = computed(() => (props.link ? bookPathOf(props.item.book) : null))
const shown = computed(() => shownBook(props.item.book, t('book.outsideCatalogue')))
const hers = computed(() => t('member.bothReadHers', { name: props.name, rating: ratingText(props.item.hers.rating) }))
const mine = computed(() => t('member.bothReadMine', { rating: ratingText(props.item.mine.rating) }))

const session = useSessionStore()
const avatar = useAvatarStore()
const myInitials = computed(() => initialsOf(session.member?.email ?? '', session.member?.name))
onMounted(() => void avatar.load())
</script>

<template>
  <div class="flex flex-col items-center gap-sm text-center" data-testid="member.bothRead.caption">
    <div v-if="item.hers.rating || item.mine.rating" class="flex items-center justify-center gap-xl">
      <span v-if="item.hers.rating && card" class="inline-flex items-center gap-xs rounded-pill bg-surface-raised p-xxs pr-ms shadow-raised edge-faint" role="img" :aria-label="hers" data-testid="member.bothRead.hers">
        <FriendsAvatar :card="card" aria-hidden="true" />
        <UiIcon name="star" :size="16" class="text-accent" aria-hidden="true" />
        <span class="figures text-subhead" aria-hidden="true">{{ ratingText(item.hers.rating) }}</span>
      </span>
      <span v-if="item.mine.rating" class="inline-flex items-center gap-xs rounded-pill bg-surface-raised p-xxs pr-ms shadow-raised edge-faint" role="img" :aria-label="mine" data-testid="member.bothRead.mine">
        <UiAvatar :initials="myInitials" :photo="avatar.small" aria-hidden="true" />
        <UiIcon name="star" :size="16" class="text-accent" aria-hidden="true" />
        <span class="figures text-subhead" aria-hidden="true">{{ ratingText(item.mine.rating) }}</span>
      </span>
    </div>
    <component :is="to ? PressLink : 'div'" :to="to ?? undefined" class="flex max-w-full flex-col gap-xxs px-screen" :class="to && 'pointer-events-auto'">
      <p class="book-title text-headline text-balance" data-testid="member.bothRead.title">{{ shown.title }}</p>
      <p v-if="shown.authors.length" class="text-subhead text-ink-muted">{{ shown.authors.join(', ') }}</p>
    </component>
  </div>
</template>
