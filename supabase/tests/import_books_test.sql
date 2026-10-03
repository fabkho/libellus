-- The in-app Goodreads import (#40) at the database boundary:
--   supabase test db
--
-- import_books writes a few rows of a member's file per call, each row on its
-- own: a new entry with its session (the Status derived from it), nothing
-- when the row was imported before (same key) or the Book is already hers,
-- and a refusal for one bad row that leaves the others written. Books come
-- from the Catalogue, from a source's snapshot, from the file itself
-- (`import`, keyed by its ISBN-13) or, without an ISBN, as her own Manual
-- book. Assertions act as real signed-in members and ask about the rows this
-- test made.

begin;
select plan(29);

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-GOODREADS', 'goodreads import test', 5);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-GOODREADS"}'::jsonb, now(), now(), now());
  return v_id;
end;
$$;

create or replace function tests.act_as(p_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

-- The outcome of each row, in order.
create or replace function tests.outcomes(p_results jsonb)
returns text[] language sql as $$
  select array_agg(coalesce(r->>'error', r->>'outcome') order by n)
    from jsonb_array_elements(p_results) with ordinality as t(r, n)
$$;

grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

select tests.member('ida@goodreads.test') as ida_id \gset
select tests.member('max@goodreads.test') as max_id \gset

-- A Catalogue Book that search would find.
insert into public.books (title, authors, isbn13, source, apple_id)
values ('Piranesi', '{Susanna Clarke}', '9790000001019', 'apple', '900000001') returning id as piranesi \gset

-- ------------------------------------------------------------------ refusals

select throws_ok(
  $$ select public.import_books('[]') $$,
  '42501', 'not_signed_in', 'nobody signed in imports nothing');

select tests.act_as(:'ida_id');

select throws_ok(
  $$ select public.import_books('{}') $$,
  '22023', 'rows_invalid', 'the rows come as a list');
select throws_ok(
  format($$ select public.import_books(%L) $$,
    (select jsonb_agg(jsonb_build_object('key', 'goodreads:' || n)) from generate_series(1, 101) n)),
  '22023', 'too_many_rows', 'a few rows per call, not a whole file');

-- ------------------------------------------------------------ a first import

select public.import_books(format($$ [
  {"key": "goodreads:1", "book_id": %s, "status": "finished", "ended_on": "2024-03-09", "rating": 16,
   "review": "  Strange and lovely.  ", "added_on": "2024-01-02"},
  {"key": "goodreads:2", "book": {"title": "Kindred", "authors": ["Octavia E. Butler"], "isbn13": "9790000001026",
   "source": "import", "page_count": 264}, "status": "finished"},
  {"key": "goodreads:3", "book": {"title": "Notes Nobody Printed", "authors": ["Ida Example"], "source": "manual"},
   "status": "reading", "started_on": "2025-06-12"},
  {"key": "goodreads:4", "book": {"title": "Klara and the Sun", "authors": ["Kazuo Ishiguro"], "source": "openlibrary",
   "openlibrary_edition_key": "OL900000001M"}, "status": "want_to_read", "added_on": "2023-05-04"},
  {"key": "goodreads:5", "book": {"title": "Unknown Edition", "authors": ["Nobody"], "source": "import"}, "status": "want_to_read"},
  {"key": "goodreads:6", "book_id": %s, "status": "finished", "rating": 24},
  {"key": "goodreads:7", "book": {"title": "Tomorrow", "authors": ["Ida Example"], "source": "manual"},
   "status": "finished", "ended_on": "2999-01-01"},
  {"key": "Bad Key", "book_id": %s, "status": "want_to_read"}
] $$, to_json(:'piranesi'::text), to_json(:'piranesi'::text), to_json(:'piranesi'::text))::jsonb) as first \gset

select is(
  tests.outcomes(:'first'),
  array['added', 'added', 'added', 'added', 'book_invalid', 'in_library', 'date_in_future', 'key_invalid'],
  'each row on its own: added, or refused alone, or already hers');

select is(
  (select status from public.library_entries where member_id = :'ida_id' and import_key = 'goodreads:1'),
  'finished'::public.entry_status, 'a read book is Finished');
select results_eq(
  format($$ select s.started_on, s.ended_on, s.outcome::text, s.rating::int, s.review, s.import_key
              from public.reading_sessions s join public.library_entries e on e.id = s.entry_id
             where e.member_id = %L and e.book_id = %L $$, :'ida_id', :'piranesi'),
  $$ values (null::date, '2024-03-09'::date, 'finished', 16, 'Strange and lovely.', 'goodreads:1') $$,
  'with one finished read: the day it was read, no start, the Rating in quarters, the review trimmed, the key');
select is(
  (select added_at from public.library_entries where member_id = :'ida_id' and import_key = 'goodreads:1'),
  '2024-01-02 12:00:00+00'::timestamptz, 'added on the day it entered her Goodreads Library');

select results_eq(
  format($$ select b.source::text, b.owner_id, b.page_count, s.ended_on, s.outcome::text
              from public.library_entries e join public.books b on b.id = e.book_id
              join public.reading_sessions s on s.entry_id = e.id
             where e.member_id = %L and e.import_key = 'goodreads:2' $$, :'ida_id'),
  $$ values ('import', null::uuid, 264, null::date, 'finished') $$,
  'an edition no source knows enters the Catalogue as an import Book, finished without a day');

select results_eq(
  format($$ select b.source::text, b.owner_id, e.status::text, s.started_on, s.outcome::text
              from public.library_entries e join public.books b on b.id = e.book_id
              join public.reading_sessions s on s.entry_id = e.id
             where e.member_id = %L and e.import_key = 'goodreads:3' $$, :'ida_id'),
  format($$ values ('manual', %L::uuid, 'reading', '2025-06-12'::date, null::text) $$, :'ida_id'),
  'a book without an ISBN becomes her own Manual book; Currently reading, open since the day it was added');

select results_eq(
  format($$ select b.source::text, e.status::text, (select count(*)::int from public.reading_sessions where entry_id = e.id)
              from public.library_entries e join public.books b on b.id = e.book_id
             where e.member_id = %L and e.import_key = 'goodreads:4' $$, :'ida_id'),
  $$ values ('openlibrary', 'want_to_read', 0) $$,
  'a Book a source found enters the Catalogue; Want to read has no session');

select is_empty(
  format($$ select 1 from public.library_entries where member_id = %L and import_key in ('goodreads:5', 'goodreads:6', 'goodreads:7') $$, :'ida_id'),
  'a refused row leaves nothing behind, and a second row for a Book she has adds no entry');
select is_empty(
  $$ select 1 from public.books where title in ('Unknown Edition', 'Tomorrow') $$,
  'not even its Book');
select is(
  (select count(*)::int from public.reading_sessions s join public.library_entries e on e.id = s.entry_id
    where e.member_id = :'ida_id' and e.book_id = :'piranesi'),
  1, 'and no second session on the entry she has');

-- ------------------------------------------------------ the same file again

select public.import_books(format($$ [
  {"key": "goodreads:1", "book_id": %s, "status": "finished", "ended_on": "2024-03-09", "rating": 16},
  {"key": "goodreads:2", "book": {"title": "Kindred", "authors": ["Octavia E. Butler"], "isbn13": "9790000001026",
   "source": "import"}, "status": "finished"},
  {"key": "goodreads:3", "book": {"title": "Notes Nobody Printed", "authors": ["Ida Example"], "source": "manual"},
   "status": "reading", "started_on": "2025-06-12"},
  {"key": "goodreads:4", "book": {"title": "Klara and the Sun", "authors": ["Kazuo Ishiguro"], "source": "openlibrary",
   "openlibrary_edition_key": "OL900000001M"}, "status": "want_to_read"}
] $$, to_json(:'piranesi'::text))::jsonb) as second \gset

select is(
  tests.outcomes(:'second'),
  array['imported', 'imported', 'imported', 'imported'],
  'importing the same file twice adds nothing');
select is(
  (select count(*)::int from public.library_entries where member_id = :'ida_id'), 4,
  'still four entries');
select is(
  (select count(*)::int from public.reading_sessions s join public.library_entries e on e.id = s.entry_id
    where e.member_id = :'ida_id'), 3,
  'and three sessions');
select is(
  (select count(*)::int from public.books where owner_id = :'ida_id'), 1,
  'and one Manual book');

-- A row whose key is new but whose Manual book she made before (an export
-- without Book Ids, say) finds that book.
select is(
  tests.outcomes(public.import_books($$ [
    {"key": "goodreads:t-notes-nobody-printed|example", "book": {"title": "notes nobody printed", "authors": ["Ida Example"],
     "source": "manual"}, "status": "want_to_read"}
  ] $$)),
  array['in_library'], 'her Manual book of the same title and author is the same book');

-- ------------------------------------------------- the rules of the sessions

select is(
  tests.outcomes(public.import_books(format($$ [
    {"key": "goodreads:10", "book": {"title": "A", "authors": ["X"], "source": "manual"}, "status": "reading"},
    {"key": "goodreads:11", "book": {"title": "B", "authors": ["X"], "source": "manual"}, "status": "want_to_read", "rating": 8},
    {"key": "goodreads:12", "book": {"title": "C", "authors": ["X"], "source": "manual"}, "status": "finished", "rating": 21},
    {"key": "goodreads:13", "book": {"title": "D", "authors": ["X"], "source": "manual"}, "status": "finished",
     "started_on": "2024-02-02", "ended_on": "2024-02-01"},
    {"key": "goodreads:14", "book": {"title": "E", "authors": ["X"], "source": "manual"}, "status": "finished",
     "review": "%s"},
    {"key": "goodreads:15", "book": {"title": "F", "authors": [], "source": "manual"}, "status": "want_to_read"},
    {"key": "goodreads:16", "book": {"title": "G", "authors": ["X"], "source": "apple"}, "status": "want_to_read"},
    {"key": "goodreads:17", "book": {"title": "H", "authors": ["X"], "source": "manual"}, "status": "paused"}
  ] $$, repeat('x', 10001))::jsonb)),
  array['date_invalid', 'session_invalid', 'rating_invalid', 'ended_before_started', 'review_too_long',
        'book_invalid', 'book_invalid', 'row_invalid'],
  'the same rules as every other way in');

-- ------------------------------------------------------------ other members

select (public.add_manual_book('Max''s Notes', array['Max Example'])).book_id as max_book \gset
select tests.act_as(:'max_id');
select (public.add_manual_book('Max''s Notes', array['Max Example'])).book_id as max_book \gset
select tests.act_as(:'ida_id');

select is(
  tests.outcomes(public.import_books(format($$ [
    {"key": "goodreads:20", "book_id": %s, "status": "want_to_read"},
    {"key": "goodreads:21", "book": {"title": "Max's Notes", "authors": ["Max Example"], "source": "manual"}, "status": "want_to_read"}
  ] $$, to_json(:'max_book'::text))::jsonb)),
  array['book_invalid', 'in_library'],
  'another member''s Manual book is never hers: not by id, not by its title (her own of that name is found)');

select tests.act_as(:'max_id');

select is(
  tests.outcomes(public.import_books(format($$ [
    {"key": "goodreads:1", "book_id": %s, "status": "finished", "rating": 20},
    {"key": "goodreads:2", "book": {"title": "Kindred (another snapshot)", "authors": ["Octavia E. Butler"],
     "isbn13": "9790000001026", "source": "import"}, "status": "want_to_read"}
  ] $$, to_json(:'piranesi'::text))::jsonb)),
  array['added', 'added'],
  'another member imports the same rows: her keys are her own');
select is(
  (select count(*)::int from public.books where isbn13 = '9790000001026'), 1,
  'and an import Book in the Catalogue is found again by its ISBN, not made twice');
select is(
  (select title from public.books where isbn13 = '9790000001026'), 'Kindred',
  'keeping its first snapshot');
select is(
  (select count(*)::int from public.library_entries where import_key is not null), 2,
  'a member sees only her own entries');

select throws_ok(
  format($$ insert into public.library_entries (member_id, book_id, import_key) values (%L, %L, 'goodreads:99') $$,
    :'max_id', :'piranesi'),
  '42501', null, 'members still cannot write entries themselves');
select throws_ok(
  format($$ select public.import_book_for(%L, null, '{"title":"X","authors":["Y"],"source":"manual"}') $$, :'ida_id'),
  '42501', null, 'nor call the Book step on its own (for someone else)');

-- ------------------------------------------------------------ dates and time

select tests.act_as(:'ida_id');
select is(
  tests.outcomes(public.import_books($$ [
    {"key": "goodreads:30", "book": {"title": "Later", "authors": ["X"], "source": "manual"}, "status": "want_to_read",
     "added_on": "2999-01-01"}
  ] $$)),
  array['added'], 'a Date Added in the future is no reason to refuse the book');
select ok(
  (select added_at <= now() from public.library_entries where member_id = :'ida_id' and import_key = 'goodreads:30'),
  'it is added now instead');
select is(
  (select status from public.library_entries where member_id = :'ida_id' and import_key = 'goodreads:3'),
  'reading'::public.entry_status, 'the Status is the database''s, derived from the session');

reset role;
select * from finish();
rollback;
