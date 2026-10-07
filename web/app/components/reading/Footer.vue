<script setup lang="ts">
// The quiet end of a reading page and a Book card (issue #171): "Libellus — track what you read", the
// waitlist (Libellus is invite-only and the page creates no account, so a visitor leaves her address and
// the owner invites her when there is room: ReadingWaitlist) and a way in for anyone who already has a
// code. `token` is the page's: the database finds whose page it was and keeps nothing of it. Nothing
// about the member goes into it.
defineProps<{ token: string | null }>()

const { t } = useI18n()
</script>

<template>
  <footer class="mt-xxl flex flex-col items-center gap-lg border-t-(length:--stroke-hairline) border-hairline pt-lg pb-xl text-center" data-testid="readingPage.footer">
    <p class="text-caption text-ink-muted">{{ t('readingPage.footer.tagline') }}</p>
    <ReadingWaitlist :token="token" />
    <UiButton tone="plain" size="sm" to="/sign-up" data-testid="readingPage.signUp">{{ t('readingPage.footer.signUp') }}</UiButton>
  </footer>
</template>
