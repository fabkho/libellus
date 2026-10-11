/**
 * What only the owner can supply, and has not yet: the imprint's postal address and second contact
 * (postponed, `IMPRINT_ENABLED` in config.ts, docs/legal-checklist.md). Each is drawn marked on the page
 * until it is filled in, and every one a page that is on shows is listed in docs/legal-checklist.md
 * (tests/legal.test.ts keeps the two equal). Never invent a value here: an address or a phone number nobody
 * gave is worse than a marked gap.
 */
export const PLACEHOLDER = {
  address: '[[STREET, POSTCODE, CITY]]',
  contact: '[[PHONE OR CONTACT FORM]]',
} as const

/** The address for privacy requests, a Cloudflare Email Routing alias of the owner's (docs/legal-checklist.md: it must receive mail). */
export const EMAIL = 'privacy@fabkho.dev'
/** As the texts write it: a link a mail program opens. */
export const EMAIL_LINK = `[${EMAIL}](mailto:${EMAIL})`
