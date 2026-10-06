<script setup lang="ts">
// The member's initials in mono inside a hairline ring, or her photo (issue
// #156) over them. The initials stay underneath, so the circle is never empty
// and nothing moves: a photo the avatar mounts with (the device's copy) simply
// draws over them as it decodes; one that comes while it is on screen (the
// first download, a new photo) fades in over `standard` once decoded. Drawing
// only: the button around it is the 44 px target and carries the label.
const props = defineProps<{ initials: string; photo?: string | null }>()

/** The photo changed while on screen: it waits for its decode, then fades in. */
const arriving = ref(false)
const decoded = ref(false)
watch(
  () => props.photo,
  () => {
    arriving.value = true
    decoded.value = false
  },
)
</script>

<template>
  <span
    class="relative flex size-(--size-avatar) items-center justify-center overflow-hidden rounded-pill bg-fill figures text-meta font-medium text-ink-muted"
    aria-hidden="true"
  >
    {{ initials }}
    <img
      v-if="photo"
      :key="photo"
      :src="photo"
      alt=""
      draggable="false"
      class="absolute inset-0 size-full object-cover"
      :class="arriving && ['transition-opacity duration-standard ease-standard', decoded ? 'opacity-100' : 'opacity-0']"
      data-avatar-photo
      @load="decoded = true"
    />
    <!-- The hairline ring over the photo too. -->
    <span class="pointer-events-none absolute inset-0 rounded-pill edge" />
  </span>
</template>
