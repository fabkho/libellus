<script setup lang="ts">
// Who in her circle reads (or wants to read) the same Book (social v2a, contract §3 and §1.4): up to three small
// avatars overlapping on a cover's lower edge, "+N" after them, and a tap opens a small sheet with the names.
// Props only: the screen gives the group that `circle_reading` / `circle_want` handed it for this Book (nothing
// is drawn without members) and puts the button where it belongs (a class on it: the cover's edge); it is a
// sibling of the cover's link, never inside it.
//  - `members`  the cards, at most three are drawn (the answer sends at most three).
//  - `more`     how many others there are beyond the cards ("+N").
//  - `kind`     'reading' ("Also reading: Anna, Ben and 2 others") or 'want' ("Also want to read: …"), the
//               button's accessible name and the sheet's title.
// The sheet lists the cards (FriendsAvatar and name, a row opens `/friends/<id>`), and says "and N more" when
// there are others. The avatars are small (`--size-avatar-xs`) and carry no initials, only the photo or the plain
// disc: at that size letters are noise. "+N" is a chip of the same size, so it reads on a cover and on a card's
// light. `--circle-ring` (default: the page's colour) is the ring that separates the avatars from one another and
// from what is under them; a card sets it to its own surface. Put the stack inside the cover's lower edge
// (`bottom: var(--spacing-xs)`): its 44 px hit area then stays clear of what is under the cover.
// Test ids: `<testid>` (the button, default `circleAvatars`), `circleAvatars.sheet`, `circleAvatars.row`,
// `circleAvatars.member`, `circleAvatars.more`.
import type { MemberCard } from '~/data/socialShapes'

const props = withDefaults(defineProps<{ members: readonly MemberCard[]; more?: number; kind: 'reading' | 'want'; testid?: string }>(), {
  more: 0,
  testid: 'circleAvatars',
})

const SHOWN = 3
const { t } = useI18n()
const open = ref(false)
const shown = computed(() => props.members.slice(0, SHOWN))
const extra = computed(() => Math.max(0, props.more) + Math.max(0, props.members.length - SHOWN))
const nameOf = (member: MemberCard) => member.name?.trim() || t('member.someone')
const names = computed(() => {
  const parts = circleNameParts(props.members.slice(0, SHOWN).map(nameOf), extra.value)
  return t(`social.circle.names.${parts.key}`, parts.args, parts.count)
})
const label = computed(() => t(`social.circle.${props.kind}`, { names: names.value }))
const title = computed(() => t(props.kind === 'reading' ? 'social.circle.sheetReading' : 'social.circle.sheetWant'))
</script>

<template>
  <span v-if="members.length" class="circle">
    <button type="button" class="hit flex items-center rounded-pill" :aria-label="label" aria-haspopup="dialog" :data-testid="testid" @click="open = true">
      <span v-for="(member, i) in shown" :key="member.id" class="mini" :class="i > 0 && 'overlap'" aria-hidden="true">
        <FriendsAvatar :card="member" />
      </span>
      <span v-if="extra > 0" class="disc overlap" aria-hidden="true">
        <span class="chip figures text-meta font-medium text-ink-muted edge rounded-pill bg-fill">+{{ extra }}</span>
      </span>
    </button>

    <UiSheet v-model:open="open" :title="title" testid="circleAvatars.sheet">
      <div class="flex flex-col gap-md pt-xs pb-lg">
        <UiRowGroup>
          <ul>
            <li v-for="member in members" :key="member.id" class="border-hairline not-first:border-t" data-testid="circleAvatars.row">
              <NuxtLink :to="`/friends/${member.id}`" class="flex min-h-(--size-row) items-center gap-ms px-inset py-xs active:opacity-70" data-testid="circleAvatars.member">
                <FriendsAvatar :card="member" />
                <span class="min-w-0 flex-1 truncate text-body">{{ nameOf(member) }}</span>
              </NuxtLink>
            </li>
          </ul>
        </UiRowGroup>
        <p v-if="extra > 0" class="text-center text-subhead text-ink-muted" data-testid="circleAvatars.more">{{ t('social.circle.more', { count: extra }) }}</p>
      </div>
    </UiSheet>
  </span>
</template>

<style scoped>
/* Small avatars: UiAvatar reads its size from --size-avatar, so the small ones are that token turned down here
   (--size-avatar-xs). No initials at this size: only a photo shows, over the plain disc. */
.mini,
.disc {
  display: flex;
  border-radius: var(--radius-pill);
  /* An opaque disc under the avatar (its fill is see-through), so the cover does not show through; the same colour is the ring. */
  background: var(--circle-ring, var(--color-surface));
  box-shadow: 0 0 0 var(--spacing-xxs) var(--circle-ring, var(--color-surface));
}
.mini {
  --size-avatar: var(--size-avatar-xs);
}
.mini :deep(.figures) {
  color: transparent;
}
.overlap {
  margin-inline-start: calc(-1 * var(--spacing-xs));
}
/* "+N": a chip as tall as the avatars, wider when it needs to be. */
.chip {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: var(--size-avatar-xs);
  height: var(--size-avatar-xs);
  padding-inline: var(--spacing-xs);
  position: relative;
}
/* The tap target is the app's 44 px, around a stack that draws small: as tall as --size-touch, a little wider than the stack. */
.hit {
  position: relative;
}
.hit::before {
  position: absolute;
  inset-block: calc((var(--size-touch) - var(--size-avatar-xs)) / -2);
  inset-inline: calc(-1 * var(--spacing-sm));
  content: '';
}
</style>
