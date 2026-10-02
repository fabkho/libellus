<script setup lang="ts">
// home-empty: a new Member, nothing in the Library yet. An empty shelf
// between two bookends with a pencil outline of the first book, and one
// way forward: search.
import Button from '../kit/Button.vue'
import Icon from '../kit/Icon.vue'
import NavBar from '../kit/NavBar.vue'
import Plank from '../kit/Plank.vue'
import TabBar from '../kit/TabBar.vue'
import { useShelf } from '../kit/useShelf'

const { data } = useShelf()
</script>

<template>
  <div class="screen c-paper-grain">
    <NavBar kicker="Welcome to Libellus" :title="`Hi, ${data.member.firstName}`" avatar />

    <div class="body">
      <div class="art" aria-hidden="true">
        <Plank :inset="26" :gap="0" align="center">
          <span class="end left" />
          <span class="ghost">
            <span class="plus"><Icon name="plus" :size="22" /></span>
          </span>
          <span class="ghost thin" />
          <span class="end right" />
        </Plank>
      </div>

      <h2>Your shelf is empty</h2>
      <p>Search for the book on your nightstand, or the one you want to read next. It lands right here.</p>
      <Button inline><Icon name="search" :size="20" />Find a book</Button>
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

.body {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 0 36px 150px;
  text-align: center;
}

.art {
  width: 290px;
  margin-bottom: 26px;
}

.end {
  position: relative;
  flex-shrink: 0;
  width: 12px;
  height: 92px;
  border-radius: 6px 6px 2px 2px;
  background: var(--c-accent);
  box-shadow: inset -3px 0 0 rgb(0 0 0 / 0.15);
}

.end.left {
  margin-right: 46px;
  transform: rotate(-3deg);
  transform-origin: bottom right;
}

.end.right {
  margin-left: 70px;
}

.ghost {
  display: grid;
  place-items: center;
  width: 48px;
  height: 150px;
  margin-right: 6px;
  border: 2px dashed var(--c-line-strong);
  border-bottom: 0;
  border-radius: 6px 6px 0 0;
}

.ghost.thin {
  width: 30px;
  height: 128px;
  opacity: 0.6;
}

.plus {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--c-mustard-soft);
  color: var(--c-ink);
}

h2 {
  margin: 0;
  font-family: var(--c-serif);
  font-size: 28px;
  font-weight: 400;
}

p {
  margin: 0 0 16px;
  font-size: 16px;
  line-height: 1.45;
  color: var(--c-ink-soft);
}
</style>
