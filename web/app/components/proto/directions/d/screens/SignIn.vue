<script setup lang="ts">
// sign-in: the shelf in the dark, a lamp over it, and the invite-only email
// step. No password: a six-digit code arrives by email.
import { computed } from 'vue'
import { useProto } from '../../../contract'
import Button from '../kit/Button.vue'
import Cover from '../kit/Cover.vue'
import Icon from '../kit/Icon.vue'

const proto = useProto()
/** A dim wall of covers behind the wordmark: every Library book with a cover. */
const wall = computed(() => proto.value.data.library.filter((e) => e.book.coverUrl).slice(0, 20))
</script>

<template>
  <div class="page">
    <div class="wall" aria-hidden="true">
      <Cover v-for="entry in wall" :key="entry.id" :book="entry.book" :width="86" />
    </div>
    <div class="veil" aria-hidden="true" />

    <div class="brand">
      <p class="wordmark">libellus</p>
      <p class="tagline">The books you read, kept quietly.</p>
    </div>

    <div class="form">
      <p class="d-eyebrow">Sign in</p>
      <label class="field">
        <span class="field-label">Email</span>
        <span class="field-value">{{ proto.data.member.email }}<span class="d-caret" /></span>
      </label>
      <Button block>Send code</Button>
      <p class="hint"><Icon name="mail" :size="16" />We’ll email you a six-digit code. No password.</p>
    </div>

    <p class="invite">Have an invite code? <span class="link">Sign up</span></p>
  </div>
</template>

<style scoped>
.page {
  position: relative;
  display: flex;
  height: 100%;
  flex-direction: column;
  overflow: hidden;
  padding: 0 28px calc(var(--safe-bottom) + 14px);
  background: var(--d-bg);
}

.wall {
  position: absolute;
  top: -40px;
  left: -70px;
  display: grid;
  grid-template-columns: repeat(5, 86px);
  gap: 14px;
  opacity: 0.5;
  transform: rotate(-9deg);
  transform-origin: 0 0;
}

.veil {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(60% 34% at 50% 34%, rgb(239 183 104 / 0.18), transparent 70%),
    linear-gradient(to bottom, rgb(14 12 10 / 0.7) 0%, rgb(14 12 10 / 0.2) 11%, rgb(14 12 10 / 0.72) 26%, rgb(14 12 10 / 0.94) 38%, var(--d-bg) 48%);
}

[data-theme='day'] .veil {
  background:
    radial-gradient(60% 34% at 50% 34%, rgb(255 255 255 / 0.5), transparent 70%),
    linear-gradient(to bottom, rgb(244 240 233 / 0.75) 0%, rgb(244 240 233 / 0.3) 11%, rgb(244 240 233 / 0.78) 26%, var(--d-bg) 48%);
}

.brand {
  position: relative;
  margin-top: 318px;
  text-align: center;
}

.wordmark {
  font-family: var(--d-serif);
  font-size: 54px;
  font-style: italic;
  font-weight: 400;
  line-height: 1;
  letter-spacing: -0.02em;
}

.tagline {
  margin-top: 12px;
  font-size: 15px;
  color: var(--d-ink-2);
}

.form {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 46px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--d-lamp);
}

.field-label {
  font-size: 12.5px;
  color: var(--d-ink-3);
}

.field-value {
  font-size: 19px;
  letter-spacing: -0.015em;
}

.hint {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  font-size: 13px;
  color: var(--d-ink-3);
}

.invite {
  position: relative;
  margin-top: auto;
  text-align: center;
  font-size: 14px;
  color: var(--d-ink-3);
}

.link {
  color: var(--d-ink);
  text-decoration: underline;
  text-decoration-color: var(--d-ink-4);
  text-underline-offset: 4px;
}
</style>
