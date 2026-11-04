<script setup lang="ts">
// The track of a buddy read (docs/plans/buddy-read-shared.md part B, the room): one hairline bar across the width, a tick at every
// Section's end, and each member's avatar sitting in her Section — never at a page or a percent, nothing finer than a Section reaches
// another member (part 5.5). Two members of one Section stand side by side, overlapping a little; her own avatar has the lamp ring.
// Members with no Section yet ("not set") are not on the bar; the list under it names where everybody is, which is how a screen
// reader meets the track (the bar itself is a picture). Under the bar: "You: Section 3 of 8" and "Where are you?", which opens the
// marker sheet (`marker` is emitted; the page owns the sheet).
import type { BuddyRead } from '~/data/buddyReads'
import { trackOf } from '~/utils/buddyRoom'

const props = defineProps<{ read: BuddyRead; me: string | null }>()
const emit = defineEmits<{ marker: [] }>()

const { t } = useI18n()

const parts = computed(() => props.read.chapters.filter((c) => c.kind === 'chapter').length)
const placed = computed(() => trackOf(props.read.members, parts.value, props.me, 9))
/** Ticks at the end of every Section but the last: where the next one begins. */
const ticks = computed(() => Array.from({ length: Math.max(0, parts.value - 1) }, (_, i) => ((i + 1) / parts.value) * 100))

const nameOf = (id: string, name: string | null) => (id === props.me ? t('together.you') : name?.trim() || t('member.someone'))

/** Where one member is, in words: "Section 3", "Finished reading", "Not set yet". */
function whereWords(where: BuddyRead['members'][number]['where']): string {
  if (where?.kind === 'section') return t('together.where.section', { n: where.section })
  if (where?.kind === 'end') return t('together.where.end')
  return t('together.where.notSet')
}

const mine = computed(() => props.read.members.find((m) => m.id === props.me) ?? null)
const youLine = computed(() => {
  const where = mine.value?.where
  if (where?.kind === 'section') return t('together.track.you', { n: where.section, total: parts.value })
  if (where?.kind === 'end') return t('together.track.youEnd')
  return t('together.track.youNotSet')
})
</script>

<template>
  <section class="flex flex-col gap-sm" :aria-label="t('together.track.label')" data-testid="together.track">
    <div class="bar relative" aria-hidden="true">
      <span class="rail" />
      <span v-for="tick in ticks" :key="tick" class="tick" :style="{ left: `${tick}%` }" />
      <span
        v-for="p in placed"
        :key="p.member.id"
        class="mark"
        :class="p.member.id === me && 'mine'"
        :style="{ left: `${p.at}%` }"
        :data-testid="p.member.id === me ? 'together.track.me' : 'together.track.member'"
        :data-where="p.member.where?.kind"
      >
        <FriendsAvatar :card="{ id: p.member.id, name: p.member.name, photo: p.member.photo }" single />
      </span>
    </div>

    <ul class="sr-only" data-testid="together.track.list">
      <li v-for="m in read.members" :key="m.id">{{ nameOf(m.id, m.name) }}: {{ whereWords(m.where) }}</li>
    </ul>

    <div class="flex flex-wrap items-center justify-between gap-x-md">
      <p class="text-subhead text-ink-muted" data-testid="together.track.you">{{ youLine }}</p>
      <UiButton v-if="read.status !== 'archived'" tone="quiet" size="sm" data-testid="together.track.marker" @click="emit('marker')">
        {{ t('together.marker.open') }}
      </UiButton>
    </div>
  </section>
</template>

<style scoped>
/* The bar: the room for the avatars above the rail, which is a hairline. */
.bar {
  height: calc(var(--size-avatar) + var(--spacing-sm));
  margin-inline: calc(var(--size-avatar) / 2);
}
.rail {
  position: absolute;
  inset-inline: calc(var(--size-avatar) / -2);
  bottom: 0;
  height: var(--stroke-hairline);
  background: var(--color-hairline-strong);
}
.tick {
  position: absolute;
  bottom: 0;
  height: var(--spacing-xs);
  width: var(--stroke-hairline);
  background: var(--color-hairline-strong);
}
/* The avatar is centred on its place and stands on the rail; a later one overlaps the one before it (the ring keeps the edge). */
.mark {
  position: absolute;
  bottom: var(--spacing-xs);
  display: block;
  translate: -50% 0;
  border-radius: var(--radius-pill);
  box-shadow: 0 0 0 var(--stroke-focus) var(--color-surface);
}
.mark.mine {
  z-index: 1;
  box-shadow: 0 0 0 var(--stroke-focus) var(--color-accent);
}
</style>
