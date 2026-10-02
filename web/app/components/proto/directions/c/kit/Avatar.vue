<script setup lang="ts">
// The Member's initials on a mustard disc: the way to account and sign out.
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
  background: var(--c-teal);
  color: #fffaf2;
  font-size: 15px;
  font-weight: 800;
  letter-spacing: 0.02em;
  box-shadow:
    inset 0 -3px 0 rgb(0 0 0 / 0.14),
    0 0 0 3px var(--c-paper),
    0 0 0 4.5px var(--c-line-strong);
}
</style>
