<script setup lang="ts">
// Pills. `primary` is lit (ink on the dark room), `quiet` a translucent fill,
// `line` a hairline outline, `plain` text only. Sizes keep a 44 px target.
withDefaults(
  defineProps<{ tone?: 'primary' | 'quiet' | 'line' | 'plain' | 'danger'; size?: 'lg' | 'md' | 'sm'; block?: boolean }>(),
  { tone: 'primary', size: 'lg', block: false },
)
</script>

<template>
  <span class="k-button" :class="[`k-${tone}`, `k-${size}`, { 'k-block': block }]" role="button">
    <slot />
  </span>
</template>

<style scoped>
.k-button {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border-radius: 999px;
  font-weight: 500;
  letter-spacing: -0.01em;
  white-space: nowrap;
}

/* The touch target never shrinks below 44 px, whatever the drawn size. */
.k-button::after {
  position: absolute;
  inset: 50% 0 auto;
  height: 44px;
  min-width: 44px;
  content: '';
  transform: translateY(-50%);
}

.k-block {
  display: flex;
  width: 100%;
}

.k-lg {
  height: 50px;
  padding: 0 22px;
  font-size: 16px;
}

.k-md {
  height: 40px;
  padding: 0 18px;
  font-size: 14.5px;
}

.k-sm {
  height: 32px;
  padding: 0 14px;
  font-size: 13px;
}

.k-primary {
  background: var(--dl-ink);
  color: var(--dl-on-ink);
  box-shadow: 0 6px 18px rgb(0 0 0 / 0.25);
}

.k-quiet {
  background: var(--dl-fill-2);
  color: var(--dl-ink);
}

.k-line {
  box-shadow: inset 0 0 0 1px var(--dl-line-2);
  color: var(--dl-ink);
}

.k-plain {
  color: var(--dl-ink-2);
}

.k-danger {
  color: var(--dl-danger);
  box-shadow: inset 0 0 0 1px var(--dl-line-2);
}
</style>
