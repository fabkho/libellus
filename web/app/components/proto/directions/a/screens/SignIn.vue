<script setup lang="ts">
// sign-in: invite-only, email + six-digit code (no password). This is the email
// step. A few of Fabian's own covers lie fanned out at the top, so the very
// first screen already looks like his shelf.
import { computed } from 'vue'
import { useProto } from '../../../contract'
import Cover from '../kit/Cover.vue'
import FormGroup from '../kit/FormGroup.vue'
import FormRow from '../kit/FormRow.vue'
import Icon from '../kit/Icon.vue'
import Pill from '../kit/Pill.vue'

const proto = useProto()
const fan = computed(() =>
  ['roadside-picnic', 'hyperion', 'dune', 'stoner', 'project-hail-mary'].map((id) => proto.value.data.entry(id).book),
)
const tilt = [-14, -7, 0, 7, 14]
const lift = [34, 10, 0, 10, 34]
</script>

<template>
  <div class="screen">
    <div class="glow" aria-hidden="true" />

    <div class="fan" aria-hidden="true">
      <span
        v-for="(book, i) in fan"
        :key="book.id"
        class="fan-item"
        :style="{ '--x': `${(i - 2) * 64}px`, '--r': `${tilt[i]}deg`, '--y': `${lift[i]}px`, zIndex: i === 2 ? 5 : 4 - Math.abs(i - 2) }"
      >
        <Cover :book="book" :height="i === 2 ? 190 : 164" :shadow="i === 2 ? 'lift' : 'soft'" />
      </span>
    </div>

    <div class="brand">
      <h1 class="wordmark a-serif">Libellus</h1>
      <p class="tagline">Every book you read, in one quiet place.</p>
    </div>

    <div class="form">
      <FormGroup>
        <FormRow label="Email" :value="proto.data.member.email" stacked focus />
      </FormGroup>
      <Pill block>Send code</Pill>
      <p class="note"><Icon name="mail" :size="16" :stroke="1.8" />We’ll email you a six-digit code. No password.</p>
    </div>

    <p class="invite">Have an invite code? <span class="link">Sign up</span></p>
  </div>
</template>

<style scoped>
.screen {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  padding: 0 24px calc(var(--safe-bottom) + 18px);
}

.glow {
  position: absolute;
  inset: 0 0 auto;
  height: 420px;
  background:
    radial-gradient(60% 60% at 30% 20%, color-mix(in oklab, #eaac4b 30%, var(--a-paper)), transparent 70%),
    radial-gradient(55% 55% at 78% 30%, color-mix(in oklab, #10b7d5 16%, var(--a-paper)), transparent 70%);
  opacity: 0.9;
}

.fan {
  position: relative;
  height: 286px;
  margin-top: calc(var(--safe-top) + 30px);
}

.fan-item {
  position: absolute;
  top: 18px;
  left: 50%;
  transform: translateX(calc(-50% + var(--x))) translateY(var(--y)) rotate(var(--r));
  transform-origin: 50% 120%;
}

.brand {
  position: relative;
  text-align: center;
}

.wordmark {
  margin: 0;
  font-size: 46px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: -0.02em;
}

.tagline {
  margin: 10px 0 0;
  color: var(--a-ink-2);
  font-size: 16px;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 36px;
}

.note {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin: 2px 0 0;
  color: var(--a-ink-2);
  font-size: 13.5px;
}

.invite {
  margin: auto 0 0;
  color: var(--a-ink-2);
  font-size: 15px;
  text-align: center;
}

.link {
  color: var(--a-accent);
  font-weight: 600;
}
</style>
