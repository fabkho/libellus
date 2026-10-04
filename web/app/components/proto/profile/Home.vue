<script setup lang="ts">
// Design round #78: Home as it is (ShellHeader's layout, Currently reading with
// the sparkline and pace of #68, the tally, Up next) on the stub library, so
// each direction can show where it starts from. `avatar`: today's avatar
// (`menu`, it opens the menu), one that opens a page (`link`), or none (A: the
// account moved into its own tab). `tally` slot: what a direction adds under
// the tally.
import { THIS_YEAR, MEMBER, currentReads, finishedIn, wantToRead } from './model'

withDefaults(defineProps<{ avatar?: 'menu' | 'link' | 'none' }>(), { avatar: 'menu' })
defineEmits<{ avatar: [] }>()

const { t, locale } = useI18n()
const { greeting } = useGreeting()
const date = computed(() => t('home.today', dateParts(new Date(), locale.value)))
const readIn = finishedIn(THIS_YEAR).length
</script>

<template>
  <header class="bar-top relative z-20 px-screen">
    <div class="flex h-(--size-touch) items-center justify-end">
      <button
        v-if="avatar !== 'none'"
        type="button"
        class="-mr-sm flex size-(--size-touch) items-center justify-center"
        :aria-label="avatar === 'link' ? 'You' : 'Account'"
        data-testid="proto.avatar"
        @click="$emit('avatar')"
      >
        <UiAvatar :initials="MEMBER.initials" />
      </button>
    </div>
    <div class="flex min-w-0 flex-col gap-sm py-bar">
      <p class="eyebrow">{{ date }}</p>
      <h1 class="truncate text-title">{{ greeting }}</h1>
    </div>
    <slot name="menu" />
  </header>

  <main class="clear-tab-bar flex flex-col gap-lg px-screen pt-lg">
    <section>
      <div class="flex h-(--size-touch) items-center justify-between">
        <h2 class="eyebrow">{{ t('home.reading') }}</h2>
        <span class="eyebrow text-ink-ghost">{{ currentReads.length }}</span>
      </div>
      <div class="flex flex-col gap-ms">
        <ProtoProfileReadingCard v-for="(read, i) in currentReads" :key="read.id" :read="read" :eager="i < 2" />
      </div>
    </section>

    <div id="tally" class="flex flex-col gap-xs">
      <HomeTally :year="THIS_YEAR" :count="readIn" />
      <slot name="tally" />
    </div>

    <section>
      <div class="flex h-(--size-touch) items-center justify-between">
        <h2 class="eyebrow">{{ t('home.upNext') }}</h2>
        <span class="figures flex items-center gap-xxs text-footnote text-ink-faint">
          {{ t('home.seeAll', { count: wantToRead.length }) }}<UiIcon name="chevron" :size="13" />
        </span>
      </div>
      <div class="-mx-screen flex gap-ms overflow-x-auto px-screen pt-sm pb-xl">
        <UiCover
          v-for="(w, i) in wantToRead.slice(0, 8)"
          :key="w.book.key"
          class="shrink-0"
          :title="w.book.title"
          :authors="w.book.authors"
          :src="coverSrc(w.book.cover, 'md')"
          :thumbhash="w.book.thumbhash"
          :colors="w.book.colors"
          size="md"
          :eager="i < 5"
        />
      </div>
    </section>
  </main>
</template>
