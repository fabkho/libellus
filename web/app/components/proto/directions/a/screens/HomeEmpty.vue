<script setup lang="ts">
// home-empty: a new Member with nothing in the Library. An empty shelf waiting
// for its first cover, and one way forward: search.
import LargeTitle from '../kit/LargeTitle.vue'
import Pill from '../kit/Pill.vue'
import TabBar from '../kit/TabBar.vue'
import Icon from '../kit/Icon.vue'
</script>

<template>
  <div class="screen">
    <LargeTitle title="Home" avatar />

    <div class="empty">
      <div class="shelf" aria-hidden="true">
        <span class="slot" style="height: 112px; transform: rotate(-4deg) translateY(2px)" />
        <span class="slot" style="height: 132px" />
        <span class="slot first"><Icon name="plus" :size="26" :stroke="1.8" /></span>
        <span class="slot" style="height: 120px" />
        <span class="board" />
      </div>

      <h2 class="a-serif">Your shelf is waiting</h2>
      <p>Find the book on your nightstand, or the one you want to read next. It starts here.</p>
      <Pill icon="search">Search books</Pill>
      <p class="aside">Title, author or ISBN — Libellus checks Apple Books and Open Library for you.</p>
    </div>

    <TabBar active="home" />
  </div>
</template>

<style scoped>
.screen {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.empty {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0 36px 150px;
  text-align: center;
}

.shelf {
  position: relative;
  display: flex;
  align-items: flex-end;
  gap: 10px;
  height: 170px;
  margin-bottom: 30px;
  padding: 0 18px;
}

.slot {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 78px;
  height: 120px;
  border-radius: 5px;
  background: linear-gradient(180deg, var(--a-sunk), color-mix(in oklab, var(--a-sunk) 70%, var(--a-paper)));
  box-shadow: inset 0 0 0 1px var(--a-hair);
  transform-origin: bottom center;
}

.slot:nth-child(1),
.slot:nth-child(2),
.slot:nth-child(4) {
  width: 22px;
  border-radius: 3px;
}

.slot.first {
  width: 96px;
  height: 144px;
  background: var(--a-card);
  box-shadow:
    0 0 0 1px color-mix(in oklab, var(--a-accent) 35%, transparent),
    0 14px 30px -12px rgb(40 30 15 / 0.25);
  color: var(--a-accent);
}

.board {
  position: absolute;
  right: 0;
  bottom: -7px;
  left: 0;
  height: 7px;
  border-radius: 3px;
  background: linear-gradient(180deg, #e3dbcd, #d6ccbb);
  box-shadow: 0 6px 12px -6px rgb(40 30 15 / 0.3);
}

h2 {
  margin: 0;
  font-size: 26px;
  font-weight: 600;
}

p {
  margin: 8px 0 24px;
  color: var(--a-ink-2);
  font-size: 15.5px;
  line-height: 1.45;
  text-wrap: pretty;
}

.aside {
  margin: 18px 0 0;
  color: var(--a-ink-3);
  font-size: 13px;
}
</style>
