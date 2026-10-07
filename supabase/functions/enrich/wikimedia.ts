/**
 * Wikimedia Commons (an author's portrait and its licence) and Wikipedia (an
 * author's short intro). Pure, no I/O.
 *
 * Both need crediting where they are shown: a Commons photo with its author
 * and licence (most are CC BY or CC BY-SA), the Wikipedia text "From
 * Wikipedia" with a link (CC BY-SA). What the credit needs is stored with the
 * author (`authors.photo_credit`, `authors.summaries`).
 */

export const COMMONS_API = 'https://commons.wikimedia.org/w/api.php'

/** The width the author page shows the portrait at, twice for sharp screens. */
export const PHOTO_WIDTH = 480

export function imageInfoUrl(file: string, width = PHOTO_WIDTH): string {
  const params = new URLSearchParams({
    action: 'query',
    titles: `File:${file}`,
    prop: 'imageinfo',
    iiprop: 'url|extmetadata',
    iiurlwidth: String(width),
    iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist|AttributionRequired',
    iilimit: '1',
    format: 'json',
    formatversion: '2',
  })
  return `${COMMONS_API}?${params}`
}

export type PhotoCredit = {
  source: 'commons' | 'openlibrary'
  artist?: string | null
  licence?: string | null
  licenceUrl?: string | null
  /** The file's page (Commons) or the author's page (Open Library). */
  fileUrl?: string | null
}

export type Photo = { url: string; credit: PhotoCredit }

/** The portrait: a thumbnail URL (without tracking parameters) and its credit. */
export function parseImageInfo(body: unknown): Photo | null {
  const page = (body as { query?: { pages?: { imageinfo?: Record<string, unknown>[] }[] } })?.query?.pages?.[0]
  const info = page?.imageinfo?.[0]
  if (!info) return null
  const thumb = typeof info.thumburl === 'string' ? info.thumburl : typeof info.url === 'string' ? info.url : null
  if (!thumb) return null
  const url = stripQuery(thumb)
  if (!url.startsWith('https://')) return null
  const meta = (info.extmetadata ?? {}) as Record<string, { value?: unknown }>
  return {
    url,
    credit: {
      source: 'commons',
      artist: plainText(meta.Artist?.value),
      licence: plainText(meta.LicenseShortName?.value),
      licenceUrl: typeof meta.LicenseUrl?.value === 'string' ? meta.LicenseUrl.value : null,
      fileUrl: typeof info.descriptionurl === 'string' ? info.descriptionurl : null,
    },
  }
}

// --------------------------------------------------------------- Wikipedia

export function summaryUrl(language: string, title: string): string {
  return `https://${language}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}?redirect=true`
}

export type Summary = { text: string; title: string; url: string }

/** The article's lead as plain text, with its title and address. Disambiguation pages are not a summary. */
export function parseSummary(body: unknown): Summary | null {
  const page = body as {
    type?: string
    title?: string
    extract?: string
    content_urls?: { desktop?: { page?: string } }
  } | null
  if (!page || page.type === 'disambiguation') return null
  const text = page.extract?.replace(/\s+/g, ' ').trim()
  const url = page.content_urls?.desktop?.page
  if (!text || !url || !page.title) return null
  return { text: text.length > 1200 ? `${text.slice(0, 1197).replace(/\s+\S*$/, '')}…` : text, title: page.title, url }
}

/** HTML from Commons' metadata as one line of text ("<a …>Luigi Novi</a>" → "Luigi Novi"). */
export function plainText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text ? text.slice(0, 300) : null
}

function stripQuery(url: string): string {
  const index = url.indexOf('?')
  return index >= 0 ? url.slice(0, index) : url
}
