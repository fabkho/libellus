<script setup lang="ts">
// The heart on a finished read (social v2a, contract §3): in the feed, on Home's card and on a member's
// Recently finished rows. Props only; the screen that has the read wires `toggle` and `open`.
//  - Another member's read: a heart with its count (the count is hidden at 0). Pressed (`liked`) it is filled
//    and the lamp's colour; a tap emits `toggle`. Likes are online only: offline the button says *Offline*
//    in its place and waits (UiButton's `offline`).
//  - Her own read (`own`): the heart cannot be pressed, it shows the count and a tap emits `open`, which opens
//    the likers sheet (LikersSheet). Nothing at all while nobody liked it.
// `busy`: a like on its way (the button cannot be pressed twice). `name` and `title` are the read's owner and
// Book, for the screen reader's label. Test ids: `<testid>` (the button).
const props = withDefaults(
  defineProps<{ count: number; liked?: boolean; own?: boolean; offline?: boolean; busy?: boolean; name: string; title: string; testid?: string }>(),
  { liked: false, own: false, offline: false, busy: false, testid: 'feed.like' },
)
defineEmits<{ toggle: []; open: [] }>()

const { t } = useI18n()
const label = computed(() => {
  if (props.own) return t('social.like.ownLabel', { count: props.count, title: props.title }, props.count)
  return props.liked ? t('social.like.unlabel', { name: props.name, title: props.title }) : t('social.like.label', { name: props.name, title: props.title })
})
const hidden = computed(() => props.own && props.count === 0)
</script>

<template>
  <UiButton
    v-if="!hidden"
    tone="plain"
    size="sm"
    :offline="offline && !own"
    :disabled="busy"
    :aria-label="label"
    :aria-pressed="own ? undefined : liked"
    :class="liked && !own ? '!text-accent-ink' : ''"
    :data-testid="testid"
    @click="own ? $emit('open') : $emit('toggle')"
  >
    <UiIcon name="heart" :size="16" :class="liked && !own && 'fill-current'" />
    <span v-if="count > 0" class="figures" :data-testid="`${testid}.count`">{{ count }}</span>
  </UiButton>
</template>
