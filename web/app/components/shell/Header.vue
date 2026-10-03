<script setup lang="ts">
// The top of a tab, laid out as iOS's Large Title bar: under the safe area a
// 44 pt controls row holding only the avatar with its menu at the trailing
// edge, then the title block `bar` (10) below it and `bar` above the page —
// a mono date eyebrow over the greeting on Home, a large title elsewhere. The
// pushed screens with a large title (Collections, Import) put theirs on the
// same row under their UiTopBar. The title's test ID is `<screen>.title`.
withDefaults(defineProps<{ screen: string; title: string; size?: 'title' | 'large'; eyebrow?: string }>(), {
  size: 'large',
  eyebrow: undefined,
})
</script>

<template>
  <header class="safe-top relative z-20 px-screen" data-testid="shell.header">
    <div class="flex h-(--size-touch) items-center justify-end">
      <ShellAvatarMenu />
    </div>
    <div class="flex min-w-0 flex-col gap-sm py-bar">
      <p v-if="eyebrow" class="eyebrow" :data-testid="`${screen}.date`">{{ eyebrow }}</p>
      <h1 class="truncate" :class="size === 'title' ? 'text-title' : 'text-large-title'" :data-testid="`${screen}.title`">
        {{ title }}
      </h1>
    </div>
  </header>
</template>
