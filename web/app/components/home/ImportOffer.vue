<script setup lang="ts">
// The import offer on Home: a member coming from Goodreads or Hardcover finds the way in
// where she looks first, not only behind Profile → Import books. One tappable row like the
// Profile's (the import icon in a ring, the line, a chevron), never a pop-up. On the empty
// Home it says what comes along; over a few entries it is shorter and has a × that hides it
// for good on this device (utils/importHint.ts has the rules, composables/useImportOffer.ts
// decides from the Library the device holds, so it is in the first frame or not there at all).
const { t } = useI18n()
const { offer, refresh, dismiss } = useImportOffer()

// The row keeps its shape while it closes (a dismissed × does not vanish before the row does).
const size = ref<'full' | 'small'>(offer.value === 'small' ? 'small' : 'full')
watch(offer, (now) => {
  if (now !== 'none') size.value = now
})

onMounted(refresh)
onActivated(refresh)
</script>

<template>
  <UiReveal :show="offer !== 'none'">
    <section class="flex items-center rounded-md bg-fill edge-faint" :aria-label="t('home.importOffer.title')" data-testid="home.importOffer">
      <NuxtLink
        to="/import"
        class="flex min-h-(--size-row) min-w-0 flex-1 items-center gap-ms py-ms pl-inset active:bg-fill-strong"
        :class="size === 'small' ? 'pr-xs' : 'pr-inset'"
        data-testid="home.importOfferAction"
      >
        <span class="flex size-(--size-button-md) shrink-0 items-center justify-center rounded-pill text-ink-muted edge" aria-hidden="true">
          <UiIcon name="import" :size="18" />
        </span>
        <span class="flex min-w-0 flex-1 flex-col gap-xxs">
          <h2 class="text-body text-ink" data-testid="home.importOfferTitle">{{ t('home.importOffer.title') }}</h2>
          <span class="text-caption text-ink-faint" data-testid="home.importOfferText">{{ size === 'small' ? t('home.importOffer.action') : t('home.importOffer.text') }}</span>
        </span>
        <UiIcon name="chevron" :size="15" bold class="shrink-0 text-ink-ghost" />
      </NuxtLink>
      <button
        v-if="size === 'small'"
        type="button"
        :aria-label="t('home.importOffer.dismiss')"
        class="flex size-(--size-touch) shrink-0 items-center justify-center text-ink-faint active:text-ink"
        data-testid="home.importOfferDismiss"
        @click="dismiss"
      >
        <UiIcon name="close" :size="18" />
      </button>
    </section>
  </UiReveal>
</template>
