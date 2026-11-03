<script setup lang="ts">
const { t, locale } = useI18n()

// The document title comes out of the message file like every other string; <html lang> is the language on screen.
useHead({ title: () => t('app.name'), htmlAttrs: { lang: () => locale.value } })
</script>

<template>
  <!-- A screen reader hears the new page's title after each navigation (a SPA's pages change
       without a page load, so nothing else says so; TalkBack stayed silent on the old place). -->
  <NuxtRouteAnnouncer />
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
