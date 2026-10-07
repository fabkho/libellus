import { defineStore } from 'pinia'
import { applyGlass, readGlass, writeGlass, type GlassLevel } from '~/utils/glass'

/**
 * How much the glass blurs, the owner's setting on this device (utils/glass.ts
 * has the rule). Read and put on the page once at boot (plugins/theme.client.ts);
 * a change is stored and shown at once.
 */
export const useGlassStore = defineStore('glass', () => {
  const level = ref<GlassLevel>('strong')

  /** Run once at boot: reads the stored level and puts it on the page. */
  function start() {
    if (!import.meta.client) return
    level.value = readGlass(window.localStorage)
    applyGlass(document, level.value)
  }

  function set(next: GlassLevel) {
    level.value = next
    if (!import.meta.client) return
    writeGlass(window.localStorage, next)
    applyGlass(document, next)
  }

  return { level, start, set }
})
