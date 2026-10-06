-- import_books with what real Goodreads exports carry (#111):
--   supabase test db
--
-- Earlier reads (Read Count) as undated finished sessions before the row's
-- own; a did-not-finish shelf as an abandoned read; the file's page count as
-- her own when the edition says another; her other shelves as Collections;
-- and two rows of one file with different Goodreads Book Ids for the same
-- work (an English and a German read) as two entries. Assertions act as a real
-- signed-in member.

begin;
select plan(18);

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-GR-SHELVES', 'goodreads shelves test', 5);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-GR-SHELVES"}'::jsonb, now(), now(), now());
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

create or replace function tests.outcomes(p_results jsonb)
returns text[] language sql as $$
  select array_agg(coalesce(r->>'error', r->>'outcome') order by n)
    from jsonb_array_elements(p_results) with ordinality as t(r, n)
$$;

grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

select tests.member('lena@shelves.test') as lena_id \gset

-- An edition search would find, with its own page count.
insert into public.books (title, authors, isbn13, source, apple_id, page_count)
values ('Red Rising', '{Pierce Brown}', '9790000002016', 'apple', '900000101', 382) returning id as red_en \gset

select tests.act_as(:'lena_id');

select is(
  tests.outcomes(public.import_books(format($$ [
    {"key": "goodreads:101", "file_title": "Red Rising", "file_author": "Pierce Brown", "book_id": %s,
     "status": "finished", "ended_on": "2024-02-01", "rating": 20, "extra_reads": 2, "page_count": 382,
     "collections": ["favourites", "Sci-Fi"], "other_keys": ["goodreads:102"]},
    {"key": "goodreads:102", "file_title": "Red Rising", "file_author": "Pierce Brown", "status": "finished",
     "other_keys": ["goodreads:101"],
     "book": {"title": "Red Rising", "authors": ["Pierce Brown", "Bernhard Kempen"], "isbn13": "9790000002023",
              "source": "import", "page_count": 576, "language": "de"},
     "page_count": 590, "collections": ["Favourites"]},
    {"key": "goodreads:103", "book": {"title": "A Slog", "authors": ["Ida Example"], "source": "manual"},
     "status": "finished", "outcome": "abandoned", "ended_on": "2024-05-01", "review": "Not for me."},
    {"key": "goodreads:104", "book": {"title": "Again", "authors": ["Ida Example"], "source": "manual"},
     "status": "reading", "started_on": "2025-01-01", "extra_reads": 1},
    {"key": "goodreads:105", "book": {"title": "Rated Slog", "authors": ["Ida Example"], "source": "manual"},
     "status": "finished", "outcome": "abandoned", "rating": 8},
    {"key": "goodreads:106", "book": {"title": "Wish", "authors": ["Ida Example"], "source": "manual"},
     "status": "want_to_read", "extra_reads": 1},
    {"key": "goodreads:107", "book": {"title": "Odd Shelves", "authors": ["Ida Example"], "source": "manual"},
     "status": "want_to_read", "collections": "favourites"},
    {"key": "goodreads:108", "book": {"title": "Too Many", "authors": ["Ida Example"], "source": "manual"},
     "status": "finished", "extra_reads": 21}
  ] $$, to_json(:'red_en'::text))::jsonb)),
  array['added', 'added', 'added', 'added', 'session_invalid', 'session_invalid', 'collections_invalid', 'session_invalid'],
  'reads, abandoned reads and shelves are taken; what cannot be is refused per row');

-- Read Count
select is(
  (select count(*)::int from public.reading_sessions s join public.library_entries e on e.id = s.entry_id
    where e.member_id = :'lena_id' and e.import_key = 'goodreads:101'),
  3, 'a Read Count of 3: three finished reads');
select results_eq(
  format($$ select s.import_key, s.ended_on, s.rating::int
              from public.reading_sessions s join public.library_entries e on e.id = s.entry_id
             where e.member_id = %L and e.import_key = 'goodreads:101' order by s.created_at $$, :'lena_id'),
  $$ values ('goodreads:101#2', null::date, null::int), ('goodreads:101#3', null::date, null::int),
            ('goodreads:101', '2024-02-01'::date, 20) $$,
  'the earlier two undated and unrated, each with its own key, the row''s own read last');
select is(
  (select s.import_key from public.library_entries e, public.latest_session(e) s
    where e.member_id = :'lena_id' and e.import_key = 'goodreads:101'),
  'goodreads:101', 'the row''s own read is the latest');
select results_eq(
  format($$ select e.status::text, (select count(*)::int from public.reading_sessions s where s.entry_id = e.id and s.outcome = 'finished'),
                   s.import_key
              from public.library_entries e, public.latest_session(e) s
             where e.member_id = %L and e.import_key = 'goodreads:104' $$, :'lena_id'),
  $$ values ('reading', 1, 'goodreads:104') $$,
  'Currently reading with an earlier read: one finished read, the open one the latest');

