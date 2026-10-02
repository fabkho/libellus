/**
 * Finds every direction by folder: `directions/<key>/index.ts`, default export a
 * `Direction`. Adding a folder adds a direction; nothing else is edited.
 */
import type { Direction } from './contract'

const modules = import.meta.glob<{ default: Direction }>('./directions/*/index.ts', { eager: true })

function load(): Direction[] {
  const found: Direction[] = []
  for (const [path, module] of Object.entries(modules)) {
    const folder = path.split('/').at(-2)!
    const direction = module.default
    if (!direction?.key || !direction.screens) {
      console.warn(`[proto] ${path} has no default-exported Direction; skipped.`)
      continue
    }
    if (direction.key !== folder) {
      console.warn(`[proto] ${path}: key "${direction.key}" should match its folder "${folder}".`)
    }
    found.push(direction)
  }
  // The wireframe first (the baseline), then the directions by key.
  return found.sort((a, b) => (a.key === 'ref' ? -1 : b.key === 'ref' ? 1 : a.key.localeCompare(b.key)))
}

export const directions: Direction[] = load()

/** The direction the gallery opens with: the first real one, else the wireframe. */
export const defaultDirection: Direction | undefined = directions.find((d) => d.key !== 'ref') ?? directions[0]

export function directionByKey(key: unknown): Direction | undefined {
  return directions.find((d) => d.key === key) ?? defaultDirection
}
