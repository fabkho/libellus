<script setup lang="ts">
// sign-in: invite-only, email + six-digit code, no password. A short shelf
// of Fabian's own books (spines in their covers' colours) greets you — the
// app in one picture — then the wordmark and the email step.
import { computed } from 'vue'
import Button from '../kit/Button.vue'
import Field from '../kit/Field.vue'
import Icon from '../kit/Icon.vue'
import Plank from '../kit/Plank.vue'
import Spine from '../kit/Spine.vue'
import { useShelf } from '../kit/useShelf'

const { data } = useShelf()

const books = computed(() =>
  ['stoner', 'hyperion', 'dune', 'project-hail-mary', 'roadside-picnic', 'flowers-for-algernon', 'word-for-world', 'ubik', 'carpet-makers'].map(
    (id) => data.value.entry(id).book,
  ),
)
</script>

<template>
  <div class="screen c1-paper-grain">
    <div class="shelf-art" aria-hidden="true">
      <Plank :gap="2" :inset="24" bookend>
        <Spine v-for="book in books" :key="book.id" :book="book" :scale="0.86" />
      </Plank>
    </div>

    <div class="brand">
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

.brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding-top: 30px;
  text-align: center;
}

.wordmark {
  margin: 10px 0 0;
  font-family: var(--c1-serif);
  font-weight: var(--c1-serif-weight);
  font-size: 44px;
  line-height: 1;
}

.tagline {
  margin: 6px 0 0;
  font-size: 16px;
  color: var(--c1-ink-soft);
}

.form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 26px 24px 0;
}

h1 {
  margin: 0 0 -2px;
  font-family: var(--c1-serif);
  font-size: 24px;
  font-weight: var(--c1-serif-weight);
}

.mail {
  color: var(--c1-ink-soft);
}

.hint {
  margin: 0;
  font-size: 14px;
  text-align: center;
  color: var(--c1-ink-soft);
}

.invite {
  margin: auto 0 0;
  font-size: 16px;
  text-align: center;
  color: var(--c1-ink-soft);
}

.invite b {
  color: var(--c1-accent-deep);
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
}

[data-theme='dark'] .invite b {
  color: var(--c1-accent);
}
</style>
