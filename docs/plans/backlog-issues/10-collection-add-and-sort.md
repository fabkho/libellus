Title: Collection page: a + that adds from search, and sorting
Labels: feature, priority:high
Package: WP-10 · items #10, #9 · tier P2 · size M · model Sonnet · depends on: none · wave 1
Create (only when the owner says so): gh issue create --title "$(sed -n 's/^Title: //p' docs/plans/backlog-issues/10-collection-add-and-sort.md)" --label feature --label priority:high --body-file <(sed '1,/^---$/d' docs/plans/backlog-issues/10-collection-add-and-sort.md)
Plan: docs/plans/backlog-execution.md

---
## Problem
- **#10** Only an empty Collection offers search (`UiSearchPrompt`, `collection.search`), and it opens plain search; putting a Book on a Collection is only possible from the book page's picker.
- **#9** A Collection only shows its saved order (`data/collections.ts:219`). There is no publication date in the data (only `books.published_year`), and "date added" can mean the Library (`addedAt`) or the Collection (`collection_entries.added_at`, not read today).

## Scope
- A round + in the Collection's top bar → search with a target (`stores/search.ts`, a `target: { collection }` mode like `linking`); results show "Add to {name}" and a check when already on it; uses `add_to_collection` (adds to Want to read first when the Book is new, said in the UI).
- A sort control: Your order (default, drag on) · Title · Author · Year · Date added (to the Collection). View-only; grips disabled while sorted (`EntryList.vue`).
- Read `collection_entries.added_at` in `data/collections.ts`; give `components/library/SortSheet.vue` a `sorts` prop.
- Keys: `collection.add` ("Add books" / "Bücher hinzufügen"), `collection.addTo`, `collection.sort.*`, `collection.sortedHint`; update `collection.empty`.
- `docs/parity.md`: Collection, Search.

## Acceptance criteria
- [ ] + opens search aimed at this Collection; adding puts the Book on it; already-on Books show a check.
- [ ] Sorting changes the view only; the saved order is untouched; Your order brings drag back.
- [ ] While sorted, grips are not focusable or draggable.
- [ ] Vitest for the sort and for `added_at` in the repository (`tests/collections.test.ts`).

## Notes
- No migration. Owner questions: remember the sort per Collection; which "date added"?
