<script setup lang="ts">
// "Leave your buddy reads and turn off?" (Profile → Account, stores/buddyTurnOff.ts, utils/buddyTurnOff.ts): what asking to turn Buddy reads off
// does while she is in a room or has an invitation waiting. A room keeps showing her Section whatever the switch says, so the switch goes off
// only after she leaves: the sentence says how many rooms, and, unticked by default, "Also delete my messages" says what each choice does and
// that it cannot be changed later (the database takes the choice when she leaves: `leave_buddy_read(p_delete_messages)`). The action leaves
// the rooms in order and declines the invitations; the first refusal stays in the dialog with the app's failure line, what was left stays left,
// and the same button tries again. Cancel is "Keep on". Drawn only in a build that carries buddy reads (the caller's `v-if`).
// Test ids: `buddyReadsOff` (+ `.confirm`, `.cancel`, `.error`), `buddyReadsOff.deleteMine`, `buddyReadsOff.deleteHint`.
import { useBuddyTurnOffStore } from '~/stores/buddyTurnOff'
import { buddyErrorKey } from '~/utils/buddyRead'

const { t } = useI18n()
const store = useBuddyTurnOffStore()
const online = useOnline()
const hintId = useId()

const open = computed({ get: () => store.asking, set: (on: boolean) => !on && store.cancel() })
const text = computed(() => store.view.parts.map((p) => t(p.key, { count: p.count }, p.count)).join(' '))
</script>

<template>
  <UiConfirm
    v-model:open="open"
    :title="t(store.view.titleKey)"
    :text="text"
    :action="t(store.view.actionKey)"
    :cancel-label="t('profile.buddyReadsOff.keep')"
    :busy="store.busy"
    :offline="!online"
    :error="store.error ? t(buddyErrorKey(store.error)) : null"
    testid="buddyReadsOff"
    @confirm="store.confirm()"
  >
    <template v-if="store.view.deleteOption">
      <div class="flex flex-col">
        <UiCheckbox v-model="store.deleteMessages" :aria-describedby="hintId" :disabled="store.busy" data-testid="buddyReadsOff.deleteMine">
          {{ t('profile.buddyReadsOff.deleteMine') }}
        </UiCheckbox>
        <p :id="hintId" class="text-footnote text-ink-faint" data-testid="buddyReadsOff.deleteHint">
          {{ t('profile.buddyReadsOff.deleteHint') }}
        </p>
      </div>
    </template>
  </UiConfirm>
</template>
