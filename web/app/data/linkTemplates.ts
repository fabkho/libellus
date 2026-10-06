import type { SupabaseClient } from '@supabase/supabase-js'
import { isbn10To13, type BookSnapshot } from './books'
import { LOCAL_DATA_PREFIX, type DeviceStorage } from './localData'

/**
 * Book links (issue #116): a short, ordered list of links a Book's page offers,
 * each a label and a URL template whose placeholders are filled from the Book:
 *
 *   {isbn}    the ISBN-13 (from the ISBN-10 when that is all the Book has)
 *   {isbn10}  the ISBN-10 (from a 978 ISBN-13 when that is all it has)
 *   {title}   the title
 *   {author}  the first author
 *
 * every value URL-encoded. A link whose placeholder the Book cannot fill (no
 * ISBN) is left out for that Book. Nothing is looked up or checked: they are
 * just links, in the member's order. The first is the page's link, the rest
 * wait behind More (components/book/Links.vue).
 *
 * Two lists, the instance's first: the defaults an operator builds into the
 * app (`NUXT_PUBLIC_LINK_TEMPLATES`, JSON, public like all of the built config)
 * and the member's own (`link_templates`, hers alone by RLS, written whole
 * through `set_link_templates`; supabase/migrations/20261006090000_link_templates.sql).
 *
 * Framework-free: the repository receives the Supabase client and the online
 * check; the pure part is what a native port copies 1:1.
 */

export type LinkTemplate = { label: string; url: string }

/** A filled template: what the Book page links to. */
export type BookLink = { label: string; href: string }

/** The Book as far as a link needs it. */
export type LinkBook = Pick<BookSnapshot, 'title' | 'authors' | 'isbn13' | 'isbn10'>

/** The database's limits (link_templates_valid). */
export const LINK_TEMPLATES_MAX = 20
export const LINK_LABEL_MAX = 40
export const LINK_URL_MAX = 2000

export const LINK_PLACEHOLDERS = ['isbn', 'isbn10', 'title', 'author'] as const
export type LinkPlaceholder = (typeof LINK_PLACEHOLDERS)[number]

const PLACEHOLDER = /\{(\w+)\}/g

/** ISBN-13 → ISBN-10, for a 978 one; null for a 979 (it has none). */
export function isbn13To10(isbn13: string): string | null {
  if (!/^978\d{10}$/.test(isbn13)) return null
  const body = isbn13.slice(3, 12)
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * (10 - index), 0)
  const check = (11 - (sum % 11)) % 11
  return `${body}${check === 10 ? 'X' : check}`
}

/** What each placeholder stands for in this Book; null when it has nothing for it. */
export function placeholderValues(book: LinkBook): Record<LinkPlaceholder, string | null> {
  const isbn = book.isbn13 ?? (book.isbn10 ? isbn10To13(book.isbn10) : null)
  const title = book.title.trim()
  const author = book.authors.find((name) => name.trim())?.trim() ?? null
  return {
    isbn,
    isbn10: book.isbn10 ?? (isbn ? isbn13To10(isbn) : null),
    title: title || null,
    author,
  }
}

/** The template filled for this Book, every value URL-encoded; null when a placeholder has no value. */
export function fillLinkTemplate(url: string, book: LinkBook): string | null {
  const values = placeholderValues(book)
  let missing = false
  const filled = url.replace(PLACEHOLDER, (whole, name: string) => {
    if (!(LINK_PLACEHOLDERS as readonly string[]).includes(name)) return whole
    const value = values[name as LinkPlaceholder]
    if (value == null) {
      missing = true
      return whole
    }
    return encodeURIComponent(value)
  })
  return missing ? null : filled
}

/** The Book's links from these templates, in their order, without the ones it cannot fill. */
export function bookLinks(templates: readonly LinkTemplate[], book: LinkBook): BookLink[] {
  const links: BookLink[] = []
  for (const template of templates) {
    const href = fillLinkTemplate(template.url, book)
    if (href) links.push({ label: template.label, href })
  }
  return links
}

/** Why a template cannot be saved; the copy lives under `links.error.<code>`. */
export type LinkTemplateProblem = 'label_missing' | 'label_long' | 'url_invalid' | 'url_long' | 'placeholder_unknown'

