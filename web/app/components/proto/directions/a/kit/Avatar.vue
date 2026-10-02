<script setup lang="ts">
// The account button in a root header: the Member's initials on a warm disc.
import { useProto } from '../../../contract'

const proto = useProto()
</script>

<template>
  <span class="avatar" role="button" aria-label="Account">{{ proto.data.member.initials }}</span>
</template>

<style scoped>
.avatar {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: 999px;
  background: linear-gradient(160deg, #d9c8ad, #b99c74);
  box-shadow:
    inset 0 0 0 0.5px rgb(0 0 0 / 0.1),
    inset 0 1px 0 rgb(255 255 255 / 0.35);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-shadow: 0 0.5px 1px rgb(80 50 20 / 0.3);
}
</style>
