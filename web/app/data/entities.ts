/**
 * HTML entities decoded to text (issue #47, item 4). Apple's titles, artists
 * and blurbs sometimes arrive HTML-escaped ("Klara y el Sol &ldquo;Klara and
 * the Sun&rdquo;"); everything stored or shown is decoded first. A small
 * named set (the punctuation and Latin letters book titles use) plus every
 * numeric entity; anything else stays as it was. One pass, so "&amp;ldquo;"
 * becomes "&ldquo;", not a quote.
 *
 * Framework-free. The migration that cleans stored Catalogue rows
 * (20261003144500_decode_catalogue_entities.sql) decodes the same names in SQL;
 * the tests keep the two lists equal.
 */

/** Named entities, case-sensitive (`Auml` and `auml` are different letters). */
export const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  quot: '"', amp: '&', apos: "'", lt: '<', gt: '>', nbsp: ' ',
  lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„',
  ndash: '–', mdash: '—', hellip: '…', bull: '•', middot: '·', prime: '′', Prime: '″',
  laquo: '«', raquo: '»', lsaquo: '‹', rsaquo: '›',
  copy: '©', reg: '®', trade: '™', deg: '°', sect: '§', para: '¶', euro: '€', pound: '£',
  iexcl: '¡', iquest: '¿', times: '×', divide: '÷', shy: '',
  Agrave: 'À', Aacute: 'Á', Acirc: 'Â', Atilde: 'Ã', Auml: 'Ä', Aring: 'Å', AElig: 'Æ', Ccedil: 'Ç',
  Egrave: 'È', Eacute: 'É', Ecirc: 'Ê', Euml: 'Ë', Igrave: 'Ì', Iacute: 'Í', Icirc: 'Î', Iuml: 'Ï',
  ETH: 'Ð', Ntilde: 'Ñ', Ograve: 'Ò', Oacute: 'Ó', Ocirc: 'Ô', Otilde: 'Õ', Ouml: 'Ö', Oslash: 'Ø',
  Ugrave: 'Ù', Uacute: 'Ú', Ucirc: 'Û', Uuml: 'Ü', Yacute: 'Ý', THORN: 'Þ', szlig: 'ß',
  agrave: 'à', aacute: 'á', acirc: 'â', atilde: 'ã', auml: 'ä', aring: 'å', aelig: 'æ', ccedil: 'ç',
  egrave: 'è', eacute: 'é', ecirc: 'ê', euml: 'ë', igrave: 'ì', iacute: 'í', icirc: 'î', iuml: 'ï',
  eth: 'ð', ntilde: 'ñ', ograve: 'ò', oacute: 'ó', ocirc: 'ô', otilde: 'õ', ouml: 'ö', oslash: 'ø',
  ugrave: 'ù', uacute: 'ú', ucirc: 'û', uuml: 'ü', yacute: 'ý', thorn: 'þ', yuml: 'ÿ',
  OElig: 'Œ', oelig: 'œ', Scaron: 'Š', scaron: 'š', Zcaron: 'Ž', zcaron: 'ž',
}

/** The five every HTML writer knows, matched in any case as plainText always did. */
const BASIC = ['amp', 'lt', 'gt', 'quot', 'apos', 'nbsp'] as const

/** `&amp;`, `&ldquo;`, `&#8220;`, `&#x201C;` → the character; anything unknown or invalid as it was. */
export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1))
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : whole
    }
    const direct = NAMED_ENTITIES[name]
    if (direct !== undefined) return direct
    const lower = name.toLowerCase()
    return (BASIC as readonly string[]).includes(lower) ? NAMED_ENTITIES[lower]! : whole
  })
}
