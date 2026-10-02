<script setup lang="ts">
// The Member's monogram: initials in the display italic inside a hairline
// circle, on a 44 pt target. Opens the account sheet in the app.
import { useProto } from '../../../contract'

const proto = useProto()
</script>

<template>
  <span class="avatar" aria-label="Account">
    <span class="ring b-display b-italic">{{ proto.data.member.initials }}</span>
  </span>
</template>

<style scoped>
.avatar {
  display: inline-flex;
  width: 44px;
  height: 44px;
  align-items: center;
  justify-content: center;
}

.ring {
  --size: 17;
  display: flex;
  width: 34px;
  height: 34px;
  align-items: center;
  justify-content: center;
  padding-top: 1px;
  border: 1px solid var(--b-ink);
  border-radius: 50%;
  letter-spacing: 0.02em;
}
</style>
