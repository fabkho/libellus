<script setup lang="ts">
// sign-in: the cover of the journal. The wordmark set huge with its
// dictionary entry, then the invite-only sign-in: email (filled), Send code
// (a six-digit code by email, no password), and the way in for invitees.
import { useProto } from '../../../contract'
import Button from '../kit/Button.vue'
import Field from '../kit/Field.vue'
import Icon from '../kit/Icon.vue'

const proto = useProto()
</script>

<template>
  <div class="sign-in">
    <header class="cover">
      <p class="b-label kicker"><span>By invitation</span><span>Est. 2026</span></p>
      <div class="b-rule-double" />
      <h1 class="b-display wordmark">Libellus</h1>
      <p class="entry">
        <span class="hw">li·bel·lus</span> <span class="b-italic b-muted">n., Latin.</span> A little book; a
        notebook kept close at hand.
      </p>
    </header>

    <figure class="epigraph">
      <blockquote class="b-display">Cui dono lepidum novum libellum?</blockquote>
      <figcaption>
        <span class="b-italic">To whom shall I give this charming new little book?</span>
        <span class="b-label">Catullus, Carmina I</span>
      </figcaption>
    </figure>

    <main class="form">
      <Field label="Email" :value="proto.data.member.email" />
      <Button><Icon name="mail" :size="20" :stroke="1.4" />Send code</Button>
      <p class="note b-italic">
        We’ll email you a six-digit code to type in here. There is no password.
      </p>
    </main>

    <footer class="foot">
      <hr class="b-rule" />
      <p>Have an invite code? <span class="link">Sign up</span></p>
    </footer>
  </div>
</template>

<style scoped>
.sign-in {
  position: relative;
  display: flex;
  height: 100%;
  flex-direction: column;
  padding: calc(var(--safe-top) + 40px) var(--b-margin) calc(var(--safe-bottom) + 8px);
}

.kicker {
  display: flex;
  justify-content: space-between;
  margin: 0 0 8px;
  font-size: 10px;
  color: var(--b-accent);
}

.wordmark {
  --size: 96;
  margin: 18px 0 0 -4px;
  line-height: 0.9;
  letter-spacing: -0.02em;
}

.entry {
  max-width: 300px;
  margin: 18px 0 0;
  padding-top: 14px;
  border-top: 1px solid var(--b-rule);
  font-size: 17px;
  line-height: 24px;
}

.hw {
  font-weight: 600;
}

.epigraph {
  margin: auto 0 0;
  padding: 0 0 0 16px;
  border-left: 2px solid var(--b-accent);
}

.epigraph blockquote {
  --size: 28;
  margin: 0;
  font-style: italic;
  line-height: 1.05;
}

.epigraph figcaption {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 10px;
  font-size: 15px;
  line-height: 20px;
  color: var(--b-ink-2);
}

.epigraph .b-label {
  font-size: 9.5px;
  color: var(--b-ink-3);
}

.form {
  display: flex;
  flex-direction: column;
  gap: 20px;
  margin-top: auto;
  padding-bottom: 28px;
}

.note {
  margin: -6px 0 0;
  font-size: 15px;
  line-height: 20px;
  color: var(--b-ink-2);
}

.foot p {
  display: flex;
  height: 52px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin: 0;
  font-size: 16px;
  color: var(--b-ink-2);
}

.link {
  display: inline-flex;
  height: 44px;
  align-items: center;
  font-style: italic;
  color: var(--b-accent);
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 4px;
}

hr {
  margin: 0;
}
</style>
