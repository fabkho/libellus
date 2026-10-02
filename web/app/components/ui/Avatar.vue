<script setup lang="ts">
// The member's initials in mono inside a hairline ring. Drawing only: the
// header's button around it is the 44 px target and carries the label.
defineProps<{ initials: string }>()
</script>

<template>
  <span
    class="flex size-(--size-avatar) items-center justify-center rounded-pill bg-fill edge figures text-meta font-medium text-ink-muted"
    aria-hidden="true"
  >
    {{ initials }}
  </span>
</template>
