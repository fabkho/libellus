<script setup lang="ts">
// The name sheet (the avatar menu's Name row): the first name Home greets her
// with ("Good evening, Fabian") and the avatar's initials come from. Optional,
// kept with her account (`setName`, data/auth.ts); one field with the keyboard
// up (focused in the tap that opened the sheet), Save at the top right and
// Enter does the same. Saving an empty field, or Remove name, clears it.
import { cleanName, MEMBER_NAME_MAX } from '~/data/auth'
import { useSessionStore } from '~/stores/session'

const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const session = useSessionStore()
// Saving writes: offline the action says so instead (#15).
const online = useOnline()

const name = ref('')
watch(open, (isOpen) => {
  if (!isOpen) return
  name.value = session.member?.name ?? ''
  session.clearNameError()
})

const current = computed(() => session.member?.name ?? null)
const changed = computed(() => cleanName(name.value) !== current.value)
const error = computed(() => {
  const code = session.nameError
  if (!code) return null
  return t(`account.error.${code === 'offline' || code === 'rate_limited' ? code : 'unknown'}`)
})

async function save(value = name.value) {
  if (session.nameBusy || !online.value) return
  if (await session.setName(value)) open.value = false
}

const fieldId = useId()
</script>

<template>
  <UiSheet
    v-model:open="open"
    :title="t('account.nameTitle')"
    testid="accountName"
    :action="online ? t('account.save') : t('common.offline')"
    :action-disabled="session.nameBusy || !changed || !online"
    @action="save()"
  >
    <form novalidate class="flex flex-col gap-md pt-xs pb-lg" @submit.prevent="save()">
      <UiField
        :id="fieldId"
        v-model="name"
        :label="t('account.nameLabel')"
        :error="error"
        error-testid="accountName.error"
        type="text"
        autocomplete="given-name"
        autocapitalize="words"
        enterkeyhint="done"
        :maxlength="MEMBER_NAME_MAX"
        :placeholder="t('account.namePlaceholder')"
        :disabled="session.nameBusy"
        data-autofocus
        data-testid="accountName.input"
      />
      <p class="text-footnote text-ink-faint">{{ t('account.nameHint') }}</p>
      <UiButton
        v-if="current"
        tone="secondary"
        size="md"
        class="self-start"
        :disabled="session.nameBusy"
        :offline="!online"
        data-testid="accountName.clear"
        @click="save('')"
      >
        {{ t('account.clear') }}
      </UiButton>
    </form>
  </UiSheet>
</template>
