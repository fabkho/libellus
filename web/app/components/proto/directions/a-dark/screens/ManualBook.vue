<script setup lang="ts">
// manual-book: the "Add manually" sheet over the empty search. Title and
// author required, ISBN and pages optional; the generated Placeholder cover
// previews what the shelf will show. Manual books stay private.
import { useProto } from '../../../contract'
import Cover from '../kit/Cover.vue'
import FormGroup from '../kit/FormGroup.vue'
import FormRow from '../kit/FormRow.vue'
import Icon from '../kit/Icon.vue'
import Pill from '../kit/Pill.vue'
import Sheet from '../kit/Sheet.vue'
import Search from './Search.vue'

const proto = useProto()
</script>

<template>
  <div class="host">
    <Search state="empty" />
    <Sheet title="Add manually">
      <div class="stack">
        <div class="preview">
          <Cover
            :book="{ title: proto.data.manualDraft.title, authors: proto.data.manualDraft.authors, coverUrl: null }"
            :width="84"
            shadow="lift"
          />
          <div class="preview-text">
            <span class="preview-label">Generated cover</span>
            <span class="preview-body">Drawn from the title and author. It updates as you type.</span>
            <span class="private"><Icon name="lock" :size="14" :stroke="2" />Only you can see this book</span>
          </div>
        </div>

        <FormGroup>
          <FormRow label="Title" :value="proto.data.manualDraft.title" stacked required />
          <FormRow label="Author" :value="proto.data.manualDraft.authors[0]" stacked required focus />
        </FormGroup>

        <FormGroup footer="Books you type in stay out of the shared catalogue.">
          <FormRow label="ISBN" placeholder="Optional" />
          <FormRow label="Pages" :value="proto.data.manualDraft.pageCount" />
        </FormGroup>

        <Pill icon="plus" block>Add to Library</Pill>
      </div>
    </Sheet>
  </div>
</template>

<style scoped>
.host {
  position: relative;
  height: 100%;
}

.stack {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-bottom: 6px;
}

.preview {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 4px 4px 6px;
}

.preview-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.preview-label {
  font-size: 16px;
  font-weight: 600;
}

.preview-body {
  color: var(--ad-ink-2);
  font-size: 13.5px;
  line-height: 1.35;
}

.private {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  gap: 5px;
  margin-top: 8px;
  padding: 5px 10px 5px 8px;
  border-radius: 999px;
  background: var(--ad-fill);
  color: var(--ad-ink);
  font-size: 12.5px;
  font-weight: 600;
}
</style>
