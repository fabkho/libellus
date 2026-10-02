<script setup lang="ts">
// sign-in: invite-only, email + six-digit code, no password. A shelf of
// chunky, colourful spines greets you — the app in one picture — then the
// wordmark and the email step.
import Button from '../kit/Button.vue'
import Field from '../kit/Field.vue'
import Icon from '../kit/Icon.vue'
import Logo from '../kit/Logo.vue'
import Plank from '../kit/Plank.vue'
import { useShelf } from '../kit/useShelf'

const { data } = useShelf()

/** Decorative spines in the room's colours: [colour var, width, height, lean, title]. */
const spines: [string, number, number, number, string][] = [
  ['--c-teal', 34, 150, 0, ''],
  ['--c-accent', 44, 176, 0, 'Libellus'],
  ['--c-mustard', 28, 138, 0, ''],
  ['--c-plum', 38, 162, 0, ''],
  ['--c-ink', 30, 146, 0, ''],
  ['--c-teal', 42, 128, 0, ''],
  ['--c-wood-dark', 30, 154, 0, ''],
  ['--c-accent', 26, 140, -10, ''],
]
</script>

<template>
  <div class="screen c-paper-grain">
    <div class="shelf-art" aria-hidden="true">
      <Plank :gap="3" :inset="22" bookend>
        <span
          v-for="([color, w, h, lean, title], i) in spines"
          :key="i"
          class="deco"
          :class="{ leaning: lean }"
          :style="{ background: `var(${color})`, width: `${w}px`, height: `${h}px`, transform: lean ? `rotate(${lean}deg)` : undefined }"
        >
          <span class="band" />
          <span v-if="title" class="deco-title">{{ title }}</span>
          <span class="band low" />
        </span>
      </Plank>
    </div>

    <div class="brand">
      <Logo :size="56" />
      <p class="wordmark">Libellus</p>
      <p class="tagline">Find a book, add it, start it, finish it.</p>
    </div>

    <div class="form">
      <h1>Sign in</h1>
      <Field label="Email" :value="data.member.email" focus>
        <template #leading><Icon name="mail" :size="20" class="mail" /></template>
      </Field>
      <Button>Send code</Button>
      <p class="hint">We'll email you a six-digit code. No password.</p>
    </div>

    <p class="invite">Have an invite code? <b>Sign up</b></p>
  </div>
</template>

<style scoped>
.screen {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  padding-bottom: calc(var(--safe-bottom) + 18px);
}

.shelf-art {
  padding-top: calc(var(--safe-top) + 16px);
}

.deco {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  flex-shrink: 0;
  padding: 10px 0;
  border-radius: 5px 5px 3px 3px;
  box-shadow: inset -5px 0 0 rgb(0 0 0 / 0.14), inset 3px 0 0 rgb(255 255 255 / 0.14);
}

.deco.leaning {
  margin-left: 22px;
  transform-origin: bottom left;
}

.band {
  width: 100%;
  height: 7px;
  border-top: 2px solid rgb(255 255 255 / 0.45);
  border-bottom: 2px solid rgb(255 255 255 / 0.45);
}

.band.low {
  margin-top: auto;
}

.deco-title {
  margin-top: 12px;
  writing-mode: vertical-rl;
  font-family: var(--c-serif);
  font-size: 17px;
  color: #fffaf2;
}

.brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding-top: 22px;
  text-align: center;
}

.wordmark {
  margin: 10px 0 0;
  font-family: var(--c-serif);
  font-size: 44px;
  line-height: 1;
}

.tagline {
  margin: 6px 0 0;
  font-size: 16px;
  color: var(--c-ink-soft);
}

.form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 26px 24px 0;
}

h1 {
  margin: 0 0 -2px;
  font-family: var(--c-serif);
  font-size: 24px;
  font-weight: 400;
}

.mail {
  color: var(--c-ink-soft);
}

.hint {
  margin: 0;
  font-size: 14px;
  text-align: center;
  color: var(--c-ink-soft);
}

.invite {
  margin: auto 0 0;
  font-size: 16px;
  text-align: center;
  color: var(--c-ink-soft);
}

.invite b {
  color: var(--c-accent-deep);
  text-decoration: underline;
  text-decoration-thickness: 2px;
  text-underline-offset: 3px;
}

[data-palette='ink'] .invite b {
  color: var(--c-accent);
}
</style>
