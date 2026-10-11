<script setup lang="ts">
import { IMPRINT_ENABLED } from '~/legal/config'

// `/imprint`: public, no sign-in needed (utils/publicPath.ts) once the imprint is on. While it is postponed
// (legal/config.ts) the address does not exist: `validate` fails, the same 404 as any unknown address.
// The text and its page: components/legal/Page.vue.
definePageMeta({ validate: () => IMPRINT_ENABLED })
</script>

<template>
  <LegalPage page="imprint" />
</template>
