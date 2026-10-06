-- The Goodreads book-page cache is gone (issue #111):
--   supabase test db
--
-- `goodreads_editions` held what the goodreads-rating function read from a
-- book page. The function answers only ratings now, and the table that cached
-- the pages was dropped; the ratings cache is untouched.

begin;
select plan(3);

select hasnt_table('public', 'goodreads_editions', 'the book-page cache is dropped');
select has_table('public', 'goodreads_ratings', 'the ratings cache stays');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname like 'goodreads_editions%'),
  0,
  'no index or constraint of it is left behind');

select * from finish();
rollback;
