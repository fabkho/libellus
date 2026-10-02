<script setup lang="ts">
// manual-book: the "Add manually" sheet over the empty search. Title and
// author required, ISBN and pages optional. The Placeholder cover — a
// cloth-bound board with the title blind-stamped — previews live, and the
// pages set how thick its spine will stand on the shelf.
import { computed } from 'vue'
import Button from '../kit/Button.vue'
import Cover from '../kit/Cover.vue'
import Field from '../kit/Field.vue'
import Icon from '../kit/Icon.vue'
import Sheet from '../kit/Sheet.vue'
import Spine from '../kit/Spine.vue'
import { useShelf } from '../kit/useShelf'
import Search from './Search.vue'

const { data } = useShelf()
const draft = computed(() => data.value.manualDraft)
const preview = computed(() => ({
  title: draft.value.title,
  authors: draft.value.authors,
  coverUrl: null,
  coverColors: null,
  pageCount: Number(draft.value.pageCount) || null,
}))
</script>

<template>
  <div class="wrap">
    <Search state="empty" />
    <Sheet title="Add manually" action="Add">
      <div class="top">
        <div class="preview">
          <div class="objects">
            <Cover :book="preview" :width="78" :lift="2" :tilt="-3" />
            <Spine :book="preview" :scale="0.62" class="spine" />
          </div>
          <span class="caption">Generated cover</span>
        </div>
        <div class="fields">
          <Field label="Title" :value="draft.title" required />
          <Field label="Author" :value="draft.authors[0]" required focus />
        </div>
      </div>
      <div class="pair">
        <Field label="ISBN" placeholder="Optional" class="isbn" />
        <Field label="Pages" :value="draft.pageCount" class="pages" />
      </div>
      <p class="private"><Icon name="lock" :size="16" />Only you can see books you add by hand.</p>
      <Button><Icon name="plus" :size="20" />Add to Library</Button>
    </Sheet>
  </div>
</template>

<style scoped>
.wrap {
  position: relative;
  height: 100%;
}

.top {
  display: flex;
  gap: 14px;
  padding-top: 4px;
}

.preview {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  width: 100px;
}

.objects {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  height: 150px;
}

.spine {
  margin-bottom: 4px;
}

.caption {
  font-size: 12px;
  font-weight: 700;
  color: var(--c-ink-soft);
}

.fields {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}

.pair {
  display: flex;
  gap: 12px;
  margin-top: 14px;
}

.isbn {
  flex: 1;
}

.pages {
  flex: 0 0 110px;
}

.private {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 14px 0 16px;
  padding: 10px 12px;
  border-radius: 14px;
  background: var(--c-teal-soft);
  font-size: 14px;
  font-weight: 600;
  color: var(--c-teal);
}
</style>
