<script setup lang="ts">
// Recently finished on a member's profile (social v1, U4): her newest finished Books (FINISHED_SHOWN), each
// a row (MemberFinishedRow), and *See all* at the right of the eyebrow, as Want to read has it, once she has
// more than that; the page opens the sheet with all of them. The profile carries the Books newest first.
import type { MemberFinished } from '~/data/social'
import { FINISHED_SHOWN } from '~/utils/memberProfile'

const props = defineProps<{
  items: readonly MemberFinished[]
  /** Her name, for the hearts' labels. */
  name?: string
  /** Her id, for the hearts. */
  memberId?: string
  /** *See all*: she has more than the section shows. */
  all: boolean
}>()
defineEmits<{ all: [] }>()

const { t } = useI18n()
const { count } = useFigures()
const shown = computed(() => props.items.slice(0, FINISHED_SHOWN))
</script>

<template>
  <section class="flex flex-col" data-testid="member.finished">
    <div class="mb-sm flex h-(--size-button-sm) items-center justify-between gap-md">
      <h2 class="eyebrow">{{ t('member.finished') }}</h2>
      <UiButton v-if="all" tone="quiet" size="sm" :aria-label="t('member.seeAllLabel', { count: count(items.length), section: t('member.finished') })" data-testid="member.finishedAll" @click="$emit('all')">
        <span class="figures">{{ t('member.finishedAll', { count: count(items.length) }) }}</span><UiIcon name="chevron" :size="13" />
      </UiButton>
    </div>
    <ul class="flex flex-col">
      <li v-for="item in shown" :key="item.book.id" class="row">
        <FriendsMemberFinishedRow :item="item" :name="name" :member-id="memberId" />
      </li>
    </ul>
  </section>
</template>

<style scoped>
.row + .row {
  border-top: var(--stroke-hairline) solid var(--color-hairline);
}
</style>
