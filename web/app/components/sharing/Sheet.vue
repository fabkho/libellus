<script setup lang="ts">
// Her reading page's sheet (issue #171; Profile → Share → Reading page). The
// switch first: off by default, and off means nobody sees anything. On, the
// page has its link: Share link (the platform's share sheet, the clipboard
// where there is none), Copy link, Open page, and New link (behind a Confirm:
// the old link dies at once). Then the sections it shows, each its own switch,
// and what never shows. Every change is written at once and the sheet shows
// what the database answered (stores/sharing.ts); offline the switches say so
// and wait. The owner's shelf section is Regal's 3D row on the page, anyone
// else's a row of covers: the switch is the same.
import { READING_PAGE_SECTIONS, type ReadingPageSection } from '~/data/readingPage'
import { useSharingStore } from '~/stores/sharing'
import { copyLink, shareLink, type ShareOutcome } from '~/utils/shareLink'

const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const sharing = useSharingStore()
const online = useOnline()

watch(open, (isOpen) => {
  if (!isOpen) return
  sharing.clearError()
  outcome.value = null
  void sharing.load()
})

const on = computed(() => Boolean(sharing.settings?.token))
const disabled = computed(() => !online.value || sharing.busy || !sharing.settings)

/** What the last Share or Copy did, said politely ("Link copied"). */
const outcome = ref<ShareOutcome | null>(null)

async function share() {
  if (!sharing.pageUrl) return
  outcome.value = await shareLink({ url: sharing.pageUrl, title: t('sharing.row') }, navigator)
}
async function copy() {
  if (!sharing.pageUrl) return
  outcome.value = await copyLink(sharing.pageUrl, navigator)
}

const renewing = ref(false)
async function renew() {
  if (await sharing.renewLink()) renewing.value = false
}

function toggle(section: ReadingPageSection) {
  if (!sharing.settings || disabled.value) return
  void sharing.setSection(section, !sharing.settings.sections[section])
}
</script>

<template>
  <UiSheet v-model:open="open" :title="t('sharing.row')" testid="sharing">
    <div class="flex flex-col gap-lg pt-xs pb-lg">
      <p class="text-footnote text-ink-faint">{{ t('sharing.about') }}</p>

      <div v-if="!sharing.settings && sharing.loadError" class="flex flex-col items-center gap-md py-md text-center" data-testid="sharing.loadError">
        <p class="text-subhead text-ink-muted">{{ sharing.loadError === 'offline' ? t('sharing.error.offline') : t('sharing.loadError') }}</p>
        <UiButton v-if="sharing.loadError !== 'offline'" tone="secondary" size="md" data-testid="sharing.retry" @click="sharing.load(true)">{{ t('sharing.retry') }}</UiButton>
      </div>

      <template v-else>
        <UiRowGroup>
          <UiRow
            as="button"
            role="switch"
            :aria-checked="on"
            icon="share"
            :label="t('sharing.switch')"
            :disabled="disabled"
            class="disabled:opacity-50"
            data-testid="sharing.on"
            @click="!disabled && sharing.setOn(!on)"
          >
            <span v-if="!online" class="text-ink-muted">{{ t('common.offline') }}</span>
            <UiSwitch v-else :on="on" />
          </UiRow>
        </UiRowGroup>

        <template v-if="on && sharing.pageUrl">
          <div class="flex flex-col gap-sm">
            <span class="eyebrow">{{ t('sharing.link') }}</span>
            <p class="figures truncate rounded-md bg-fill px-md py-sm text-caption text-ink-muted" data-testid="sharing.link">{{ sharing.pageUrl }}</p>
            <div class="flex flex-wrap gap-sm">
              <UiButton tone="primary" size="md" data-testid="sharing.share" @click="share"><UiIcon name="share" :size="16" />{{ t('sharing.share') }}</UiButton>
              <UiButton tone="secondary" size="md" data-testid="sharing.copy" @click="copy"><UiIcon name="copy" :size="16" />{{ t('sharing.copy') }}</UiButton>
              <UiButton tone="plain" size="md" :to="sharing.pagePath ?? undefined" data-testid="sharing.open" @click="open = false">{{ t('sharing.open') }}</UiButton>
            </div>
            <p class="min-h-(--text-footnote--line-height) text-footnote text-ink-muted" role="status" data-testid="sharing.outcome">
              {{ outcome === 'copied' ? t('sharing.copied') : '' }}
            </p>
          </div>

          <div class="flex flex-col gap-sm">
            <span class="eyebrow">{{ t('sharing.sections.title') }}</span>
            <UiRowGroup>
              <UiRow
                v-for="section in READING_PAGE_SECTIONS"
                :key="section"
                as="button"
                role="switch"
                :aria-checked="sharing.settings?.sections[section] ?? false"
                :label="t(`sharing.sections.${section}`)"
                :disabled="disabled"
                class="disabled:opacity-50"
                :data-testid="`sharing.section.${section}`"
                @click="toggle(section)"
              >
                <UiSwitch :on="sharing.settings?.sections[section] ?? false" />
              </UiRow>
            </UiRowGroup>
            <p class="text-footnote text-ink-faint">{{ t('sharing.reviews') }}</p>
          </div>

          <UiRowGroup>
            <UiRow as="button" icon="repeat" :label="t('sharing.renew')" :disabled="disabled" class="disabled:opacity-50" data-testid="sharing.renew" @click="renewing = true" />
          </UiRowGroup>
        </template>

        <p v-if="sharing.error && !renewing" class="text-footnote text-error" role="alert" data-testid="sharing.error">{{ t(`sharing.error.${sharing.error}`) }}</p>
        <p class="text-footnote text-ink-faint">{{ t('sharing.never') }}</p>
      </template>
    </div>

  </UiSheet>

  <UiConfirm
    v-model:open="renewing"
    :title="t('sharing.renewConfirm.title')"
    :text="t('sharing.renewConfirm.text')"
    :action="t('sharing.renewConfirm.action')"
    :busy="sharing.busy"
    :offline="!online"
    :error="sharing.error ? t(`sharing.error.${sharing.error}`) : null"
    testid="sharingRenew"
    @confirm="renew"
  />
</template>
