<script setup lang="ts">
// The member's profile photo (issue #156): picked, cropped to a circle and
// uploaded from the Profile — its Account's Photo row and the hero's avatar
// both call `start()`. Without a photo that opens the device's picker at once
// (in the tap: browsers only open it from one); with one, the sheet `photo`
// shows it with Choose another and Remove photo. A picked picture opens the
// same sheet as the crop, "Move and scale": the picture under a round mask
// (the avatar is a circle, the upload the square around it), moved with a
// finger or the mouse, zoomed by pinching, the wheel, the slider and its − / +,
// and by the keys (arrows move, + and − zoom). Save cuts the square out, makes
// the two small files on the device (data/avatar.ts: 512 and 128 px, WebP or
// JPEG, no EXIF) and uploads them; the sheet closes and every avatar shows it.
// Writing needs the connection: offline the row and the hero's avatar are
// disabled, and the sheet's actions say "Offline". The picker takes images
// only (`accept="image/*"`); on a phone it offers the camera too. The input
// itself is never shown: the row and the ring open it.
import { encodeAvatar } from '~/data/avatar'
import { useAvatarStore } from '~/stores/avatar'
import { useSessionStore } from '~/stores/session'
import { canvasRaster, loadPicture } from '~/utils/avatarRaster'
import { MAX_ZOOM, ZOOM_STEP } from '~/utils/crop'

const { t } = useI18n()
const avatar = useAvatarStore()
const session = useSessionStore()
const online = useOnline()
const initials = computed(() => initialsOf(session.member?.email ?? '', session.member?.name))

const open = ref(false)
const mode = ref<'menu' | 'crop'>('menu')
/** What went wrong in the sheet: the picture could not be read, or the store's code. */
const problem = ref<'unreadable' | null>(null)
/** For screen readers, once: saved or removed. */
const status = ref('')

const picker = useTemplateRef<HTMLInputElement>('picker')
const picture = shallowRef<HTMLImageElement | null>(null)
const working = ref(false)

const error = computed(() => {
  if (problem.value) return t(`photo.error.${problem.value}`)
  return avatar.error ? t(`photo.error.${avatar.error}`) : null
})

function pick() {
  problem.value = null
  avatar.clearError()
  picker.value?.click()
}

/** The row and the hero's avatar: the picker straight away, or the sheet with her photo. */
function start() {
  if (!online.value) return
  status.value = ''
  if (avatar.path) {
    problem.value = null
    avatar.clearError()
    mode.value = 'menu'
    open.value = true
  } else pick()
}
defineExpose({ start })

function forgetPicture() {
  if (picture.value) URL.revokeObjectURL(picture.value.src)
  picture.value = null
}

async function onPicked() {
  const input = picker.value
  const file = input?.files?.[0]
  // Cleared, so picking the same file again is a change too.
  if (input) input.value = ''
  if (!file) return
  forgetPicture()
  try {
    picture.value = await loadPicture(file)
    mode.value = 'crop'
  } catch {
    problem.value = 'unreadable'
    mode.value = 'menu'
  }
  open.value = true
}

watch(open, (isOpen) => {
  if (!isOpen && !working.value) forgetPicture()
})
onBeforeUnmount(forgetPicture)

// ------------------------------------------------------------------ the crop

const frame = useTemplateRef<HTMLElement>('frame')
const side = ref(0)
const crop = useCrop(() => Math.max(1, side.value))
let observer: ResizeObserver | undefined

watch(frame, (element, _, onCleanup) => {
  if (!element) return
  side.value = element.clientWidth
  const placed = picture.value
  if (placed) crop.open({ width: placed.naturalWidth, height: placed.naturalHeight })
  observer = new ResizeObserver(([entry]) => {
    const next = entry?.contentRect.width ?? 0
    crop.resize(side.value, next)
    side.value = next
  })
  observer.observe(element)
  onCleanup(() => observer?.disconnect())
})

const placement = computed(() => (side.value ? crop.placement() : null))
const zoom = computed({
  get: () => crop.state.zoom,
  set: (value: number) => crop.setZoom(Number(value)),
})
const zoomPercent = computed(() => `${Math.round(zoom.value * 100)} %`)

function onFrameKey(event: KeyboardEvent) {
  if (crop.onKey(event)) event.preventDefault()
}

async function save() {
  const placed = picture.value
  const rect = crop.rect()
  if (!placed || !rect || working.value || !online.value) return
  working.value = true
  try {
    const files = await encodeAvatar(canvasRaster(placed, rect), rect.size)
    if (await avatar.save(files)) {
      status.value = t('photo.saved')
      open.value = false
    }
  } catch {
    problem.value = 'unreadable'
  } finally {
    working.value = false
    if (!open.value) forgetPicture()
  }
}

async function remove() {
  if (avatar.saving || !online.value) return
  if (await avatar.remove()) {
    status.value = t('photo.removed')
    open.value = false
  }
}

const busy = computed(() => working.value || avatar.saving)
const hintId = useId()
</script>