/** The database's own test of a URL (link_templates_valid): http(s), a host without a placeholder. */
const URL_SHAPE = /^https?:\/\/[^\s/?#{}]+([/?#]\S*)?$/i

/** What is wrong with a template (its label and URL as typed); null when it can be saved. */
export function linkTemplateProblem(template: LinkTemplate): LinkTemplateProblem | null {
  const label = template.label.trim()
  const url = template.url.trim()
  if (!label) return 'label_missing'
  if (label.length > LINK_LABEL_MAX) return 'label_long'
  if (url.length > LINK_URL_MAX) return 'url_long'
  if (!URL_SHAPE.test(url)) return 'url_invalid'
  for (const [, name] of url.matchAll(PLACEHOLDER)) {
    if (!(LINK_PLACEHOLDERS as readonly string[]).includes(name!)) return 'placeholder_unknown'
  }
  // Filled with a sample, it has to be an address a browser opens.
  const sample = fillLinkTemplate(url, { title: 'Title', authors: ['Author'], isbn13: '9780000000002', isbn10: '0000000000' })
  try {
    const parsed = new URL(sample!)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'url_invalid'
  } catch {
    return 'url_invalid'
  }
  return null
}

/** A template the way the database stores it: label and URL trimmed. */
export function cleanLinkTemplate(template: LinkTemplate): LinkTemplate {
  return { label: template.label.trim(), url: template.url.trim() }
}

/** Templates from wherever they come (the build's JSON, a saved copy, the database): the valid ones, in order. */
export function parseLinkTemplates(raw: unknown): LinkTemplate[] {
  let value = raw
  if (typeof value === 'string') {
    if (!value.trim()) return []
    try {
      value = JSON.parse(value)
    } catch {
      return []
    }
  }
  if (!Array.isArray(value)) return []
  const templates: LinkTemplate[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const { label, url } = item as Record<string, unknown>
    if (typeof label !== 'string' || typeof url !== 'string') continue
    const template = cleanLinkTemplate({ label, url })
    if (linkTemplateProblem(template) === null) templates.push(template)
    if (templates.length === LINK_TEMPLATES_MAX) break
  }
  return templates
}

// ------------------------------------------------------------------- the repository

export type LinkTemplatesErrorCode = 'link_templates_invalid' | 'not_signed_in' | 'offline' | 'unknown'
export type LinkTemplatesResult<T> = { data: T; error: null } | { data: null; error: LinkTemplatesErrorCode }

export type LinkTemplates = {
  /** The member's own list, in her order; empty when she has none. */
  load: () => Promise<LinkTemplatesResult<LinkTemplate[]>>
  /** Replaces her list with this one (an empty one clears it). Refused offline, before anything is sent. */
  save: (templates: readonly LinkTemplate[]) => Promise<LinkTemplatesResult<LinkTemplate[]>>
}

function mapError(failure: { message?: string; code?: string }): LinkTemplatesErrorCode {
  const message = failure.message ?? ''
  if (message.includes('link_templates_invalid')) return 'link_templates_invalid'
  if (message.includes('not_signed_in') || failure.code === '42501' || failure.code === 'PGRST301') return 'not_signed_in'
  return 'unknown'
}

export function createLinkTemplates(client: SupabaseClient, { online = () => true }: { online?: () => boolean } = {}): LinkTemplates {
  return {
    async load() {
      // RLS hands her her own row only; none yet is an empty list.
      const { data, error } = await client.from('link_templates').select('templates').maybeSingle()
      if (error) return { data: null, error: mapError(error) }
      return { data: parseLinkTemplates(data?.templates ?? []), error: null }
    },

    async save(templates) {
      const list = templates.map(cleanLinkTemplate)
      if (list.length > LINK_TEMPLATES_MAX || list.some((template) => linkTemplateProblem(template) !== null)) {
        return { data: null, error: 'link_templates_invalid' }
      }
      if (!online()) return { data: null, error: 'offline' }
      const { data, error } = await client.rpc('set_link_templates', { p_templates: list }).single<{ templates: unknown }>()
      if (error) return { data: null, error: mapError(error) }
      return { data: parseLinkTemplates(data?.templates ?? []), error: null }
    },
  }
}

// --------------------------------------------------------------- the device's copy

/** The member's list as this device last saw it, so a Book's page has her links offline too. */
export const DEVICE_LINK_TEMPLATES_KEY = `${LOCAL_DATA_PREFIX}linkTemplates`

export function saveDeviceLinkTemplates(storage: DeviceStorage, memberId: string, templates: readonly LinkTemplate[]): void {
  try {
    storage.setItem(DEVICE_LINK_TEMPLATES_KEY, JSON.stringify({ memberId, templates }))
  } catch {
    // Full or switched off: the page shows them once they are loaded.
  }
}

export function readDeviceLinkTemplates(storage: DeviceStorage, memberId: string): LinkTemplate[] | null {
  try {
    const saved = JSON.parse(storage.getItem(DEVICE_LINK_TEMPLATES_KEY) ?? 'null') as { memberId?: string; templates?: unknown } | null
    return saved?.memberId === memberId ? parseLinkTemplates(saved.templates) : null
  } catch {
    return null
  }
}
