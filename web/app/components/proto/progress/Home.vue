<script setup lang="ts">
// Design round #65: Home as it is (ShellHeader's layout, Currently reading,
// the tally, the tab bar), with each direction's reading card in the slot.
// Finished reads leave the list the way UiListMotion lets them.
import type { ProtoRead } from './model'

defineProps<{ reads: ProtoRead[] }>()

const { t, locale } = useI18n()
const { greeting } = useGreeting()
const date = computed(() => t('home.today', dateParts(new Date(), locale.value)))
</script>

<template>
  <header class="bar-top relative z-20 px-screen">
    <div class="flex h-(--size-touch) items-center justify-end">
      <span class="flex size-(--size-touch) items-center justify-end"><UiAvatar initials="FK" /></span>
    </div>
    <div class="flex min-w-0 flex-col gap-sm py-bar">
      <p class="eyebrow">{{ date }}</p>
      <h1 class="truncate text-title">{{ greeting }}</h1>
    </div>
  </header>

  <main class="clear-tab-bar flex flex-col gap-lg px-screen pt-lg">
    <section>
      <div class="flex h-(--size-touch) items-center justify-between">
        <h2 class="eyebrow">{{ t('home.reading') }}</h2>
        <span class="eyebrow text-ink-ghost">{{ reads.filter((r) => !r.finished).length }}</span>
      </div>
      <UiListMotion class="flex flex-col gap-ms">
        <div v-for="read in reads.filter((r) => !r.finished)" :key="read.book.key">
          <slot name="card" :read="read" :index="reads.indexOf(read)" />
        </div>
      </UiListMotion>
    </section>

    <HomeTally :year="new Date().getFullYear()" :count="reads.filter((r) => r.finished).length + 23" />
  </main>

  <ProtoProgressTabBar />
  <slot />
</template>
