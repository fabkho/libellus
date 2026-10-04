<script setup lang="ts">
// Design round #65 (with #60): "Your page count" — the member's own total for
// this read, over the edition's. For an ebook (the reader counts its own pages
// by font size) and for a book without a page count, which then counts in
// pages too. The edition's count stays one tap away.
import { n, setTotal, totalOf, type ProtoRead } from './model'

const props = defineProps<{ read: ProtoRead | null }>()
const open = defineModel<boolean>('open', { required: true })

const kept = ref<ProtoRead | null>(props.read)
watch(
  () => props.read,
  (value) => value && (kept.value = value),
)
const field = ref('')
watch(open, (value) => {
  if (value && kept.value) field.value = String(totalOf(kept.value) ?? '')
})
const edition = computed(() => kept.value?.book.pageCount ?? null)
const number = computed(() => (/^\d{1,5}$/.test(field.value.trim()) ? Number(field.value) : null))
const error = computed(() => (field.value.trim() && (!number.value || number.value < 1) ? 'A whole number of pages, at least 1.' : null))

function save() {
  if (!kept.value || !number.value) return
  setTotal(kept.value, number.value)
  open.value = false
}
function useEdition() {
  if (!kept.value) return
  setTotal(kept.value, null)
  open.value = false
}
</script>

<template>
  <UiSheet v-model:open="open" title="Page count" testid="protoTotal" action="Save" :action-disabled="!number" @action="save">
    <template v-if="kept">
      <UiBookLine
        :title="kept.book.title"
        :authors="kept.book.authors"
        :src="coverSrc(kept.book.coverUrl, 'xs')"
        :thumbhash="kept.book.coverThumbhash"
        :colors="kept.book.coverColors"
      />
      <UiField
        id="proto-total"
        v-model="field"
        label="Pages in your copy"
        :error="error"
        type="text"
        inputmode="numeric"
        enterkeyhint="done"
        placeholder="0"
        class="figures"
        data-autofocus
        data-testid="protoTotal.value"
        @keydown.enter="save"
      />
      <p class="mt-sm text-caption text-ink-faint">
        {{
          kept.book.format === 'ebook'
            ? 'Ebook readers count pages by font size. Use the total your reader shows, and progress follows it.'
            : 'This edition has no page count. Add yours to count in pages.'
        }}
      </p>
      <div v-if="kept.total" class="mt-md">
        <UiButton tone="plain" size="sm" class="-ml-sm" data-testid="protoTotal.edition" @click="useEdition">
          {{ edition ? `Use the edition's ${n(edition)}` : 'Count in percent again' }}
        </UiButton>
      </div>
      <div class="h-lg" />
    </template>
  </UiSheet>
</template>
