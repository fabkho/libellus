<script setup lang="ts">
const { t } = useI18n()

// The document title comes out of the message file like every other string.
useHead({ title: () => t('app.name') })
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
