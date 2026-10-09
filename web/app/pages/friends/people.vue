<script setup lang="ts">
// People (social v1, U3; `/friends/people`, pushed): who she follows, who follows her and who asked to.
// A round back, the title, a segmented control of Following · Followers · Requests (the third only
// while a request waits; the page opens on it then). Following and Followers rows open the member's
// profile and carry a ⋯ for what she can do about them (components/friends/MemberSheet.vue); a
// follower she does not follow gets Follow back. Requests: Accept (the row then says "follows you now"
// with Follow back) or Decline (the row leaves). No counts anywhere. Everything is the store's
// (stores/social.ts); what is decided apart from the screen is utils/people.ts. Offline every write
// button says so and waits.
import type { MemberCard } from '~/data/socialShapes'
import { useSocialStore } from '~/stores/social'
import { followBackFace, peopleSegments, requestRows, startSegment, type FollowBack, type PeopleSegment, type RequestItem } from '~/utils/people'

definePageMeta({ layout: 'tabs', screen: 'people', pushed: true })

const { t } = useI18n()
const router = useRouter()
const social = useSocialStore()
const online = useOnline()

useHead({ title: () => `${t('people.title')} · ${t('app.name')}` })

onMounted(() => {
  social.clearError('people')
  social.clearError('follow')
  // What is shown may be old (a request came in, someone followed): read it again, keep what is on screen meanwhile.
  void social.loadPeople(true)
  void social.load(true)
})

// Back leads to where she came from; opened by address, to Friends' feed.
function back() {
  if (window.history.state?.back) router.back()
  else void navigateTo('/friends')
}

// ------------------------------------------------------------ what is on screen

/** Requests she accepted here: they stay, saying they follow her now, until she leaves the page. */
const accepted = ref(new Map<string, RequestItem>())
/** Requests she declined here: gone at once, before the lists are read again. */
const gone = ref(new Set<string>())
/** What a Follow back answered, per member. */
const followed = ref(new Map<string, FollowBack>())
/** Members a write is on its way for. */
const pending = ref(new Set<string>())

// What is shown follows the store, but holds still while a sheet is on its way out, so a row leaves where she sees it.
const people = useSettled(() => social.people)

const waiting = computed(() => requestRows(people.value?.requests ?? [], accepted.value, gone.value))
const requestsShown = computed(() => (people.value ? waiting.value.length > 0 : social.requests > 0))
const segments = computed(() => peopleSegments(requestsShown.value))
const chosen = ref<PeopleSegment | null>(null)
const segment = computed<PeopleSegment>({
  get: () => (chosen.value && segments.value.includes(chosen.value) ? chosen.value : startSegment(requestsShown.value)),
  set: (value) => (chosen.value = value),
})
const options = computed(() => segments.value.map((value) => ({ value, label: t(`people.${value}`) })))

const asked = computed(() => new Set((people.value?.requested ?? []).map((member) => member.id)))
const loadFailed = computed(() => !people.value && Boolean(social.errors.people) && social.errors.people !== 'offline')
/** Opened offline with nothing read yet: the page says so (it reads again once back, stores/social.ts). */
const offlineEmpty = computed(() => !people.value && social.errors.people === 'offline')
const loading = computed(() => !people.value && !loadFailed.value && !offlineEmpty.value)

// ------------------------------------------------------------------ the actions

const failed = ref(false)
/** What the last action did, said politely: a row that changes or leaves otherwise says nothing (a11y). */
const said = ref('')
const heading = useTemplateRef<HTMLElement>('heading')
/** A row is about to leave: focus would fall to the page, so it goes to the title, where the list starts. */
function focusHeading() {
  const active = document.activeElement
  if (!active || active === document.body || active.closest('[data-testid="people.row"]')) heading.value?.focus({ preventScroll: true })
}
const nameOf = (member: MemberCard) => member.name?.trim() || t('member.someone')

async function guard(id: string, run: () => Promise<boolean>) {
  if (pending.value.has(id) || !online.value) return
  pending.value = new Set(pending.value).add(id)
  failed.value = false
  const ok = await run().finally(() => {
    const next = new Set(pending.value)
    next.delete(id)
    pending.value = next
  })
  failed.value = !ok
}

async function followBack(id: string) {
  await guard(id, async () => {
    const result = await social.follow(id)
    if (result.error) return result.error === 'offline'
    followed.value = new Map(followed.value).set(id, result.data)
    return true
  })
}

async function accept(request: MemberCard & { askedAt: string }) {
  await guard(request.id, async () => {
    // At once: the row says what it is now before the database has answered.
    accepted.value = new Map(accepted.value).set(request.id, { ...request, state: 'accepted' })
    const result = await social.answer(request.id, true)
    if (!result.error) {
      said.value = t('people.accepted', { name: nameOf(request) })
      return true
    }
    const next = new Map(accepted.value)
    next.delete(request.id)
    accepted.value = next
    return result.error === 'offline'
  })
}