<template>
  <input
    ref="picker"
    type="file"
    accept="image/*"
    hidden
    :aria-label="t('photo.file')"
    data-testid="photo.file"
    @change="onPicked"
  />
  <p class="sr-only" role="status" data-testid="photo.status">{{ status }}</p>

  <UiSheet
    v-model:open="open"
    :title="mode === 'crop' ? t('photo.cropTitle') : t('photo.title')"
    testid="photo"
    :action="mode === 'crop' ? (!online ? t('common.offline') : busy ? t('photo.saving') : t('photo.save')) : undefined"
    :action-disabled="busy || !online || !picture"
    @action="save"
  >
    <div v-if="mode === 'crop'" class="flex flex-col items-center gap-md pb-sm">
      <div
        ref="frame"
        class="frame relative aspect-square touch-none overflow-hidden rounded-md bg-fill select-none"
        tabindex="0"
        role="group"
        :aria-label="t('photo.area')"
        :aria-describedby="hintId"
        data-no-swipe
        data-testid="photo.area"
        @pointerdown="crop.onPointerDown"
        @pointermove="crop.onPointerMove"
        @pointerup="crop.onPointerUp"
        @pointercancel="crop.onPointerUp"
        @wheel="crop.onWheel"
        @keydown="onFrameKey"
      >
        <img
          v-if="picture && placement"
          :src="picture.src"
          alt=""
          draggable="false"
          class="pointer-events-none absolute top-0 left-0 max-w-none origin-top-left"
          :style="{ width: `${placement.width}px`, height: `${placement.height}px`, transform: `translate(${placement.x}px, ${placement.y}px)` }"
          data-testid="photo.picture"
        />
        <!-- The circle the avatar will show; the corners stay visible, dimmed: the upload is the whole square. -->
        <svg class="pointer-events-none absolute inset-0 size-full" viewBox="0 0 100 100" aria-hidden="true">
          <path d="M0 0h100v100H0Z M50 0a50 50 0 1 0 0.001 0Z" fill-rule="evenodd" class="fill-surface-sheet" fill-opacity="0.72" />
          <circle cx="50" cy="50" r="49.75" fill="none" class="stroke-hairline-strong" stroke-width="0.5" />
        </svg>
      </div>

      <div class="flex w-full items-center gap-xs text-ink-muted">
        <button
          type="button"
          class="flex size-(--size-touch) shrink-0 items-center justify-center rounded-pill hover:text-ink disabled:text-ink-ghost"
          :aria-label="t('photo.zoomOut')"
          :disabled="zoom <= 1"
          data-testid="photo.zoomOut"
          @click="zoom = zoom - ZOOM_STEP"
        >
          <UiIcon name="minus" :size="20" />
        </button>
        <input
          v-model.number="zoom"
          type="range"
          min="1"
          :max="MAX_ZOOM"
          step="0.01"
          class="h-(--size-touch) min-w-0 flex-1 accent-accent"
          :aria-label="t('photo.zoom')"
          :aria-valuetext="zoomPercent"
          data-testid="photo.zoom"
        />
        <button
          type="button"
          class="flex size-(--size-touch) shrink-0 items-center justify-center rounded-pill hover:text-ink disabled:text-ink-ghost"
          :aria-label="t('photo.zoomIn')"
          :disabled="zoom >= MAX_ZOOM"
          data-testid="photo.zoomIn"
          @click="zoom = zoom + ZOOM_STEP"
        >
          <UiIcon name="plus" :size="20" />
        </button>
      </div>
      <p :id="hintId" class="text-center text-footnote text-ink-faint">{{ t('photo.hint') }}</p>
      <p v-if="error" class="text-center text-footnote text-error" role="alert" data-testid="photo.error">{{ error }}</p>
    </div>

    <div v-else class="flex flex-col items-center gap-md pt-xs pb-sm text-center">
      <span class="ring relative flex items-center justify-center overflow-hidden rounded-pill bg-surface-raised figures text-title text-ink-muted shadow-cover" aria-hidden="true">
        {{ initials }}
        <img v-if="avatar.large" :src="avatar.large" alt="" class="absolute inset-0 size-full object-cover" data-testid="photo.preview" />
        <span class="pointer-events-none absolute inset-0 rounded-pill edge" />
      </span>
      <p class="text-footnote text-ink-faint">{{ t('photo.private') }}</p>
      <p v-if="error" class="text-footnote text-error" role="alert" data-testid="photo.error">{{ error }}</p>
      <div class="flex w-full flex-col gap-sm">
        <UiButton block :disabled="busy" :offline="!online" data-testid="photo.choose" @click="pick">
          {{ avatar.path ? t('photo.replace') : t('photo.choose') }}
        </UiButton>
        <UiButton v-if="avatar.path" block tone="danger" :disabled="busy" :offline="!online" data-testid="photo.remove" @click="remove">
          {{ avatar.saving ? t('photo.removing') : t('photo.remove') }}
        </UiButton>
      </div>
    </div>
  </UiSheet>
</template>

<style scoped>
/* As wide as the sheet, but never so tall that the slider and Save leave a short screen. */
.frame {
  width: min(100%, 52dvh);
}
.ring {
  width: var(--size-cover-md);
  height: var(--size-cover-md);
}
</style>
