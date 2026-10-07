<script setup lang="ts">
// The quiet end of a reading page and a Book card (issue #171): "Libellus —
// track what you read" and Ask for an invite. Libellus is invite-only and the
// page creates no accounts, so the invite is asked of the member herself: the
// button only says how (ask her for a code, then sign up with it, the way
// everyone else came in). Nothing about her goes into it: no address, no
// form; her first name, when she gave one.
defineProps<{ name: string | null }>()

const { t } = useI18n()
const asking = ref(false)
</script>

<template>
  <footer class="mt-xxl flex flex-col items-center gap-sm border-t-(length:--stroke-hairline) border-hairline pt-lg pb-xl text-center" data-testid="readingPage.footer">
    <p class="text-caption text-ink-muted">{{ t('readingPage.footer.tagline') }}</p>
    <UiButton tone="quiet" size="sm" :aria-expanded="asking" aria-controls="reading-invite" data-testid="readingPage.invite" @click="asking = !asking">
      {{ t('readingPage.footer.invite') }}
    </UiButton>
    <div v-show="asking" id="reading-invite" class="flex flex-col items-center gap-sm" data-testid="readingPage.inviteText">
      <p class="text-subhead text-ink-muted">{{ name ? t('readingPage.footer.inviteText', { name }) : t('readingPage.footer.inviteTextNone') }}</p>
      <UiButton tone="secondary" size="sm" to="/sign-up" data-testid="readingPage.signUp">{{ t('readingPage.footer.signUp') }}</UiButton>
    </div>
  </footer>
</template>
