<script setup lang="ts">
// Design round #65: the book page as it is (pages/book/[key].vue) — the
// cover's light, the top bar, the hero, the status line — with each
// direction's progress block in the default slot, then Finish / Abandon and
// About. A finished read shows its stars and day instead.
import { dayMonth, type ProtoRead } from './model'

const props = defineProps<{ read: ProtoRead }>()
defineEmits<{ back: []; finish: [] }>()

const { t } = useI18n()
const { formatDay, dayOfRead } = useDays()
const book = computed(() => props.read.book)
const authorLine = computed(() => formatAuthors(book.value.authors, t('common.etAl')))
const facts = computed(() =>
  [
    String(book.value.year),
    book.value.pageCount ? t('book.pages', { count: book.value.pageCount }) : null,
    book.value.format === 'ebook' ? 'ebook' : null,
    book.value.publisher,
  ].filter(Boolean),
)
const since = computed(() => t('book.since', { date: formatDay(props.read.startedOn), day: dayOfRead(props.read.startedOn) }))
</script>

<template>
  <div class="relative min-h-dvh clear-tab-bar">
    <UiAmbient :colors="book.coverColors" />
    <UiTopBar :back-label="t('book.back')" back-testid="book.back" @back="$emit('back')">
      <template #trailing>
        <UiRoundButton icon="more" :label="t('book.options')" />
      </template>
    </UiTopBar>

    <section class="relative flex flex-col items-center px-xl pt-sm text-center">
      <UiCover
        :title="book.title"
        :authors="book.authors"
        :src="coverSrc(book.coverUrl, 'xl')"
        :thumbhash="book.coverThumbhash"
        :colors="book.coverColors"
        size="xl"
        glow
        eager
      />
      <h1 class="book-title mt-ml line-clamp-3 text-headline text-balance">{{ book.title }}</h1>
      <p class="mt-xs text-body text-ink-muted">{{ authorLine }}</p>
      <p class="eyebrow mt-sm flex items-center gap-sm">
        <template v-for="(fact, i) in facts" :key="fact!">
          <span v-if="i" class="dot" aria-hidden="true" />{{ fact }}
        </template>
      </p>
    </section>

    <div class="relative px-ml">
      <p class="mt-ms mb-md flex min-h-(--size-star) flex-wrap items-center justify-center gap-sm text-caption">
        <template v-if="read.finished">
          <UiStars v-if="read.rating" :quarters="read.rating" size="md" />
          <span>{{ t('status.finished') }}</span>
          <span class="dot text-ink-ghost" aria-hidden="true" />
          <span class="figures text-meta text-ink-faint">{{ dayMonth(read.log.at(-1)?.day ?? read.startedOn) }}</span>
        </template>
        <template v-else>
          <span class="lamp" aria-hidden="true" />
          <span>{{ t('status.reading') }}</span>
          <span class="dot text-ink-ghost" aria-hidden="true" />
          <span class="figures text-meta text-ink-faint">{{ since }}</span>
        </template>
      </p>

      <template v-if="!read.finished">
        <slot />
        <slot name="actions">
          <div class="flex gap-ms">
            <UiButton class="flex-1" data-testid="book.finish" @click="$emit('finish')">
              <UiIcon name="check" :size="18" bold />{{ t('book.finish') }}
            </UiButton>
            <UiButton tone="secondary">{{ t('book.abandon') }}</UiButton>
          </div>
        </slot>
      </template>
      <UiButton v-else tone="quiet" block><UiIcon name="repeat" :size="18" />{{ t('book.readAgain') }}</UiButton>
    </div>

    <slot name="below" />

    <section class="relative px-ml pt-xl">
      <h2 class="eyebrow mb-ms">{{ t('book.about') }}</h2>
      <p class="text-subhead text-ink-muted">{{ book.description }}</p>
    </section>
  </div>
  <ProtoProgressTabBar current="none" />
</template>

<style scoped>
.dot {
  width: var(--spacing-xxs);
  height: var(--spacing-xxs);
  border-radius: var(--radius-pill);
  background: currentColor;
}
.lamp {
  width: var(--spacing-sm);
  height: var(--spacing-sm);
  border-radius: var(--radius-pill);
  background: var(--color-accent);
  box-shadow: 0 0 var(--spacing-ms) var(--spacing-xxs) color-mix(in srgb, var(--color-accent) 50%, transparent);
}
</style>
