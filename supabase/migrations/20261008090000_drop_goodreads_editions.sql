-- Take back the Goodreads book-page cache (issue #111).
--
-- `goodreads_editions` (20261007110000) cached what the `goodreads-rating` edge
-- function read from a Goodreads book page, so an import could learn the
-- language, format and ISBNs of a row that came without an ISBN. The function
-- no longer reads Goodreads book pages: it answers only the rating, the rating
-- counts and the link, through the legacy keyless endpoints (issue #69). The
-- table has nothing left to hold.
--
-- The table carried no functions or triggers of its own. Its index, its
-- policies' absence (the service role alone had grants) and its constraints go
-- with it. `if exists` keeps a database that never applied the earlier
-- migration working.

drop table if exists public.goodreads_editions;
