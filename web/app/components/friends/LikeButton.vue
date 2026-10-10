<script setup lang="ts">
// The heart on a finished read (social v2a, contract §3; the owner's layout B): an icon in the column at the row's
// right edge (FriendsRowActions), under Want to read, with its count under it (hidden at 0), filled and in the
// lamp's colour once she liked it. Props only; the row wires `toggle` (FriendsLikes, stores/likes.ts). One constant
// name ("Like Ida’s read of Piranesi") and `aria-pressed` for the state, so a screen reader says "…, pressed" and never
// contradicts itself; the count is part of the same `sr-only` name (an aria-label on the button, or on a span inside it, would hide it). Likes need the
// connection: offline the heart stays, faint, without a word (Want to read says Offline), `aria-disabled`; busy is
// `aria-disabled` too, so focus stays on the button. Her own reads have no heart (the likers sheet on Home is where
// she sees who). The count hangs under the icon without taking room in the column, so the 44 px boxes of the two icons
// stay 44 px apart (main.css, `icon-action`).
// `name` and `title` are the read's owner and Book. Test ids: `<testid>` (the button), `<testid>.count`.
const props = withDefaults(
  defineProps<{ count: number; liked?: boolean; offline?: boolean; busy?: boolean; name: string; title: string; testid?: string }>(),
  { liked: false, offline: false, busy: false, testid: 'feed.like' },
)
const emit = defineEmits<{ toggle: [] }>()

const { t } = useI18n()
function press() {
  if (!props.offline && !props.busy) emit('toggle')
}
</script>

<template>
  <button
    type="button"
    class="icon-action"
    :class="offline ? 'text-ink-faint' : liked ? 'text-accent-ink' : 'text-ink-faint'"
    :aria-disabled="offline || busy"
    :aria-pressed="liked"
    :data-testid="testid"
    @click="press"
  >
    <UiIcon name="heart" :size="18" :class="liked && 'fill-current'" />
    <span v-if="count > 0" class="figures absolute top-full -mt-xxs text-meta" aria-hidden="true" :data-testid="`${testid}.count`">{{ count }}</span>
    <!-- The button's name, from its content (an aria-label would hide the count): the label, then the count when there is one. -->
    <span class="sr-only">{{ t('social.like.label', { name, title }) }}<template v-if="count > 0">, {{ t('social.like.count', { count }, count) }}</template></span>
  </button>
</template>
