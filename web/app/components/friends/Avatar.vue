<script setup lang="ts">
// A member's avatar, from the card the social answers carry (data/socialShapes.ts, MemberCard): the
// initials of her name in the ring (a card without a name: the first letter of "A reader"), and
// her photo over them once there is one. The one place that draws another member's avatar: the
// feed's rows, the batch fan, People and a member's page all come here, so the photo (U7) arrives
// in all of them at once. Drawing only, like UiAvatar; the link or button around it carries the label.
import type { MemberCard } from '~/data/socialShapes'
import { useMemberPhotosStore } from '~/stores/memberPhotos'

// `large`: the 512 px file, for a hero; rows take the 128 px one. `single`: one initial, the first letter of her
// name (the small avatars on a cover, CircleAvatars: two letters do not fit in a disc that small).
const props = withDefaults(defineProps<{ card: MemberCard; size?: 'small' | 'large'; single?: boolean }>(), { size: 'small', single: false })
const photos = useMemberPhotosStore()
const photo = computed(() => photos.photoOf(props.card, props.size))

const { t } = useI18n()
const initials = computed(() => {
  const all = props.card.name?.trim() ? initialsOf('', props.card.name) : ([...t('member.someone')][0] ?? '?').toLocaleUpperCase()
  return props.single ? ([...all][0] ?? all) : all
})
</script>

<template>
  <UiAvatar :initials="initials" :photo="photo" />
</template>
