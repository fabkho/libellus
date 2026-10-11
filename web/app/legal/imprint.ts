import { EMAIL_LINK, PLACEHOLDER as X } from './placeholders'
import type { LegalDocument } from './types'

/** The imprint (Impressum): the details § 5 DDG asks of a digital service, for a private, non-commercial beta. */
export const IMPRINT: LegalDocument = {
  en: {
    title: 'Imprint',
    lead: 'Information under § 5 DDG (the German Digital Services Act) about the operator of BetterReads.',
    version: 'Version: 11 October 2026',
    sections: [
      {
        id: 'operator',
        heading: 'Operator',
        blocks: [{ lines: ['Fabian Kirchhoff', X.address] }],
      },
      {
        id: 'contact',
        heading: 'Contact',
        blocks: [{ lines: [`Email: ${EMAIL_LINK}`, `Also: ${X.contact}`] }],
      },
      {
        id: 'about',
        heading: 'About this site',
        blocks: [
          { p: 'BetterReads (libellus.fabkho.dev) is a private, non-commercial beta for its operator and invited friends. It is free, shows no advertising and earns no money.' },
          { p: 'The source code is public at [github.com/fabkho/libellus](https://github.com/fabkho/libellus), under the MIT licence. How the app handles your data is in the [privacy notice](/privacy).' },
        ],
      },
    ],
  },
  de: {
    title: 'Impressum',
    lead: 'Angaben gemäß § 5 DDG zum Betreiber von BetterReads.',
    version: 'Stand: 11. Oktober 2026',
    sections: [
      {
        id: 'operator',
        heading: 'Betreiber',
        blocks: [{ lines: ['Fabian Kirchhoff', X.address] }],
      },
      {
        id: 'contact',
        heading: 'Kontakt',
        blocks: [{ lines: [`E-Mail: ${EMAIL_LINK}`, `Außerdem: ${X.contact}`] }],
      },
      {
        id: 'about',
        heading: 'Über diese Seite',
        blocks: [
          { p: 'BetterReads (libellus.fabkho.dev) ist eine private Beta ohne Gewinnabsicht für den Betreiber und eingeladene Freunde. Sie ist kostenlos, zeigt keine Werbung und verdient kein Geld.' },
          { p: 'Der Quellcode ist öffentlich unter [github.com/fabkho/libellus](https://github.com/fabkho/libellus), unter der MIT-Lizenz. Wie die App mit deinen Daten umgeht, steht in der [Datenschutzerklärung](/privacy).' },
        ],
      },
    ],
  },
}
