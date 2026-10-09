<script setup lang="ts">
// Who liked her read (social v2a, contract §3): the sheet the author's own heart opens, newest like first.
// Props only: the screen asks `session_likers` and hands the answer in.
//  - `members`  the cards (MemberCard), or null while they are on their way.
//  - `error`    the ask failed; `offline` the device has no connection (likes are online only).
// One row per member: her avatar (FriendsAvatar) and name, a link to her page. Test ids: `likers` (the sheet),
// `likers.row`, `likers.empty`, `likers.error`.
import type { MemberCard } from '~/data/socialShapes'

const open = defineModel<boolean>('open', { required: true })
defineProps<{ members: readonly MemberCard[] | null; error?: boolean; offline?: boolean }>()

const { t } = useI18n()
const nameOf = (member: MemberCard) => member.name?.trim() || t('member.someone')
</script>

<template>
  <UiSheet v-model:open="open" :title="t('social.likers.title')" testid="likers">
    <div class="flex flex-col gap-md pt-xs pb-lg">
      <p v-if="offline && !members" class="py-md text-center text-subhead text-ink-muted" data-testid="likers.offline">{{ t('social.likers.offline') }}</p>
      <p v-else-if="error" class="py-md text-center text-subhead text-error" role="alert" data-testid="likers.error">{{ t('social.likers.loadError') }}</p>
      <UiRowGroup v-else-if="members?.length">
        <ul>
          <li v-for="member in members" :key="member.id" class="border-hairline not-first:border-t" data-testid="likers.row">
            <NuxtLink :to="`/friends/${member.id}`" class="flex min-h-(--size-row) items-center gap-ms px-inset py-xs active:opacity-70" data-testid="likers.member">
              <FriendsAvatar :card="member" />
              <span class="min-w-0 flex-1 truncate text-body">{{ nameOf(member) }}</span>
            </NuxtLink>
          </li>
        </ul>
      </UiRowGroup>
      <p v-else-if="members" class="py-md text-center text-subhead text-ink-muted" data-testid="likers.empty">{{ t('social.likers.empty') }}</p>
    </div>
  </UiSheet>
</template>
