<script setup lang="ts">
// manual-book: the "Add manually" sheet over the empty search. Title and
// author required, ISBN and pages optional; the generated Placeholder cover —
// an Insel-style label on the accent — previews what the shelf will show.
import { useProto } from '../../../contract'
import Button from '../kit/Button.vue'
import Cover from '../kit/Cover.vue'
import Field from '../kit/Field.vue'
import Icon from '../kit/Icon.vue'
import Sheet from '../kit/Sheet.vue'
import Search from './Search.vue'

const proto = useProto()
</script>

<template>
  <div class="over">
    <Search state="empty" />
    <Sheet title="Add manually" action="Add">
      <div class="stack">
        <div class="preview">
          <Cover
            :book="{ title: proto.data.manualDraft.title, authors: proto.data.manualDraft.authors, coverUrl: null }"
            :width="84"
            plate
          />
          <div class="preview-text">
            <span class="b-label b-muted">Cover</span>
            <p class="b-italic">Set from the title and author. Change either and it follows.</p>
            <p class="private"><Icon name="lock" :size="16" :stroke="1.5" />Only you can see it.</p>
          </div>
        </div>

        <Field label="Title" :value="proto.data.manualDraft.title" />
        <Field label="Author" :value="proto.data.manualDraft.authors[0]" focus />
        <div class="pair">
          <div class="isbn"><Field label="ISBN" placeholder="Optional" /></div>
          <div class="pages"><Field label="Pages" :value="proto.data.manualDraft.pageCount" /></div>
        </div>

        <Button>Add to Library</Button>
      </div>
    </Sheet>
  </div>
</template>

<style scoped>
.over {
  position: relative;
  height: 100%;
}

.stack {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.preview {
  display: flex;
  align-items: flex-start;
  gap: 18px;
  padding-bottom: 4px;
}

.preview-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: 4px;
}

.preview-text p {
  margin: 0;
  font-size: 15px;
  line-height: 20px;
  color: var(--b-ink-2);
}

.preview-text .private {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  font-style: normal;
  color: var(--b-ink);
}

.pair {
  display: flex;
  gap: 20px;
}

.isbn {
  flex: 1;
}

.pages {
  width: 96px;
}
</style>
