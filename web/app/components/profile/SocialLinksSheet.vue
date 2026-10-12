<script setup lang="ts">
// Profile links (WP-22; the Profile's Profile links row, components/profile/Account.vue): her profiles on other
// platforms, one field per platform (Goodreads, Reado, YouTube, Instagram, TikTok). She types a handle or pastes
// the platform's own profile link; only the handle is kept (utils/socialLinks.ts reads it, the database checks it
// again), never a free address, and the app builds every outgoing link itself. A field that is not a handle of
// its platform is refused under the field, in words that say what that platform takes. Emptying a field, or its
// ✕, removes the link. Who sees them is a segmented choice: Followers (the default), Everyone, Only me, with one
// line under it saying what the chosen one means. Save at the top right writes all of it (stores/profileLinks.ts)
// and is disabled offline, where it says "Offline". Hers to change alone; others see them as she allows
// (components/friends/MemberHero.vue).
import { draftsToLinks, type ProfileLinkDrafts } from '~/data/profileLinks'
import { useProfileLinksStore } from '~/stores/profileLinks'
import { DEFAULT_LINK_VISIBILITY, LINK_VISIBILITIES, SOCIAL_PLATFORMS, cleanSocialHandle, type LinkVisibility, type SocialPlatform } from '~/utils/socialLinks'

const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const links = useProfileLinksStore()
const online = useOnline()

const drafts = reactive<Record<SocialPlatform, string>>({ goodreads: '', reado: '', youtube: '', instagram: '', tiktok: '' })
const problems = reactive<Record<SocialPlatform, boolean>>({ goodreads: false, reado: false, youtube: false, instagram: false, tiktok: false })
const visibility = ref<LinkVisibility>(DEFAULT_LINK_VISIBILITY)

function fill() {
  const own = links.own
  for (const spec of SOCIAL_PLATFORMS) {
    const link = own?.links.find((l) => l.platform === spec.id)
    drafts[spec.id] = link?.handle ?? ''
    problems[spec.id] = false
  }
  visibility.value = own?.visibility ?? DEFAULT_LINK_VISIBILITY
}

watch(open, async (isOpen) => {
  if (!isOpen) return
  links.clearSaveError()
  fill()
  await links.load(true)
  // Her links arrived while the sheet opened, and nothing was typed yet: show them.
  if (open.value && SOCIAL_PLATFORMS.every((s) => !drafts[s.id])) fill()
})

const changed = computed(() => {
  const own = links.own
  if (visibility.value !== (own?.visibility ?? DEFAULT_LINK_VISIBILITY)) return true
  const { links: now, invalid } = draftsToLinks(drafts as ProfileLinkDrafts)
  if (invalid) return true
  return JSON.stringify(now) !== JSON.stringify(own?.links ?? [])
})

async function save() {
  if (links.saving || !online.value) return
  let wrong = false
  for (const spec of SOCIAL_PLATFORMS) {
    const typed = drafts[spec.id].trim()
    problems[spec.id] = typed !== '' && cleanSocialHandle(spec.id, typed) === null
    if (problems[spec.id]) wrong = true
  }
  if (wrong) return
  if (await links.save(drafts as ProfileLinkDrafts, visibility.value)) open.value = false
}

function clear(platform: SocialPlatform) {
  drafts[platform] = ''
  problems[platform] = false
}

const saveError = computed(() => {
  const error = links.saveError
  if (!error) return null
  if (error.code === 'link_invalid' && error.platform) return t(`socialLinks.invalid.${error.platform}`)
  return t(`socialLinks.error.${error.code === 'offline' || error.code === 'rate_limited' ? error.code : 'unknown'}`)
})

const options = computed(() => LINK_VISIBILITIES.map((value) => ({ value, label: t(`socialLinks.visibility.${value}`) })))
const baseId = useId()
</script>

<template>
  <UiSheet
    v-model:open="open"
    :title="t('socialLinks.title')"
    testid="socialLinks"
    :action="online ? t('socialLinks.save') : t('common.offline')"
    :action-disabled="links.saving || !changed || !online"
    @action="save()"
  >
    <form novalidate class="flex flex-col gap-lg pt-xs pb-lg" @submit.prevent="save()">
      <p class="text-footnote text-ink-faint">{{ t('socialLinks.intro') }}</p>

      <div v-for="spec in SOCIAL_PLATFORMS" :key="spec.id" class="flex items-end gap-xs" :data-testid="`socialLinks.${spec.id}.item`">
        <div class="min-w-0 flex-1">
        <UiField
          :id="`${baseId}-${spec.id}`"
          v-model="drafts[spec.id]"
          :label="spec.name"
          :error="problems[spec.id] ? t(`socialLinks.invalid.${spec.id}`) : null"
          :error-testid="`socialLinks.${spec.id}.error`"
          type="text"
          :inputmode="spec.inputmode === 'url' ? 'url' : 'text'"
          autocapitalize="off"
          autocorrect="off"
          autocomplete="off"
          spellcheck="false"
          :maxlength="spec.maxlength"
          :placeholder="t('socialLinks.placeholder', { prefix: spec.prefix, example: spec.example })"
          :data-testid="`socialLinks.${spec.id}`"
          @update:model-value="problems[spec.id] = false"
        />
        </div>
        <button
          v-if="drafts[spec.id]"
          type="button"
          class="control mb-xxs flex size-(--size-touch) shrink-0 items-center justify-center rounded-pill text-ink-muted"
          :class="problems[spec.id] ? 'self-start mt-md' : ''"
          :aria-label="t('socialLinks.remove', { platform: spec.name })"
          :data-testid="`socialLinks.${spec.id}.remove`"
          @click="clear(spec.id)"
        >
          <UiIcon name="close" :size="18" />
        </button>
      </div>

      <div class="flex flex-col gap-sm">
        <span class="eyebrow">{{ t('socialLinks.visibility.label') }}</span>
        <UiSegmented v-model="visibility" :options="options" :label="t('socialLinks.visibility.label')" testid="socialLinks.visibility" />
        <p class="text-footnote text-ink-faint" aria-live="polite" data-testid="socialLinks.visibilityHint">{{ t(`socialLinks.visibility.hint.${visibility}`) }}</p>
      </div>

      <p v-if="saveError" class="text-footnote text-error" role="alert" data-testid="socialLinks.error">{{ saveError }}</p>
    </form>
  </UiSheet>
</template>

<style scoped>
.control:not(:disabled):active {
  background: var(--color-fill-strong);
}
</style>
