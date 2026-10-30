<script setup lang="ts">
// A member's profile links (WP-22; the Profile's hero and another member's, components/profile/Hero.vue,
// components/friends/MemberHero.vue), behind one quiet chip, "Socials", under the library line: a tap opens a
// sheet that lists them, one row per platform (its name, her handle, an external-link mark). Nothing else of them
// shows on the page. Each row is a link that leaves the app: the address is never the stored text
// (utils/socialLinks.ts builds it from a fixed template per platform; a row that is not a canonical handle gets
// no row), `target="_blank"` with `rel="noopener noreferrer nofollow ugc"` (no referrer, no opener), and the
// accessible name "{platform}: {handle}. Opens {platform} in a new tab". No links, no chip.
// `testid` names the chip (`<testid>`); the sheet is `<testid>Sheet` and each row `<testid>Sheet.<platform>`.
import type { ProfileLink } from '~/data/profileLinks'
import { SOCIAL_LINK_REL, socialLinkLabel, socialLinkUrl, socialPlatform } from '~/utils/socialLinks'

const props = defineProps<{ links: readonly ProfileLink[]; testid: string }>()
const { t } = useI18n()
const open = ref(false)

const rows = computed(() =>
  props.links.flatMap((link) => {
    const href = socialLinkUrl(link.platform, link.handle)
    if (!href) return []
    const name = socialPlatform(link.platform).name
    const handle = socialLinkLabel(link.platform, link.handle)
    return [{ platform: link.platform, name, handle, href, label: t('socialLinks.opens', { platform: name, handle }) }]
  }),
)

// Safari does not focus a button when it is tapped, and the sheet gives focus back to what had it when it
// opened (useModalLayer, the UI base's): so the chip takes it first.
function show(event: MouseEvent) {
  ;(event.currentTarget as HTMLElement).focus({ preventScroll: true })
  open.value = true
}
</script>

<template>
  <div v-if="rows.length" class="flex justify-center">
    <button
      type="button"
      class="chip flex min-h-(--size-touch) items-center"
      aria-haspopup="dialog"
      :aria-label="t('socialLinks.menuLabel', rows.length)"
      :data-testid="testid"
      @click="show"
    >
      <span class="flex items-center gap-xs rounded-pill bg-fill px-md py-xs text-footnote text-ink-muted edge-faint" aria-hidden="true">
        {{ t('socialLinks.menu') }}<UiIcon name="down" :size="12" />
      </span>
    </button>
    <UiSheet v-model:open="open" :title="t('socialLinks.menu')" :testid="`${testid}Sheet`">
      <div class="pt-xs pb-lg">
        <UiRowGroup :aria-label="t('socialLinks.listLabel')">
          <!-- A space after the platform's name: the row draws its name and her handle side by side with no text
               between them, and its name says both in that order ("Goodreads: 4242. Opens…"), so they must read as
               two words for the name to start with what is shown (WCAG 2.5.3). -->
          <UiRow
            v-for="row in rows"
            :key="row.platform"
            as="a"
            :href="row.href"
            target="_blank"
            :rel="SOCIAL_LINK_REL"
            :label="`${row.name} `"
            :value="row.handle"
            :aria-label="row.label"
            :data-testid="`${testid}Sheet.${row.platform}`"
          >
            <template #trailing><UiIcon name="external" :size="15" class="text-ink-faint" /></template>
          </UiRow>
        </UiRowGroup>
      </div>
    </UiSheet>
  </div>
</template>

<style scoped>
.chip:active > span {
  background: var(--color-fill-strong);
}
</style>
