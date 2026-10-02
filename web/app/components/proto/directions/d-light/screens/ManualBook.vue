<script setup lang="ts">
// manual-book: "Add manually" over the empty search. Title and author
// required, ISBN and pages optional; the Placeholder cover previews what the
// shelf will show. Private to the Member.
import { useProto } from '../../../contract'
import Button from '../kit/Button.vue'
import Cover from '../kit/Cover.vue'
import Icon from '../kit/Icon.vue'
import Row from '../kit/Row.vue'
import Sheet from '../kit/Sheet.vue'
import Search from './Search.vue'

const proto = useProto()
</script>

<template>
  <Sheet title="Add manually" action="Add">
    <template #under><Search state="empty" /></template>

    <div class="preview">
      <Cover
        :book="{ title: proto.data.manualDraft.title, authors: proto.data.manualDraft.authors, coverUrl: null }"
        :width="92"
      />
      <span class="caption">Generated cover · you can add a photo later</span>
    </div>

    <div class="dl-group">
      <Row label="Title" :value="proto.data.manualDraft.title" required />
      <Row label="Author" :value="proto.data.manualDraft.authors[0]" required focus />
    </div>
    <div class="dl-group second">
      <Row label="ISBN" placeholder="Optional" mono />
      <Row label="Pages" :value="proto.data.manualDraft.pageCount" mono />
    </div>

    <p class="private"><Icon name="lock" :size="15" />Only you can see this book. It stays out of the shared catalogue.</p>

    <Button block>Add to Library</Button>
  </Sheet>
</template>

<style scoped>
.preview {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 4px 0 20px;
}

.caption {
  font-size: 12px;
  color: var(--dl-ink-3);
}

.second {
  margin-top: 12px;
}

.private {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 16px 4px 18px;
  font-size: 12.5px;
  line-height: 1.4;
  color: var(--dl-ink-3);
}

.private :deep(svg) {
  margin-top: 1px;
}
</style>
