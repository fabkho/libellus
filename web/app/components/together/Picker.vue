<script setup lang="ts">
// Who to invite to a buddy read: the people she follows, as a list to tick from (the base's UiCheckList: a filter, a checkbox row
// each, a count that is read out). The host's choice only: the database skips whoever may not be invited (blocked with a member) and
// says so afterwards. Her people come from the social store, a page at a time (`Show more` asks the next); someone already in the
// read, or already invited, is left out (`exclude`).
//
// v-model: the ids ticked. Props: `exclude` (ids not offered), `max` (how many may be ticked: 11 minus whoever is in), `label` (the
// group's name), `testid` (the prefix: `<testid>.list`, `.more`, `.empty`, `.allIn`). Offline the list shows what the device has read.
import type { MemberCard } from '~/data/socialShapes'
import { useSocialStore } from '~/stores/social'

const model = defineModel<string[]>({ required: true })
const props = withDefaults(defineProps<{ exclude?: readonly string[]; max?: number; label: string; testid?: string }>(), { exclude: () => [], max: undefined, testid: 'buddyPicker' })

const { t } = useI18n()
const social = useSocialStore()
const online = useOnline()

onMounted(() => void social.loadPeople())

const options = computed(() =>
  (social.people?.following ?? [])
    .filter((card) => !props.exclude.includes(card.id))
    .map((card: MemberCard) => ({ id: card.id, label: card.name?.trim() || t('member.someone'), face: card })),
)
const loaded = computed(() => social.people !== null)
const more = computed(() => loaded.value && !social.peopleEnded.following)
const loadingMore = ref(false)
async function showMore() {
  loadingMore.value = true
  await social.loadMorePeople('following').finally(() => (loadingMore.value = false))
}
</script>

<template>
  <div class="flex flex-col gap-sm" :data-testid="testid">
    <UiCheckList v-if="options.length" v-model="model" :label="label" :options="options" :max="max" :testid="`${testid}.list`">
      <template #face="{ option }"><FriendsAvatar :card="option.face as MemberCard" /></template>
    </UiCheckList>
    <p v-else-if="loaded && social.people?.following.length" class="text-subhead text-ink-muted" :data-testid="`${testid}.allIn`">{{ t('together.picker.allIn') }}</p>
    <p v-else-if="loaded" class="text-subhead text-ink-muted" :data-testid="`${testid}.empty`">{{ t('together.picker.empty') }}</p>
    <p v-else-if="!online" class="text-subhead text-ink-muted" role="status">{{ t('together.picker.offline') }}</p>
    <div v-if="more && options.length" class="flex">
      <UiButton tone="plain" size="md" :disabled="loadingMore || !online" :offline="!online" :data-testid="`${testid}.more`" @click="showMore">{{ t('together.picker.more') }}</UiButton>
    </div>
  </div>
</template>
