<script setup lang="ts">
// The import offer on Home: a member coming from Goodreads or Hardcover finds the way in
// where she looks first, not only behind Profile → Import books. A quiet card (the install
// hint's family), never a pop-up. On the empty Home it is whole: the line and the action.
// Over a few entries it is smaller and has a × that hides it for good on this device
// (utils/importHint.ts has the rules, composables/useImportOffer.ts decides from the
// Library the device holds, so it is in the first frame or not there at all).
const { t } = useI18n()
const { offer, refresh, dismiss } = useImportOffer()

// The card keeps its shape while it closes (a dismissed × does not vanish before the card does).
const size = ref<'full' | 'small'>(offer.value === 'small' ? 'small' : 'full')
watch(offer, (now) => {
  if (now !== 'none') size.value = now
})

onMounted(refresh)
onActivated(refresh)
</script>

<template>
  <UiReveal :show="offer !== 'none'">
    <section
      class="flex items-start gap-ms rounded-md bg-fill edge-faint"
      :class="size === 'small' ? 'py-ms pr-xs pl-inset' : 'p-inset'"
      :aria-label="t('home.importOffer.title')"
      data-testid="home.importOffer"
    >
      <div class="flex min-w-0 flex-1 flex-col gap-ms" :class="size === 'small' ? 'py-xs' : ''">
        <div class="flex flex-col gap-xxs">
          <h2 class="text-body text-ink" data-testid="home.importOfferTitle">{{ t('home.importOffer.title') }}</h2>
          <p class="text-subhead text-ink-muted" data-testid="home.importOfferText">{{ t('home.importOffer.text') }}</p>
        </div>
        <div>
          <UiButton to="/import" :size="size === 'small' ? 'sm' : 'md'" data-testid="home.importOfferAction">{{ t('home.importOffer.action') }}</UiButton>
        </div>
      </div>

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
