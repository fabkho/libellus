/**
 * The inline markup of the legal texts (legal/types.ts): `[[PLACEHOLDER]]`, `[label](href)` and
 * `**bold**`, in a paragraph or a list item. Parsed into parts the component draws, so no HTML is ever
 * built from a string (no `v-html`).
 */
export type InlinePart =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'link'; text: string; href: string }
  | { kind: 'placeholder'; text: string }

// `[[...]]` first, so a placeholder is never read as a link label.
const TOKEN = /\[\[([^\]]+)\]\]|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*/g

export function parseInline(source: string): InlinePart[] {
  const parts: InlinePart[] = []
  let last = 0
  for (const match of source.matchAll(TOKEN)) {
    const at = match.index ?? 0
    if (at > last) parts.push({ kind: 'text', text: source.slice(last, at) })
    if (match[1] !== undefined) parts.push({ kind: 'placeholder', text: `[[${match[1]}]]` })
    else if (match[2] !== undefined) parts.push({ kind: 'link', text: match[2], href: match[3]! })
    else parts.push({ kind: 'bold', text: match[4]! })
    last = at + match[0].length
  }
  if (last < source.length) parts.push({ kind: 'text', text: source.slice(last) })
  return parts
}

/** Every placeholder in a text, as written (`[[EMAIL ADDRESS]]`), once each, in order of appearance. */
export function placeholdersIn(source: string): string[] {
  return [...new Set([...source.matchAll(/\[\[[^\]]+\]\]/g)].map((match) => match[0]))]
}

/** An address inside the app (`/imprint`): a router link, and the one that keeps the text's language. */
export const isAppPath = (href: string) => href.startsWith('/')