-- Two editions of one work
select is(
  (select count(*)::int from public.library_entries where member_id = :'lena_id' and import_key in ('goodreads:101', 'goodreads:102')),
  2, 'two rows of the file for the same work are two entries, not one taken for the other');

-- Page count
select is(
  (select page_count_override from public.library_entries where member_id = :'lena_id' and import_key = 'goodreads:101'),
  null, 'the same page count as the edition is no page count of her own');
select is(
  (select page_count_override from public.library_entries where member_id = :'lena_id' and import_key = 'goodreads:102'),
  590, 'another page count than the edition''s is hers');

-- Did not finish
select results_eq(
  format($$ select e.status::text, s.outcome::text, s.ended_on, s.rating, s.review
              from public.library_entries e join public.reading_sessions s on s.entry_id = e.id
             where e.member_id = %L and e.import_key = 'goodreads:103' $$, :'lena_id'),
  $$ values ('finished', 'abandoned', '2024-05-01'::date, null::smallint, 'Not for me.') $$,
  'a did-not-finish shelf: one abandoned read, with its day and review');

-- Collections
select results_eq(
  format($$ select c.name, c.position from public.collections c where c.member_id = %L order by c.position $$, :'lena_id'),
  $$ values ('favourites', 1), ('Sci-Fi', 2) $$,
  'her shelves are Collections, made once each whatever their case, at the end of her list');
select results_eq(
  format($$ select c.name, e.import_key, ce.position
              from public.collection_entries ce join public.collections c on c.id = ce.collection_id
              join public.library_entries e on e.id = ce.entry_id
             where c.member_id = %L order by c.position, ce.position $$, :'lena_id'),
  $$ values ('favourites', 'goodreads:101', 1), ('favourites', 'goodreads:102', 2), ('Sci-Fi', 'goodreads:101', 1) $$,
  'each entry on the Collections of its shelves, in file order');

-- Importing again
select is(
  tests.outcomes(public.import_books(format($$ [
    {"key": "goodreads:101", "book_id": %s, "status": "finished", "ended_on": "2024-02-01", "rating": 20, "extra_reads": 2,
     "collections": ["Favourites", "To Keep"]},
    {"key": "goodreads:109", "file_title": "Red Rising", "file_author": "Pierce Brown",
     "other_keys": ["goodreads:101", "goodreads:102"],
     "book": {"title": "Red Rising", "authors": ["Pierce Brown"], "source": "manual"}, "status": "want_to_read",
     "collections": ["Later"]}
  ] $$, to_json(:'red_en'::text))::jsonb)),
  array['imported', 'added'],
  'the same row again is imported; a third row of the work is its own entry too');
select is(
  (select count(*)::int from public.reading_sessions s join public.library_entries e on e.id = s.entry_id
    where e.member_id = :'lena_id' and e.import_key = 'goodreads:101'),
  3, 'importing again adds no read');
select results_eq(
  format($$ select c.name from public.collection_entries ce join public.collections c on c.id = ce.collection_id
              join public.library_entries e on e.id = ce.entry_id
             where e.member_id = %L and e.import_key = 'goodreads:101' order by c.position $$, :'lena_id'),
  $$ values ('favourites'), ('Sci-Fi'), ('To Keep') $$,
  'a row imported before still goes on the shelves chosen now, once each');

-- The title match (#104) still finds what she added herself.
reset role;
insert into public.books (title, authors, source, owner_id) values ('Golden Son', '{Pierce Brown}', 'manual', :'lena_id')
  returning id as golden \gset
insert into public.library_entries (member_id, book_id) values (:'lena_id', :'golden');
select tests.act_as(:'lena_id');
select is(
  tests.outcomes(public.import_books($$ [
    {"key": "goodreads:110", "file_title": "Golden Son", "file_author": "Pierce Brown", "status": "want_to_read",
     "book": {"title": "Golden Son", "authors": ["Pierce Brown"], "isbn13": "9790000002030", "source": "import"},
     "collections": ["Later"]}
  ] $$)),
  array['in_library'], 'a book she added in the app is still found by its title');
select is(
  (select count(*)::int from public.collection_entries ce join public.collections c on c.id = ce.collection_id
    where c.member_id = :'lena_id' and c.name = 'Later'),
  2, 'and put on the shelf chosen for it');

-- A row the file does not tie to the others: an edition switched on Goodreads since.
select is(
  tests.outcomes(public.import_books($$ [
    {"key": "goodreads:111", "file_title": "Red Rising", "file_author": "Pierce Brown",
     "status": "want_to_read",
     "book": {"title": "Red Rising", "authors": ["Pierce Brown"], "isbn13": "9790000002047", "source": "import"}}
  ] $$)),
  array['in_library'], 'a Book Id the file does not tie to the others is matched by title as before');

reset role;
select ok(
  not has_function_privilege('authenticated', 'public.import_place_in_collections(uuid, uuid, jsonb)', 'execute'),
  'members cannot place entries on Collections around import_books');

select * from finish();
rollback;
