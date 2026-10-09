<script setup lang="ts">
// One member in People's Following and Followers (social v1, U3): her avatar and name (the row opens
// the member's profile, `/friends/<id>`), then at the trailing edge what she can do: Follow back (a
// follower she does not follow: `followBack` 'offer', or the word Requested once she asked) and the ⋯
// that opens the member sheet. No counts, no chevron: the ⋯ is the only thing at the edge besides
// Follow back. The avatar is the shared one (FriendsAvatar: her photo over the initials).
//
// Props: `member` (MemberCard), `followBack` (null | 'offer' | 'requested'), `offline` (the device has
// no connection: Follow back says so and waits), `busy` (a write on its way). Emits `more` (the ⋯) and
// `followBack`. Test ids: `people.row`, `people.rowMore`, `people.followBack`, `people.requested`.
import type { MemberCard } from '~/data/socialShapes'
import type { FollowBackFace } from '~/utils/people'

withDefaults(defineProps<{ member: MemberCard; followBack?: FollowBackFace; offline?: boolean; busy?: boolean }>(), {
  followBack: null,
  offline: false,
  busy: false,
})
defineEmits<{ more: []; followBack: [] }>()

const { t } = useI18n()
</script>

<template>
  <div class="flex min-h-(--size-row) items-center gap-ms py-xs" data-testid="people.row">
    <NuxtLink :to="`/friends/${member.id}`" class="flex min-h-(--size-touch) min-w-0 flex-1 items-center gap-ms active:opacity-70" data-testid="people.rowMember">
      <FriendsAvatar :card="member" />
      <span class="min-w-0 flex-1 truncate text-body">{{ member.name ?? t('member.someone') }}</span>
    </NuxtLink>
    <UiButton
      v-if="followBack === 'offer'"
      tone="secondary"
      size="sm"
      :disabled="busy"
      :offline="offline"
      data-testid="people.followBack"
      @click="$emit('followBack')"
    >
      {{ t('people.followBack') }}
    </UiButton>
    <span v-else-if="followBack === 'requested'" class="shrink-0 px-sm text-caption text-ink-muted" data-testid="people.requested">{{ t('member.requested') }}</span>
    <button
      type="button"
      :aria-label="t('people.moreLabel', { name: member.name ?? t('member.someone') })"
      class="-mr-sm flex size-(--size-touch) shrink-0 items-center justify-center text-ink-faint active:text-ink"
      data-testid="people.rowMore"
      @click="$emit('more')"
    >
      <UiIcon name="more" :size="20" />
    </button>
  </div>
</template>
