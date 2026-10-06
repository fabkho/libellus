<script setup lang="ts">
// One error group of the owner's log (pages/profile/errors.vue), in a sheet: its
// kind in the title and Copy at the right (the group, where and on what it
// happened, and the stack, as text for an issue or a chat), then the message in
// full, the newest report's stack in mono (scrollable in both directions: the
// reason to open it) and under it the figures of the group (how often, first and
// last seen, how many members met it, which builds and routes, installed or in
// a tab, online or offline).
// The stack is asked for when the sheet opens (stores/ownerErrors.ts keeps it);
// a report without one says so.
import { detailText, type OwnerErrorGroup } from '~/data/ownerErrors'
import { useOwnerErrorsStore } from '~/stores/ownerErrors'

const props = defineProps<{ group: OwnerErrorGroup | null }>()
const open = defineModel<boolean>('open', { required: true })

const { t, locale } = useI18n()
const errors = useOwnerErrorsStore()
const { count } = useFigures()
const online = useOnline()

const detail = computed(() => (props.group ? (errors.details[props.group.hash] ?? null) : null))
const known = computed(() => Boolean(props.group && props.group.hash in errors.details))

function fetchStack() {
  if (props.group) void errors.loadDetail(props.group.hash, props.group.lastSeen)
}
watch(
  () => [open.value, props.group?.hash] as const,
  ([isOpen]) => isOpen && fetchStack(),
  { immediate: true },
)

const when = (date: Date) => new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(date)

const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | undefined
async function copy() {
  if (!props.group) return
  const text = detailText(props.group, detail.value)
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // No clipboard (an insecure origin, a refused permission): select the text the old way.
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.append(area)
    area.select()
    try {
      document.execCommand('copy')
    } finally {
      area.remove()
    }
  }
  copied.value = true
  clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => (copied.value = false), 1800)
}
onUnmounted(() => clearTimeout(copiedTimer))

/** The figures under the message: [testid, label, value]. */
const facts = computed(() => {
  const group = props.group
  if (!group) return []
  const rows: [string, string, string][] = [
    ['times', t('ownerErrors.detail.times'), count(group.times)],
    ['firstSeen', t('ownerErrors.detail.firstSeen'), when(group.firstSeen)],
    ['lastSeen', t('ownerErrors.detail.lastSeen'), when(group.lastSeen)],
    ['members', t('ownerErrors.detail.members'), t('ownerErrors.members', { count: count(group.members) }, group.members)],
  ]
  if (group.signedOutTimes) rows.push(['signedOut', t('ownerErrors.detail.signedOut'), count(group.signedOutTimes)])
  if (group.versions.length) rows.push(['versions', t('ownerErrors.detail.versions'), group.versions.join(', ')])
  if (group.routes.length) rows.push(['routes', t('ownerErrors.detail.routes'), group.routes.join(', ')])
  if (group.standaloneTimes || group.browserTimes) {
    rows.push(['installed', t('ownerErrors.detail.installed'), `${count(group.standaloneTimes)} · ${count(group.browserTimes)}`])
  }
  if (group.onlineTimes || group.offlineTimes) {
    rows.push(['online', t('ownerErrors.detail.online'), `${count(group.onlineTimes)} · ${count(group.offlineTimes)}`])
  }
  if (detail.value?.userAgent) rows.push(['device', t('ownerErrors.detail.device'), detail.value.userAgent])
  return rows
})
</script>

<template>
  <UiSheet
    v-model:open="open"
    :title="group ? t(`ownerErrors.kind.${group.kind}`) : t('ownerErrors.title')"
    testid="errorDetail"
    :action="copied ? t('ownerErrors.detail.copied') : t('ownerErrors.detail.copy')"
    :action-disabled="!group"
    @action="copy()"
  >
    <div v-if="group" class="flex flex-col gap-lg pt-xs pb-lg">
      <p class="wrap-anywhere text-body text-ink" data-testid="errorDetail.message">{{ group.message }}</p>

      <section class="flex flex-col gap-sm">
        <h3 class="eyebrow">{{ t('ownerErrors.detail.stack') }}</h3>
        <pre
          v-if="detail?.stack"
          class="stack scrollbar-none overflow-auto rounded-md bg-fill p-md font-mono text-meta text-ink-muted edge-faint"
          tabindex="0"
          data-testid="errorDetail.stack"
          >{{ detail.stack }}</pre
        >
        <p v-else-if="known" class="text-subhead text-ink-faint" data-testid="errorDetail.noStack">{{ t('ownerErrors.detail.stackNone') }}</p>
        <p v-else-if="errors.detailError" class="text-subhead text-error" role="alert" data-testid="errorDetail.stackError">
          {{ t('ownerErrors.detail.stackError') }}
          <UiButton tone="plain" size="sm" :offline="!online" data-testid="errorDetail.retry" @click="fetchStack()">{{ t('ownerErrors.retry') }}</UiButton>
        </p>
        <p v-else class="text-subhead text-ink-faint" data-testid="errorDetail.stackLoading">{{ t('ownerErrors.detail.stackLoading') }}</p>
      </section>

      <UiRowGroup>
        <UiRow v-for="[id, label, value] in facts" :key="id" :label="label" mono :data-testid="`errorDetail.${id}`">
          <span class="truncate">{{ value }}</span>
        </UiRow>
      </UiRowGroup>
    </div>
  </UiSheet>
</template>

<style scoped>
.stack {
  /* A long stack scrolls in its own box, sideways too (a frame is one line); the sheet's body is not where it moves. */
  overscroll-behavior: contain;
  white-space: pre;
  max-height: 40dvh;
}
</style>
