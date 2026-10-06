# foliate-js, vendored

- Source: https://github.com/johnfactotum/foliate-js, commit `78914aef4466eb960965702401634c2cb348e9b1`
  (2026-05-01). The npm package `foliate-js@1.0.1` (2025-04) is a year older; the README asks
  users to pin the repository instead ("no release yet … include the library as a git submodule").
- Licence: MIT (`LICENSE`, © 2022 John Factotum), for every file here.
- `vendor/zip.js`: a minified build of `@zip.js/zip.js` 2.8.22 (`configure`, `ZipReader`,
  `BlobReader`, `TextWriter`, `BlobWriter`), **BSD-3-Clause** © Gildas Lormeau. Production must
  ship its licence notice (e.g. in a third-party notices file).
- `vendor/fflate.js`: a minified build of `fflate` 0.8.2 (MIT © Arjun Barrett), only used for
  MOBI/KF8 fonts; an EPUB never loads it.
- Not vendored: `pdf.js` and `vendor/pdfjs/` (PDF.js, Apache-2.0; PDF is out of scope for #131),
  the demo reader (`reader.html`, `reader.js`, `ui/`), `opds.js`, `dict.js`, `footnotes.js`,
  `quote-image.js`, `uri-template.js`, tests.

## Changes (marked "Libellus:" in the code)

1. `view.js`: the PDF branch throws `UnsupportedTypeError` instead of importing `./pdf.js`.
2. `paginator.js`: `View.render` and `Paginator.render` return while the section's document has
   no body yet (a `ResizeObserver` render during a section load threw in Chromium).
