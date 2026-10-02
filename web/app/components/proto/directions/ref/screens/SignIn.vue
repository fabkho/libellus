<script setup lang="ts">
// sign-in: invite-only, email + six-digit code (no password). This is the email
// step; the code step looks the same with six digit cells instead of the field.
import { useProto } from '../../../contract'
import Button from '../kit/Button.vue'
import Field from '../kit/Field.vue'
import Note from '../kit/Note.vue'

const proto = useProto()
</script>

<template>
  <div class="flex h-full flex-col bg-white px-6 pt-[calc(var(--safe-top)+56px)] pb-[calc(var(--safe-bottom)+20px)]">
    <div class="flex flex-col items-center gap-3 text-center">
      <span
        class="flex size-16 items-center justify-center rounded-2xl border-2 border-dashed border-neutral-400 text-[11px] text-neutral-500"
        >Logo</span
      >
      <p class="text-[32px] font-bold tracking-tight">Libellus</p>
      <p class="text-[16px] text-neutral-600">Find a book, add it, start it, finish it.</p>
    </div>

    <div class="mt-12 flex flex-col gap-4">
      <h1 class="text-[22px] font-semibold">Sign in</h1>
      <Field label="Email" :value="proto.data.member.email" focus />
      <Button>Send code</Button>
      <p class="text-[13px] text-neutral-500">We'll email you a six-digit code. No password.</p>
      <Note>Next step: six code cells, "Resend code", the email shown with "Change".</Note>
    </div>

    <p class="mt-auto text-center text-[15px] text-neutral-600">
      Have an invite code? <span class="font-semibold text-neutral-900 underline">Sign up</span>
    </p>
  </div>
</template>
