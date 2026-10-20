<script setup lang="ts">
// Import books (issues #40, #111): an export from Goodreads or Hardcover into the member's Library; which app wrote it is told by
// its header, she never picks one. Reached from the Profile's account rows (issue #78). One line names the apps it reads, with how
// to export from each; she chooses the file, the app reads it on the device and sends its books to the server, and from then on
// this page only shows the server's job (proposal #329): waiting in line, looking the books up, finding covers, adding them, done.
// "Your import runs on our server. You can close BetterReads; we'll finish it." There is nothing to review and nothing to choose:
// "Choose edition" is on each Book's own page. The job is live over Realtime (stores/import.ts); the same words are on the pill every
// other screen shows (components/shell/ImportStatus.vue). Importing the same file again adds nothing. A pushed screen in the tab layout.
import { SUPPORTED_SOURCES } from '~/data/import/detect'
import { useImportStore } from '~/stores/import'

definePageMeta({ layout: 'tabs', screen: 'import', pushed: true })

const { t } = useI18n()
const router = useRouter()
const store = useImportStore()
const words = useImportWords()
// Choosing a file uploads its books and starting again writes: offline neither can (#15).
const online = useOnline()

useHead({ title: () => `${t('import.title')} · ${t('app.name')}` })

function back() {
  if (window.history.state?.back) router.back()
  else void navigateTo('/profile')
}

const input = useTemplateRef<HTMLInputElement>('input')
function pick() {
  input.value?.click()
}
function picked(event: Event) {
  const field = event.target as HTMLInputElement
  const file = field.files?.[0]
  // Emptied at once, so choosing the same file again is a change too.
  field.value = ''
  if (file) void store.choose(file)
}

const ambient = computed(() => store.ambient)
const job = computed(() => store.job)
const kind = computed(() => ambient.value?.kind ?? null)
const running = computed(() => kind.value === 'queued' || kind.value === 'paused' || kind.value === 'matching' || kind.value === 'covers' || kind.value === 'writing')
const progress = computed(() => {
  const now = ambient.value
  return now && (now.kind === 'matching' || now.kind === 'covers' || now.kind === 'writing') ? now : null
})
const label = computed(() => (ambient.value ? words(ambient.value) : ''))
const hint = computed(() => (kind.value === 'queued' ? t('import.queuedHint') : kind.value === 'paused' ? t('import.pausedHint') : ''))
// One polite status that names the phase, never the counts (which change with every book).
const said = computed(() => (kind.value ? t(`import.ambient.say.${kind.value}`) : ''))

const picking = computed(() => store.phase !== 'job' || !job.value)
const fileErrorText = computed(() => {
  const detail = store.fileErrorDetail
  if (store.fileError !== 'missingColumns' || !detail) return store.fileError ? t(`import.fileError.${store.fileError}`) : ''
  const columns = detail.columns.map((name) => `“${name}”`).join(', ')
  return t('import.fileError.missingColumns', { app: t(`import.app.${detail.source}`), columns }, detail.columns.length)
})
const startErrorText = computed(() => (store.startError ? t(`import.startError.${store.startError}`) : ''))

// The result is seen once she has read it here: it is not told again on the pill.
onBeforeUnmount(() => {
  if (store.job?.state === 'done') store.acknowledge()
})

const confirming = ref(false)
async function cancel() {
  await store.cancel()
}
</script>

