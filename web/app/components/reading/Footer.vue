<script setup lang="ts">
// The quiet end of a reading page and a Book card (issue #171): the waitlist (BetterReads is invite-only and
// the page creates no account, so a visitor leaves her address and the owner invites her when there is room:
// ReadingWaitlist) and nothing else — the heading, the subheading, the field and the button are the section.
// `token` is the page's: the database finds whose page it was and keeps nothing of it. Nothing about the
// member goes into it.
defineProps<{ token: string | null }>()
</script>

<template>
  <footer class="mt-xxl flex flex-col items-center border-t-(length:--stroke-hairline) border-hairline pt-lg pb-xl text-center" data-testid="readingPage.footer">
    <ReadingWaitlist :token="token" />
  </footer>
</template>
