<script setup lang="ts">
import { computed } from 'vue'
import '~/components/proto/proto.css'
import type { Direction, ScreenKey } from '~/components/proto/contract'
import { resolveToggles, screenGroups, screens } from '~/components/proto/contract'
import { directionByKey, directions } from '~/components/proto/registry'
import Frame from '~/components/proto/shell/Frame.vue'

/**
 * The design playground (issue #4), dev only: nuxt.config.ts strips every
 * `/prototype*` route from production builds.
 *
 * The page owns only the chrome. Directions come from
 * `components/proto/directions/<key>/index.ts` (found by glob in registry.ts),
 * screens from the fixed list in contract.ts. Every selection lives in the
 * query, so a link reproduces the view:
 *
 *   /prototype?d=a&g=book&a.palette=dusk          gallery of direction a, Book group
 *   /prototype?mode=vergleich&s=home              Home in every direction
 *
 * Copy here is hard-coded English on purpose: the playground is a dev tool and
 * stays out of the app's message file.
 */
useHead({ title: 'Libellus — Design playground' })

const route = useRoute()
const router = useRouter()

const query = (name: string) => {
  const value = route.query[name]
  return typeof value === 'string' ? value : undefined
}

const mode = computed(() => (query('mode') === 'vergleich' ? 'vergleich' : 'gallery'))
const direction = computed(() => directionByKey(query('d')))
const group = computed(() => screenGroups.find((g) => g.key === query('g'))?.key ?? 'all')
const compared = computed(() => screens.find((s) => s.key === query('s')) ?? screens[0]!)

const visibleGroups = computed(() =>
  group.value === 'all' ? screenGroups : screenGroups.filter((g) => g.key === group.value),
)

/** Toggle values of one direction, from `?<direction>.<toggle>=<value>`, defaults filled in. */
function togglesOf(d: Direction) {
  const values: Record<string, string | undefined> = {}
  for (const toggle of d.toggles ?? []) values[toggle.key] = query(`${d.key}.${toggle.key}`)
  return resolveToggles(d, values)
}

/** Directions whose toggles the header shows: the selected one, or all in Vergleich. */
const toggleOwners = computed(() =>
  (mode.value === 'vergleich' ? directions : direction.value ? [direction.value] : []).filter(
    (d) => d.toggles?.length,
  ),
)

function set(patch: Record<string, string | undefined>) {
  const next = { ...route.query, ...patch }
  for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key]
  router.replace({ query: next })
}

function builtCount(d: Direction) {
  return screens.filter((s) => d.screens[s.key as ScreenKey]).length
}

// The screenshot script (scripts/proto-shots.mjs) reads what to shoot from here.
if (import.meta.client) {
  ;(window as unknown as { __proto: unknown }).__proto = {
    directions: directions.map((d) => d.key),
    screens: screens.map((s) => s.key),
  }
}
</script>

