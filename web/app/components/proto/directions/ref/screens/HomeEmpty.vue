<script setup lang="ts">
// home-empty: a new Member with nothing in the Library. One way forward: search.
import Button from '../kit/Button.vue'
import NavBar from '../kit/NavBar.vue'
import TabBar from '../kit/TabBar.vue'
</script>

<template>
  <div class="relative flex h-full flex-col bg-white">
    <NavBar title="Home" avatar />

    <div class="flex flex-1 flex-col items-center justify-center gap-3 px-10 pb-[140px] text-center">
      <span
        class="mb-2 flex size-28 items-center justify-center rounded-2xl border-2 border-dashed border-neutral-300 text-[11px] text-neutral-400"
        >Illustration</span
      >
      <p class="text-[20px] font-semibold">Nothing here yet</p>
      <p class="text-[15px] text-neutral-600">
        Search for the book you're reading or the one you want to read next.
      </p>
      <div class="mt-3 w-48"><Button>Search books</Button></div>
    </div>

    <TabBar active="home" />
  </div>
</template>