async function decline(member: MemberCard) {
  const id = member.id
  focusHeading()
  await guard(id, async () => {
    gone.value = new Set(gone.value).add(id)
    const result = await social.answer(id, false)
    if (!result.error) {
      said.value = t('people.declined', { name: nameOf(member) })
      return true
    }
    const next = new Set(gone.value)
    next.delete(id)
    gone.value = next
    return result.error === 'offline'
  })
}

/** After Follow back on an accepted request, its row says what came of it. */
function requestRowOf(item: RequestItem): RequestItem {
  const reply = followed.value.get(item.id)
  return reply ? { ...item, state: reply } : item
}

// ----------------------------------------------------------------- the sheet

const sheet = ref(false)
const sheetMember = ref<MemberCard | null>(null)
const sheetRelation = ref({ following: false, follower: false })

function openSheet(member: MemberCard, relation: { following: boolean; follower: boolean }) {
  sheetMember.value = member
  sheetRelation.value = relation
  sheet.value = true
}

/** After an action in the sheet, what this page remembered of the member (a Follow back, an Accept) is no longer true. */
function changed() {
  const id = sheetMember.value?.id
  if (!id) return
  const nextFollowed = new Map(followed.value)
  nextFollowed.delete(id)
  followed.value = nextFollowed
  const nextAccepted = new Map(accepted.value)
  nextAccepted.delete(id)
  accepted.value = nextAccepted
}

const followingIds = computed(() => new Set((people.value?.following ?? []).map((member) => member.id)))
const followerIds = computed(() => new Set((people.value?.followers ?? []).map((member) => member.id)))
</script>

<template>
  <div class="relative min-h-dvh" data-testid="people">
    <UiTopBar :back-label="t('member.back')" back-testid="people.back" @back="back" />

    <header class="px-screen pt-bar">
      <h1 ref="heading" tabindex="-1" class="text-large-title" data-testid="people.title">{{ t('people.title') }}</h1>
    </header>

    <p class="sr-only" role="status" data-testid="people.status">{{ said }}</p>

    <div class="flex flex-col gap-md px-screen pt-ms">
      <UiSegmented v-model="segment" :options="options" :label="t('people.title')" testid="people.segment" />

      <div v-if="loadFailed" class="px-lg pt-xl text-center" data-testid="people.loadError">
        <p class="text-subhead text-ink-muted">{{ t('people.loadError') }}</p>
        <UiButton tone="secondary" size="md" class="mt-md" data-testid="people.retry" @click="social.loadPeople(true)">
          {{ t('people.retry') }}
        </UiButton>
      </div>

      <p v-else-if="offlineEmpty" class="px-lg pt-xl text-center text-subhead text-ink-muted" data-testid="people.offline">{{ t('people.offline') }}</p>

      <template v-else-if="!loading">
        <!-- Following -->
        <template v-if="segment === 'following'">
          <UiListMotion v-if="people?.following.length" tag="ul" class="flex flex-col">
            <li v-for="member in people.following" :key="member.id" class="border-hairline not-first:border-t">
              <FriendsPersonRow :member="member" @more="openSheet(member, { following: true, follower: followerIds.has(member.id) })" />
            </li>
          </UiListMotion>
          <p v-else class="py-lg text-center text-subhead text-ink-muted" data-testid="people.empty">{{ t('people.emptyFollowing') }}</p>
        </template>

        <!-- Followers -->
        <template v-else-if="segment === 'followers'">
          <UiListMotion v-if="people?.followers.length" tag="ul" class="flex flex-col">
            <li v-for="member in people.followers" :key="member.id" class="border-hairline not-first:border-t">
              <FriendsPersonRow
                :member="member"
                :follow-back="followBackFace(member, asked, followed)"
                :offline="!online"
                :busy="pending.has(member.id)"
                @follow-back="followBack(member.id)"
                @more="openSheet(member, { following: followingIds.has(member.id), follower: true })"
              />
            </li>
          </UiListMotion>
          <p v-else class="py-lg text-center text-subhead text-ink-muted" data-testid="people.empty">{{ t('people.emptyFollowers') }}</p>
        </template>

        <!-- Requests -->
        <UiListMotion v-else tag="ul" class="flex flex-col">
          <li v-for="item in waiting" :key="item.id" class="border-hairline not-first:border-t">
            <FriendsRequestRow
              :request="requestRowOf(item)"
              :state="requestRowOf(item).state"
              :offline="!online"
              :busy="pending.has(item.id)"
              @accept="accept(item)"
              @decline="decline(item)"
              @follow-back="followBack(item.id)"
            />
          </li>
        </UiListMotion>

        <p v-if="failed && online" class="text-footnote text-error" role="alert" data-testid="people.error">{{ t('people.error') }}</p>
      </template>

      <!-- The first answer on its way: rows of a person's height, so the list does not jump when it comes. -->
      <div v-else class="flex flex-col" aria-busy="true" data-testid="people.loading">
        <FriendsRowPlaceholder v-for="i in 4" :key="i" kind="person" :wave="i * 0.1" />
      </div>
    </div>

    <FriendsMemberSheet v-model:open="sheet" :member="sheetMember" :following="sheetRelation.following" :follower="sheetRelation.follower" @changed="changed" />
  </div>
</template>
