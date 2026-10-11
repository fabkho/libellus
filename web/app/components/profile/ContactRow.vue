<script setup lang="ts">
// Contact, at the very bottom of the Profile, under the Account (one line in pages/profile/index.vue):
// a quiet row that opens the Contact sheet (ContactSheet.vue), where she writes a bug, a feature request
// or something else to the owner. The owner's account has a second row, Feedback, which opens the inbox
// (pages/profile/feedback.vue) with how many messages are open as its value; for everyone else it is not
// there and nothing is asked of the server (stores/feedback.ts).
import { useFeedbackStore } from '~/stores/feedback'

const { t } = useI18n()
const store = useFeedbackStore()
const contacting = ref(false)
onMounted(() => void store.load())
</script>

<template>
  <section class="flex flex-col pt-md pb-lg" data-testid="profile.contactSection">
    <UiRowGroup>
      <UiRow as="button" icon="pencil" :label="t('contact.row')" chevron data-testid="profile.contact" @click="contacting = true" />
      <UiRow v-if="store.isOwner" to="/profile/feedback" icon="mail" :label="t('feedback.row')" chevron data-testid="profile.feedback">
        <span v-if="store.openCount" class="figures text-ink-muted" data-testid="profile.feedbackValue">{{ t('feedback.rowValue', { count: store.openCount }) }}</span>
        <span v-else-if="store.openCount !== null" class="text-ink-faint" data-testid="profile.feedbackValue">{{ t('feedback.rowNone') }}</span>
      </UiRow>
    </UiRowGroup>
    <ProfileContactSheet v-model:open="contacting" />
  </section>
</template>