<template>
  <div class="min-h-dvh bg-neutral-200 font-sans text-neutral-900">
    <header data-proto-chrome class="sticky top-0 z-40 border-b border-neutral-300 bg-white/95 backdrop-blur">
      <div class="flex flex-wrap items-center gap-x-8 gap-y-3 px-6 py-3">
        <div class="mr-2">
          <p class="text-[10px] font-semibold tracking-[1.4px] text-neutral-400 uppercase">Libellus</p>
          <p class="text-[15px] font-semibold">Design playground</p>
        </div>

        <div class="flex items-center gap-3">
          <span class="text-[10px] font-semibold tracking-[1.2px] text-neutral-400 uppercase">Mode</span>
          <div class="flex rounded-full bg-neutral-100 p-[3px]">
            <button
              v-for="option in [
                { key: 'gallery', label: 'Gallery' },
                { key: 'vergleich', label: 'Vergleich' },
              ]"
              :key="option.key"
              type="button"
              class="rounded-full px-3 py-[6px] text-[13px] font-medium whitespace-nowrap"
              :class="option.key === mode ? 'bg-white shadow-sm' : 'text-neutral-500'"
              @click="set({ mode: option.key === 'gallery' ? undefined : option.key })"
            >
              {{ option.label }}
            </button>
          </div>
        </div>

        <div v-if="mode === 'gallery'" class="flex items-center gap-3">
          <span class="text-[10px] font-semibold tracking-[1.2px] text-neutral-400 uppercase">Direction</span>
          <div class="flex rounded-full bg-neutral-100 p-[3px]">
            <button
              v-for="entry in directions"
              :key="entry.key"
              type="button"
              :data-direction-option="entry.key"
              class="rounded-full px-3 py-[6px] text-[13px] font-medium whitespace-nowrap"
              :class="entry.key === direction?.key ? 'bg-white shadow-sm' : 'text-neutral-500'"
              @click="set({ d: entry.key })"
            >
              <span class="uppercase">{{ entry.key }}</span> {{ entry.title }}
            </button>
          </div>
        </div>

        <div v-if="mode === 'gallery'" class="flex items-center gap-3">
          <span class="text-[10px] font-semibold tracking-[1.2px] text-neutral-400 uppercase">Screens</span>
          <div class="flex rounded-full bg-neutral-100 p-[3px]">
            <button
              v-for="option in [{ key: 'all', title: 'All' }, ...screenGroups]"
              :key="option.key"
              type="button"
              class="rounded-full px-3 py-[6px] text-[13px] font-medium whitespace-nowrap"
              :class="option.key === group ? 'bg-white shadow-sm' : 'text-neutral-500'"
              @click="set({ g: option.key === 'all' ? undefined : option.key })"
            >
              {{ option.title }}
            </button>
          </div>
        </div>

        <label v-else class="flex items-center gap-3">
          <span class="text-[10px] font-semibold tracking-[1.2px] text-neutral-400 uppercase">Screen</span>
          <select
            class="rounded-full border border-neutral-300 bg-white px-3 py-[6px] text-[13px]"
            :value="compared.key"
            @change="set({ s: ($event.target as HTMLSelectElement).value })"
          >
            <optgroup v-for="entry in screenGroups" :key="entry.key" :label="entry.title">
              <option v-for="screen in entry.screens" :key="screen.key" :value="screen.key">
                {{ screen.title }} — {{ screen.state }}
              </option>
            </optgroup>
          </select>
        </label>
      </div>

      <!-- Per-direction toggles: the selected direction's, or every direction's in Vergleich. -->
      <div v-if="toggleOwners.length" class="flex flex-col gap-2 px-6 pb-3">
        <div v-for="owner in toggleOwners" :key="owner.key" class="flex flex-wrap items-center gap-x-6 gap-y-2">
          <span v-if="mode === 'vergleich'" class="w-28 text-[12px] font-semibold text-neutral-600">
            <span class="uppercase">{{ owner.key }}</span> {{ owner.title }}
          </span>
          <div v-for="toggle in owner.toggles" :key="toggle.key" class="flex items-center gap-2">
            <span class="text-[10px] font-semibold tracking-[1.2px] text-neutral-400 uppercase">{{
              toggle.label
            }}</span>
            <div class="flex rounded-full bg-neutral-100 p-[3px]">
              <button
                v-for="option in toggle.options"
                :key="option.value"
                type="button"
                class="rounded-full px-[10px] py-[4px] text-[12px] font-medium whitespace-nowrap"
                :class="
                  togglesOf(owner)[toggle.key] === option.value ? 'bg-white shadow-sm' : 'text-neutral-500'
                "
                @click="
                  set({ [`${owner.key}.${toggle.key}`]: option.value === toggle.default ? undefined : option.value })
                "
              >
                {{ option.label }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>

    <main v-if="!directions.length" class="px-6 pt-9 text-[13px] text-neutral-500">
      No direction yet: add <code>components/proto/directions/&lt;key&gt;/index.ts</code>.
    </main>

    <!-- Gallery: every screen of one direction, by group. -->
    <main v-else-if="mode === 'gallery' && direction" class="px-6 pb-16">
      <section class="max-w-[960px] pt-7">
        <h1 class="text-[20px] font-semibold">
          <span class="uppercase">{{ direction.key }}</span> · {{ direction.title }}
        </h1>
        <p class="mt-1 text-[14px] leading-[1.5] text-neutral-600">{{ direction.summary }}</p>
        <p class="mt-1 text-[12px] text-neutral-400">{{ builtCount(direction) }} of {{ screens.length }} screens built</p>
      </section>

      <section v-for="entry in visibleGroups" :id="entry.key" :key="entry.key" class="scroll-mt-[140px] pt-9">
        <h2 class="mb-4 text-[17px] font-semibold">{{ entry.title }}</h2>
        <div class="flex flex-wrap items-start gap-7">
          <Frame
            v-for="screen in entry.screens"
            :key="`${direction.key}-${screen.key}`"
            :direction="direction"
            :screen="screen.key"
            :toggles="togglesOf(direction)"
            :label="screen.title"
            :caption="screen.state"
            :shot="`${direction.key}--${screen.key}`"
          />
        </div>
      </section>
    </main>

    <!-- Vergleich: one screen, once per direction. -->
    <main v-else class="px-6 pt-9 pb-16">
      <div class="mb-4 flex items-baseline gap-3">
        <h2 class="text-[17px] font-semibold">
          {{ compared.groupTitle === compared.title ? compared.title : `${compared.groupTitle} · ${compared.title}` }}
        </h2>
        <span class="text-[12px] text-neutral-500">{{ compared.state }}</span>
      </div>
      <div class="-mx-6 overflow-x-auto px-6 pb-2">
        <div class="flex w-max items-start gap-7" :data-shot="`vergleich--${compared.key}`">
          <Frame
            v-for="entry in directions"
            :key="`${entry.key}-${compared.key}`"
            :direction="entry"
            :screen="compared.key"
            :toggles="togglesOf(entry)"
            :label="`${entry.key.toUpperCase()} ${entry.title}`"
          />
        </div>
      </div>
    </main>
  </div>
</template>
