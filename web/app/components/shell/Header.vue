<script setup lang="ts">
// The top of a tab: the page's title on the left — under a mono date eyebrow on
// Home, large on its own elsewhere — and the avatar with its menu on the
// right. The title's test ID is `<screen>.title`.
withDefaults(defineProps<{ screen: string; title: string; size?: 'title' | 'large'; eyebrow?: string }>(), {
  size: 'large',
  eyebrow: undefined,
})
</script>

<template>
  <header class="safe-top relative z-20" data-testid="shell.header">
    <div class="flex justify-between px-screen pt-ms" :class="eyebrow ? 'items-end' : 'items-center'">
      <div class="flex min-w-0 flex-col gap-sm">
        <p v-if="eyebrow" class="eyebrow" :data-testid="`${screen}.date`">{{ eyebrow }}</p>
        <h1 class="truncate" :class="size === 'title' ? 'text-title' : 'text-large-title'" :data-testid="`${screen}.title`">
          {{ title }}
        </h1>
      </div>
      <ShellAvatarMenu />
    </div>
  </header>
</template>
