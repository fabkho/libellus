<script setup lang="ts">
// A buddy read invitation waiting for her (W3): one raised row on Friends, above the feed: the Book's cover, "<Host> invited you to read
// <Book> together", how many are in and how many Sections, then Join and Not now. Drawing only: the page that shows it answers the emits
// through stores/buddyRead.ts (`answerInvite`) and decides when the row leaves. Never drawn with buddy reads off (the page asks first).
//
// Props: `invitation` (data/buddyReads.ts), `offline` (no connection: the buttons give way to one disabled Offline button), `busy` (a write on
// its way: they wait). Emits `accept`, `decline`. Test ids: `buddyInvite.row`, `.accept`, `.decline`.
import type { BuddyInvitation } from '~/data/buddyReads'

const props = withDefaults(defineProps<{ invitation: BuddyInvitation; offline?: boolean; busy?: boolean }>(), { offline: false, busy: false })
defineEmits<{ accept: []; decline: [] }>()

const { t } = useI18n()
const coverHosts = { ...useCoverHosts(), proxy: false }
const by = computed(() => props.invitation.invitedBy ?? props.invitation.host)
const name = computed(() => by.value?.name?.trim() || t('member.someone'))
const title = computed(() => props.invitation.book.title)
</script>

<template>
  <li class="flex flex-col gap-ms rounded-md bg-surface-raised px-ms py-ms edge-faint" data-testid="buddyInvite.row">
    <div class="flex items-center gap-ms">
      <UiCover
        decorative
        :title="invitation.book.title"
        :authors="invitation.book.authors"
        v-bind="coverImage(invitation.book, 'xs', coverHosts)"
        :thumbhash="invitation.book.coverThumbhash"
        :colors="invitation.book.coverColors"
        size="xs"
      />
      <div class="flex min-w-0 flex-1 flex-col gap-xxs">
        <span class="text-subhead font-medium">{{ t('together.invitation.line', { name, title }) }}</span>
        <span class="text-caption text-ink-muted">
          {{ t('together.count.readers', { count: invitation.memberCount }, invitation.memberCount) }}<span aria-hidden="true"> · </span><span class="sr-only">, </span>{{ t('together.count.sections', { count: invitation.sections }, invitation.sections) }}
        </span>
      </div>
    </div>
    <div class="flex items-center justify-end gap-sm">
      <UiButton v-if="offline" tone="secondary" size="sm" offline data-testid="buddyInvite.accept" />
      <template v-else>
        <UiButton tone="plain" size="sm" :disabled="busy" :aria-label="t('together.invitation.declineLabel', { title })" data-testid="buddyInvite.decline" @click="$emit('decline')">
          {{ t('together.invitation.decline') }}
        </UiButton>
        <UiButton size="sm" :disabled="busy" :aria-label="t('together.invitation.acceptLabel', { title })" data-testid="buddyInvite.accept" @click="$emit('accept')">
          {{ t('together.invitation.accept') }}
        </UiButton>
      </template>
    </div>
  </li>
</template>
