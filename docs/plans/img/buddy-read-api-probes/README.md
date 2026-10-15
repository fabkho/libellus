# Buddy read: can a public API give us a book's chapter list?

The probes ran on 2026-10-12 with plain `curl`. No keys were used. The files here are trimmed with jq.

**Short answer:** no metadata API gives chapters reliably. Open Library has a `table_of_contents` field, but
it is filled in for about 1 % of editions or fewer. Real, complete chapter lists come only from the EPUBs of
public-domain books (Gutenberg, Standard Ebooks). For German in-copyright fiction, nothing gives chapters.

| Source | Verdict | Evidence |
|---|---|---|
| Open Library `/isbn`, `/books`, `/works/…/editions`, `/api/books`, read API | **sparse** | `ol-isbn-*.json`, `ol-works-editions-toc-stats.jsonl`, `ol-editions-with-toc-*.json`, `ol-random-sample-toc.json`, `ol-search-fields-test.json`, `ol-books-api-jscmd-data.json`, `ol-read-api-9780141439518.json` |
| Google Books v1 | **none** (the schema has no TOC field). Unauthenticated calls return 429 because the shared project quota is 0 | `gb-discovery-volume-schema.json`, `gb-429-unauthenticated.json` |
| Apple iTunes Search/Lookup (ebook, audiobook) | **none** | `apple-*.json(l)` |
| Wikidata | **none** for our books; about 2.1k works in all of Wikidata have chapter items | `wikidata-*.json` |
| Hardcover GraphQL | **none** (no TOC field in `editions`/`books`; needs a token, and the repo has none) | `hardcover-schema-fields.txt` |
| Gutenberg / Gutendex EPUB | **good** for public domain (EN and DE) | `gutendex-*.json`, `gutenberg-*-toc.json` |
| Standard Ebooks EPUB | **good**, the cleanest (EN public domain only) | `standardebooks-pride-prejudice-nav.json` |
| Internet Archive metadata | **none** structured (OCR EPUB, page_numbers.json, scandata) | `ia-metadata-*.json` |
| DNB SRU (MARC 856 "Inhaltsverzeichnis") | **sparse**: scanned TOC PDFs, mostly non-fiction or critical editions | `dnb-sru-856-links.txt`, `dnb-toc-pdf-1362379786-buddenbrooks.txt` |

## Open Library numbers

`table_of_contents` per work, over every edition from `/works/{id}/editions.json?limit=1000`:

| Work | Editions | With TOC | German editions | German with TOC |
|---|---|---|---|---|
| The Hobbit (OL27482W) | 482 | 12 | 18 | 1 |
| Project Hail Mary (OL21745884W) | 32 | 2 (one is an Audible chapter/timestamp list) | 2 | 1 |
| Pride and Prejudice (OL66554W) | first 1000 of 4042 | 1 | 5 | 0 |
| Die Vermessung der Welt (OL991411W) | 27 | 0 | 5 | 0 |
| Tschick (OL16621819W) | 14 | 0 | 4 | 0 |

- None of the five probed ISBNs had a TOC.
- A random sample from `search.json?q=subject:fiction&sort=random` (38 cover editions) had 0 with a TOC.
- The search API cannot filter or return `table_of_contents`.
- Some entries are junk: a Portuguese Hobbit has blurb paragraphs stored as TOC rows.

## EPUB results

- **Gutenberg #1342 (Pride and Prejudice):** `toc.ncx` has 63 navPoints and all 61 chapters. In this
  illustrated edition many labels carry a caption first, for example `"He rode a black horse. CHAPTER III."`.
  `gutenberg.org` gave a 504 during the probe; the mirror `gutenberg.pglaf.org/cache/epub/{id}/pg{id}.epub`
  worked.
- **Gutenberg #69327 (Kafka, "Der Prozess"):** 18 navPoints: 10 chapters (`ERSTES KAPITEL VERHAFTUNG …`) plus Nachwort, Inhaltsverzeichnis, Kolophon (with 4 sub-entries) and the PG licence. Front and back matter has to be filtered out.
- **Standard Ebooks (Pride and Prejudice):** `toc.xhtml` has 65 entries, 61 of them chapters (`chapter-N.xhtml`).

## Recommended order for getting chapters

1. **Public domain:** match to a Standard Ebooks or Gutenberg EPUB and parse `nav`/`ncx`.
2. **Open Library:** use `table_of_contents` on the exact edition, then on another edition of the same work
   in the same language. Check it: at least 3 entries, short labels.
3. **Member's own EPUB (if Libellus ever reads files):** parse its nav.
4. **Fallback for everything else, i.e. most books:** the member enters the chapter count (or a count is
   seeded from the edition), giving "Chapter 1…N". Anyone in the buddy read can rename or edit the list. The
   chapter list belongs to the buddy read, not to the catalogue.
5. **Optional, German:** DNB `Inhaltsverzeichnis` PDF plus pdftotext. Rarely there for fiction, and the
   result needs parsing.
