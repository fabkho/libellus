<script setup lang="ts">
// All the Books she finished that the profile carries (social v1, U4b; *See all* under Recently finished): a
// sheet with the section's rows, newest first. A row's Book opens its page (which closes the sheet); a
// Manual book opens nothing.
import type { MemberFinished } from '~/data/social'

const open = defineModel<boolean>('open', { required: true })
defineProps<{ title: string; items: readonly MemberFinished[]; name?: string }>()
</script>

<template>
  <UiSheet v-model:open="open" :title="title" testid="memberFinished">
    <ul class="flex flex-col pb-lg">
      <li v-for="item in items" :key="item.book.id" class="row" data-testid="memberFinished.row">
        <FriendsMemberFinishedRow :item="item" :name="name" />
      </li>
    </ul>
  </UiSheet>
</template>

<style scoped>
.row + .row {
  border-top: var(--stroke-hairline) solid var(--color-hairline);
}
</style>