<template>
  <div class="relative min-h-dvh">
    <UiTopBar :back-label="t('import.back')" back-testid="import.back" @back="back" />

    <header class="px-screen pt-bar">
      <h1 class="text-large-title" data-testid="import.title">{{ t('import.title') }}</h1>
    </header>

    <input ref="input" type="file" accept=".csv,text/csv" class="hidden" data-testid="import.file" @change="picked" />

    <!-- The job's phase, said once per phase for assistive tech; the counts below are not read out. -->
    <p class="sr-only" role="status" data-testid="import.say">{{ said }}</p>

    <!-- Pick: where the file comes from, and the one way forward. -->
    <UiEmptyState v-if="picking" screen="import" :title="t('import.pickTitle')" :text="t('import.pickText')" class="px-screen pt-md">
      <UiButton block :offline="!online" :disabled="store.phase !== 'pick'" data-testid="import.choose" @click="pick">
        {{ store.phase === 'reading' ? t('import.reading') : store.phase !== 'pick' ? t('import.starting') : t('import.choose') }}
      </UiButton>
      <p v-if="store.fileError" class="mt-ms text-center text-caption text-error" role="alert" data-testid="import.fileError">
        {{ fileErrorText }}
      </p>
      <p v-else-if="store.startError" class="mt-ms text-center text-caption text-error" role="alert" data-testid="import.startError" :data-code="store.startError">
        {{ startErrorText }}
      </p>
      <p v-else-if="store.nothingNew" class="mt-ms text-center text-caption text-ink-muted" role="status" data-testid="import.nothing">
        {{ t('import.nothingNew') }}
      </p>
      <ImportHowTo :sources="SUPPORTED_SOURCES" class="mt-xl" />
    </UiEmptyState>

    <!-- Running: where the server's job stands. Nothing to do but wait, or close the app. -->
    <section v-else-if="running" class="px-screen pt-lg pb-xl" data-testid="import.running" :data-kind="kind">
      <ImportProgress
        v-if="progress"
        testid="import.progress"
        :label="label"
        :hint="t('import.serverNote')"
        :done="progress.done"
        :total="progress.total"
      />
      <div v-else class="flex flex-col gap-sm">
        <p class="figures text-caption text-ink" data-testid="import.progress.label">{{ label }}</p>
        <p v-if="hint" class="text-footnote text-ink-muted" data-testid="import.hint">{{ hint }}</p>
        <p class="text-footnote text-ink-faint">{{ t('import.serverNote') }}</p>
      </div>
      <UiButton block tone="plain" class="mt-lg" :offline="!online" :disabled="store.busy" data-testid="import.cancel" @click="confirming = true">
        {{ t('import.cancel') }}
      </UiButton>
      <UiConfirm
        v-model:open="confirming"
        :title="t('import.cancelTitle')"
        :text="t('import.cancelText')"
        :action="t('import.cancel')"
        :busy="store.busy"
        testid="import.cancelConfirm"
        @confirm="cancel().then(() => (confirming = false))"
      />
    </section>

    <!-- Failed: the server gave up. Its rows are kept, so trying again needs no file. -->
    <section v-else-if="kind === 'failed'" class="px-screen pt-lg pb-xl" data-testid="import.failedJob">
      <p class="book-title text-headline" data-testid="import.failedTitle">{{ t('import.failedTitle') }}</p>
      <p class="mt-sm text-subhead text-ink-muted">{{ t('import.failedText') }}</p>
      <p v-if="store.startError" class="mt-ms text-caption text-error" role="alert" data-testid="import.startError" :data-code="store.startError">
        {{ startErrorText }}
      </p>
      <div class="mt-lg flex flex-col gap-xs">
        <UiButton block :offline="!online" :disabled="store.busy" data-testid="import.retry" @click="store.retry()">
          {{ store.busy ? t('import.retrying') : t('import.retry') }}
        </UiButton>
        <UiButton block tone="plain" data-testid="import.chooseAgain" @click="store.acknowledge()">{{ t('import.chooseAgain') }}</UiButton>
      </div>
    </section>

    <!-- Done: what was added, what was there already, what was not. -->
    <section v-else-if="job && kind === 'done'" class="px-screen pt-lg pb-xl" data-testid="import.done">
      <p class="book-title text-headline" data-testid="import.doneTitle">
        {{ t('import.doneTitle', { count: job.added }, job.added) }}
      </p>
      <p class="mt-sm text-subhead text-ink-muted">{{ job.added ? t('import.doneText') : t('import.doneNothing') }}</p>

      <UiRowGroup class="mt-lg">
        <UiRow :label="t('import.added')" :value="String(job.added)" mono data-testid="import.added" />
        <UiRow :label="t('import.kept')" :value="String(job.kept)" mono data-testid="import.kept" />
        <UiRow v-if="job.failed" :label="t('import.failed')" :value="String(job.failed)" mono data-testid="import.failedCount" />
      </UiRowGroup>

      <div class="mt-lg flex flex-col gap-xs">
        <UiButton block to="/library" data-testid="import.toLibrary">{{ t('import.toLibrary') }}</UiButton>
      </div>
    </section>
  </div>
</template>
