<script setup lang="ts">
const { t } = useI18n()

// The document title comes out of the message file like every other string.
useHead({ title: () => t('app.name') })
</script>

<template>
  <!-- A screen reader hears the new page's title after each navigation (a SPA's pages change
       without a page load, so nothing else says so; TalkBack stayed silent on the old place). -->
  <NuxtRouteAnnouncer />
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
