<script setup lang="ts">
// Top of a screen. Root tabs: large title + the account avatar. Pushed
// screens: back label on the left, optional inline title, trailing slot.
import { useProto } from '../../../contract'
import Icon from './Icon.vue'

defineProps<{ title?: string; back?: string; avatar?: boolean }>()
const proto = useProto()
</script>

<template>
  <header class="shrink-0 px-5 pt-[var(--safe-top)]">
    <div class="flex h-11 items-center justify-between gap-2">
      <span v-if="back" class="-ml-2 flex items-center text-[16px] text-neutral-600">
        <Icon name="back" />{{ back }}
      </span>
      <span v-else />
      <slot name="trailing">
        <span
          v-if="avatar"
          class="flex size-9 items-center justify-center rounded-full bg-neutral-300 text-[13px] font-semibold text-neutral-700"
          >{{ proto.data.member.initials }}</span
        >
      </slot>
    </div>
    <h1 v-if="title" class="pb-2 text-[30px] leading-tight font-bold tracking-tight">{{ title }}</h1>
  </header>
</template>
