<script setup lang="ts">
// The heart of one finished read, wired (social v2a): LikeButton with what the row says (`likes`, `liked`) and
// the store's tap (stores/likes.ts: the result shows at once, the database's answer replaces it, a refusal takes
// it back and the line says so). Nothing for a row that is no finished read of another member (`sessionId`
// null) or a Manual book, which a follower cannot open. The error line is `role=alert`, under the row's text
// (`errorLine`: whether the row draws it, so a row with two of these draws it once).
// Props: `row` (`sessionId`, `likes`, `liked`), `name` and `owner` (the member whose read it is: her id, so her hearts go
// when she leaves the circle), `title`, `testid`. Test ids: `<testid>`, `<testid>.count`, `<testid>.error`.
import { useLikesStore } from '~/stores/likes'
import { likeable } from '~/utils/likes'

const props = withDefaults(
  defineProps<{ row: { sessionId?: string | null; likes?: number; liked?: boolean }; name: string; owner?: string; title: string; testid?: string }>(),
  { testid: 'feed.like' },
)

const likes = useLikesStore()
const online = useOnline()
const session = computed(() => (likeable(props.row) ? props.row.sessionId! : null))
const shown = computed(() => (session.value ? likes.face(session.value, { likes: props.row.likes ?? 0, liked: props.row.liked ?? false }) : null))

function toggle() {
  if (session.value) void likes.toggle(session.value, { likes: props.row.likes ?? 0, liked: props.row.liked ?? false }, props.owner)
}
</script>

<template>
  <FriendsLikeButton
    v-if="session && shown"
    :count="shown.likes"
    :liked="shown.liked"
    :offline="!online"
    :busy="likes.busy[session]"
    :name="name"
    :title="title"
    :testid="testid"
    @toggle="toggle"
  />
</template>
