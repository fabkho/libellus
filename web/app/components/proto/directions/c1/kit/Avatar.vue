<script setup lang="ts">
// The Member's initials on a soft teal disc: the way to account and sign out.
import { useProto } from '../../../contract'

const proto = useProto()
</script>

<template>
  <span class="avatar" aria-label="Account">{{ proto.data.member.initials }}</span>
</template>

<style scoped>
.avatar {
  display: grid;
  flex-shrink: 0;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--c1-teal-soft);
  color: var(--c1-teal);
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.02em;
}
</style>
