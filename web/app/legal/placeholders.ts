/**
 * What only the owner can supply. Each stays visibly marked on the page until it is filled in, and every
 * one is listed in docs/legal-checklist.md (tests/legal.test.ts keeps the two equal). Never invent a value
 * here: an address or a phone number nobody gave is worse than a marked gap.
 */
export const PLACEHOLDER = {
  address: '[[STREET, POSTCODE, CITY]]',
  email: '[[EMAIL ADDRESS]]',
  contact: '[[PHONE OR CONTACT FORM]]',
  authority: '[[SUPERVISORY AUTHORITY]]',
  resend: '[[VERIFY RESEND REGION AND TRANSFER BASIS]]',
} as const
