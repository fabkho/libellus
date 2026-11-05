<script setup lang="ts">
// How many comments are new to her in a buddy read, as a small number in a pill (Home's card, the Book page's row): `99+` above 99, nothing at 0.
// A number only, never a message's words (docs/plans/buddy-read-shared.md part 5.5): the server counts what her Section has opened. The pill is
// decoration for the eye; `label` ("3 new") is what is spoken, so a screen reader never hears a bare "99+".
// Props: `count` (the real number), `label` (the spoken words). Test id: `together.unread` unless the caller gives its own.
import { unreadBadge } from '~/utils/buddyEntry'

const props = defineProps<{ count: number; label: string }>()
const badge = computed(() => unreadBadge(props.count))
</script>

<template>
  <span v-if="badge" class="shrink-0" data-testid="together.unread">
    <span class="figures inline-block min-w-(--spacing-lg) rounded-pill bg-accent-soft px-sm text-center text-meta text-accent-ink" aria-hidden="true">{{ badge.text }}</span>
    <span class="sr-only">{{ label }}</span>
  </span>
</template>
