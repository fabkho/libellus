<script setup lang="ts">
// "Want to read" on Home (D's shelf; the key and test ids keep their first name, "upNext"): a short row of covers from Want to read, newest added
// first, with See all leading to the Library. The row scrolls sideways past the
// screen's edge; each cover opens its book page from the touch-down.
import type { LibraryEntry } from '~/data/library'
import { useBookStore } from '~/stores/book'
import type { CircleGroup } from '~/utils/circle'

/** How many covers the row shows: it is a glance, the Library has the rest. */
const SHOWN = 8

const props = defineProps<{ entries: readonly LibraryEntry[]; circle?: Readonly<Record<string, CircleGroup>> }>()

const { t } = useI18n()
const books = useBookStore()
const shown = computed(() => props.entries.slice(0, SHOWN))
</script>

<template>
  <section data-testid="home.upNext">
    <div class="flex h-(--size-touch) items-center justify-between">
      <h2 class="eyebrow">{{ t('home.upNext') }}</h2>
      <NuxtLink
        to="/library"
        class="figures -mr-sm flex min-h-(--size-touch) items-center gap-xxs px-sm text-footnote text-ink-faint hover:text-ink-muted"
        data-testid="home.seeAll"
      >
        {{ t('home.seeAll', { count: entries.length }) }}
        <UiIcon name="chevron" :size="13" />
      </NuxtLink>
    </div>
    <div class="scrollbar-none -mx-screen -mb-lg flex gap-ms overflow-x-auto px-screen pt-sm pb-xl" data-testid="home.upNextRow">
      <div v-for="(entry, index) in shown" :key="entry.id" class="relative shrink-0">
        <UiPressLink
          :to="`/book/${entry.book.id}`"
          :aria-label="entry.book.title"
          class="block"
          data-testid="home.upNextEntry"
          @press="books.prefetch(entry.book.id)"
        >
          <UiCover
            :title="entry.book.title"
            :authors="entry.book.authors"
            :src="coverSrc(entry.book.coverUrl, 'md')"
            :thumbhash="entry.book.coverThumbhash"
            :colors="entry.book.coverColors"
            size="md"
            :eager="index < 5"
          />
        </UiPressLink>
        <!-- Who else wants it (social v2a): beside the cover's link, on its lower edge. -->
        <FriendsCircleAvatars
          v-if="circle?.[entry.book.id]?.members.length"
          :members="circle[entry.book.id]!.members"
          :more="circle[entry.book.id]!.more"
          kind="want"
          testid="home.wantWith"
          class="absolute bottom-0 left-1/2 z-10 flex -translate-x-1/2 translate-y-1/2"
        />
      </div>
    </div>
  </section>
</template>
