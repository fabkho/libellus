<script setup lang="ts">
// The account avatar: initials in mono inside a hairline ring. 44 px target.
import { useProto } from '../../../contract'

const proto = useProto()
</script>

<template>
  <span class="k-avatar" aria-label="Account">
    <span class="avatar d-mono">{{ proto.data.member.initials }}</span>
  </span>
</template>

<style scoped>
.k-avatar {
  display: flex;
  width: 44px;
  height: 44px;
  margin-right: -6px;
  align-items: center;
  justify-content: center;
}

.avatar {
  display: flex;
  width: 32px;
  height: 32px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: var(--d-fill);
  box-shadow: inset 0 0 0 0.5px var(--d-line-2);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.04em;
  color: var(--d-ink-2);
}
</style>
