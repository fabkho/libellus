<script setup lang="ts">
// Recently finished on a member's profile (social v1, U4): her newest finished Books (FINISHED_SHOWN), each
// a row (MemberFinishedRow), and *See all* at the right of the eyebrow, as Want to read has it, once she has
// more than that; the page opens the sheet with all of them. The profile carries the Books newest first.
import type { SocialBook } from '~/data/social'
import { FINISHED_SHOWN } from '~/utils/memberProfile'

const props = defineProps<{
  items: readonly { book: SocialBook; endedOn: string | null; rating: number | null; review: string | null }[]
  /** *See all*: she has more than the section shows. */
  all: boolean
}>()
defineEmits<{ all: [] }>()

const { t } = useI18n()
const shown = computed(() => props.items.slice(0, FINISHED_SHOWN))
</script>

<template>
  <section class="flex flex-col" data-testid="member.finished">
    <div class="mb-xs flex h-(--size-button-sm) items-center justify-between gap-md">
      <h2 class="eyebrow">{{ t('member.finished') }}</h2>
      <UiButton v-if="all" tone="quiet" size="sm" data-testid="member.finishedAll" @click="$emit('all')">
        {{ t('member.wantAll') }}<UiIcon name="chevron" :size="13" />
      </UiButton>
    </div>
    <ul class="flex flex-col">
      <li v-for="item in shown" :key="item.book.id" class="row">
        <FriendsMemberFinishedRow :item="item" />
      </li>
    </ul>
  </section>
</template>

<style scoped>
.row + .row {
  border-top: var(--stroke-hairline) solid var(--color-hairline);
}
</style>
