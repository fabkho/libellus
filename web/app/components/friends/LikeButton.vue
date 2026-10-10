<script setup lang="ts">
// The heart on a finished read (social v2a, contract §3): in the feed, on Home's card and on a member's
// Recently finished rows. Small clickable text like Want to read's (it never makes its row taller): the
// heart and its count (hidden at 0), filled and in the lamp's colour once she liked it. Props only; the row
// wires `toggle` (FriendsLikes, stores/likes.ts). Likes need the connection: offline it says *Offline* in
// its place. `busy`: a like on its way. `name` and `title` are the read's owner and Book, for the screen
// reader. Her own reads have no heart (the likers sheet on Home is where she sees who). Test ids:
// `<testid>` (the button), `<testid>.count`.
const props = withDefaults(
  defineProps<{ count: number; liked?: boolean; offline?: boolean; busy?: boolean; name: string; title: string; testid?: string }>(),
  { liked: false, offline: false, busy: false, testid: 'feed.like' },
)
defineEmits<{ toggle: [] }>()

const { t } = useI18n()
const label = computed(() => t(props.liked ? 'social.like.unlabel' : 'social.like.label', { name: props.name, title: props.title }))
</script>

<template>
  <button v-if="offline" type="button" class="tiny text-ink-faint" disabled :data-testid="testid" data-offline>
    <UiIcon name="offline" :size="12" />{{ t('common.offline') }}
  </button>
  <button
    v-else
    type="button"
    class="tiny"
    :class="liked ? 'text-accent-ink' : 'text-ink-faint'"
    :disabled="busy"
    :aria-label="label"
    :aria-pressed="liked"
    :data-testid="testid"
    @click="$emit('toggle')"
  >
    <UiIcon name="heart" :size="14" :class="liked && 'fill-current'" />
    <span v-if="count > 0" class="figures" :aria-label="t('social.like.count', { count }, count)" :data-testid="`${testid}.count`">{{ count }}</span>
  </button>
</template>

<style scoped>
/* Clickable text, no pill: it never makes its row taller. The 44 px target is an invisible box centred on it. */
.tiny {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-xs);
  font-size: var(--text-caption, 0.8125rem);
  line-height: 1;
  white-space: nowrap;
}
.tiny::after {
  position: absolute;
  inset: 50% calc(-1 * var(--spacing-sm)) auto;
  height: var(--size-touch);
  content: '';
  transform: translateY(-50%);
}
.tiny:disabled {
  opacity: 0.6;
}
</style>
