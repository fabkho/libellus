-- Authors, series and genres (issues #166, #167, #168):
--   supabase test db
--
-- The canonical genre list; a Catalogue Book entering the queue (a Manual
-- book never); what the enrich edge function stores through enrich_save; the
-- readers phase 2 calls (author_page, book_series_info, series_works,
-- next_in_series, book_genres, library_genres, book_authors_of) with the
-- member's statuses; her corrections (set/reset_entry_genres,
-- set/reset_entry_series), hers alone; and RLS: catalogue facts readable by
-- members, written only by the service role. Assertions act as signed-in
-- members and ask about the rows this test made.

begin;
select plan(59);

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-ENRICH', 'enrichment test', 5);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-ENRICH"}'::jsonb, now(), now(), now());
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

-- The queue, past the API: it lives in `private`.
create or replace function tests.queued(p_book uuid)
returns text language sql security definer as $$
  select reason from private.enrich_queue where book_id = p_book
$$;

select tests.member('ada@enrich.pgtap.test') as ada_id \gset
select tests.member('ben@enrich.pgtap.test') as ben_id \gset

grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

-- ------------------------------------------------------------ the genre list

select is((select count(*)::int from public.genres), 20, 'the canonical list has twenty genres');
select results_eq(
  $$select id from public.genres order by position$$,
  $$values ('sci-fi'), ('fantasy'), ('horror'), ('crime'), ('thriller'), ('romance'), ('literary'),
           ('historical'), ('classics'), ('ya'), ('graphic'), ('poetry'), ('short-stories'), ('nonfiction'),
           ('biography'), ('history'), ('science'), ('philosophy'), ('self-help'), ('essays')$$,
  'with the ids and order of web/app/data/enrich/genres.ts');

-- ------------------------------------------------- entering the Catalogue

select tests.act_as(:'ada_id');
select (public.add_to_library('{"title":"Guards! Guards!","authors":["Terry Pratchett"],"source":"apple","apple_id":"990000016101"}',
                              'finished', '2026-09-01', '2026-09-10', 18)).id as guards_entry_id \gset
select (public.add_to_library('{"title":"Men at Arms","authors":["Terry Pratchett"],"source":"apple","apple_id":"990000016102"}')).id
  as men_entry \gset
select (public.add_to_library('{"title":"The Lathe of Heaven","authors":["Ursula K. Le Guin"],"source":"apple","apple_id":"990000016103"}')).id
  as lathe_entry \gset
select (public.add_manual_book('A Notebook', array['Ada'])).book_id as notebook \gset

reset role;
select book_id as guards from public.library_entries where id = :'guards_entry_id' \gset
select book_id as men from public.library_entries where id = :'men_entry' \gset
select book_id as lathe from public.library_entries where id = :'lathe_entry' \gset

select is(tests.queued(:'guards'), 'new', 'a Book entering the Catalogue is queued for enrichment');
select is(tests.queued(:'notebook'), null, 'a Manual book is not: it never leaves its member');

select tests.act_as(:'ben_id');
select (public.add_to_library('{"title":"Guards! Guards!","authors":["Terry Pratchett"],"source":"apple","apple_id":"990000016101"}')).id
  as ben_guards_entry \gset

-- ------------------------------------------ what the function stores

select throws_ok($$select public.enrich_save('{}'::jsonb)$$, '42501', null,
  'a member cannot store enrichment');
select throws_ok($$select public.enrich_claim(1)$$, '42501', null, 'nor claim from the queue');
select throws_ok($$insert into public.book_genres (book_id, genre_id, rank, source, confidence, map_version)
                   values (gen_random_uuid(), 'fantasy', 1, 'apple', 1, 1)$$, '42501', null,
  'nor write a computed genre directly');
select throws_ok($$insert into public.works (wikidata_id, title) values ('Q1', 'Mine')$$, '42501', null,
  'nor a work');

reset role;
set local role service_role;

select lives_ok(format($$select public.enrich_save(%L::jsonb)$$, jsonb_build_object(
  'authors', jsonb_build_array(jsonb_build_object(
    'wikidata', 'Q990000001', 'openlibrary', 'OL990001A', 'name', 'Terry Pratchett', 'fetched', true, 'worksFetched', true,
    'birthDate', '1948-04-28', 'birthPrecision', 11, 'deathDate', '2015-03-12', 'deathPrecision', 11,
    'photoUrl', 'https://upload.wikimedia.org/pratchett.jpg',
    'photoCredit', jsonb_build_object('source', 'commons', 'artist', 'Luigi Novi', 'licence', 'CC BY 3.0'),
    'summaries', jsonb_build_object('en', jsonb_build_object('text', 'An English author.', 'title', 'Terry Pratchett',
                                                            'url', 'https://en.wikipedia.org/wiki/Terry_Pratchett')))),
  'series', jsonb_build_array(
    jsonb_build_object('wikidata', 'Q990000010', 'name', 'Discworld', 'fetched', true),
    jsonb_build_object('wikidata', 'Q990000011', 'name', 'Ankh-Morpork City Watch',
                       'parent', jsonb_build_object('wikidata', 'Q990000010'), 'fetched', true)),
  'works', jsonb_build_array(
    jsonb_build_object('wikidata', 'Q990000020', 'title', 'Men at Arms', 'year', 1993, 'kind', 'novel',
      'authors', jsonb_build_array(jsonb_build_object('wikidata', 'Q990000001', 'name', 'Terry Pratchett')),
      'series', jsonb_build_array(
        jsonb_build_object('series', jsonb_build_object('wikidata', 'Q990000010'), 'position', 15, 'source', 'wikidata'),
        jsonb_build_object('series', jsonb_build_object('wikidata', 'Q990000011'), 'position', 2, 'source', 'wikidata'))),
    jsonb_build_object('wikidata', 'Q990000021', 'title', 'Feet of Clay', 'year', 1996, 'kind', 'novel',
      'genres', jsonb_build_array('fantasy', 'crime'),
      'editions', jsonb_build_object('en', jsonb_build_object('title', 'Feet of Clay', 'isbn13', '9780061807022')),
      'authors', jsonb_build_array(jsonb_build_object('wikidata', 'Q990000001', 'name', 'Terry Pratchett')),
      'series', jsonb_build_array(
        jsonb_build_object('series', jsonb_build_object('wikidata', 'Q990000010'), 'position', 19, 'source', 'wikidata'),
        jsonb_build_object('series', jsonb_build_object('wikidata', 'Q990000011'), 'position', 3, 'source', 'wikidata'))),
    jsonb_build_object('wikidata', 'Q990000022', 'title', 'Small Gods', 'year', 1992, 'kind', 'novel',
      'titles', jsonb_build_object('de', 'Einfach göttlich'),
      'authors', jsonb_build_array(jsonb_build_object('wikidata', 'Q990000001', 'name', 'Terry Pratchett')),
      'series', jsonb_build_array(
        jsonb_build_object('series', jsonb_build_object('wikidata', 'Q990000010'), 'position', 13, 'source', 'wikidata'))),
    jsonb_build_object('wikidata', 'Q990000023', 'title', 'The Science of Discworld', 'kind', 'nonfiction',
      'authors', jsonb_build_array(jsonb_build_object('wikidata', 'Q990000001', 'name', 'Terry Pratchett')))),
  'book', jsonb_build_object(
    'id', :'guards', 'matchedBy', 'isbn', 'status', 'enriched', 'mapVersion', 1, 'sources', jsonb_build_array('wikidata', 'apple'),
    'signals', jsonb_build_array(jsonb_build_object('source', 'apple', 'value', 'Fantasy')),
    'work', jsonb_build_object('wikidata', 'Q990000024', 'openlibrary', 'OL990024W', 'title', 'Guards! Guards!', 'year', 1989,
      'kind', 'novel', 'genres', jsonb_build_array('fantasy'),
      'series', jsonb_build_array(
        jsonb_build_object('series', jsonb_build_object('wikidata', 'Q990000010'), 'position', 8, 'source', 'wikidata'),
        jsonb_build_object('series', jsonb_build_object('wikidata', 'Q990000011'), 'position', 1, 'source', 'wikidata'))),
    'authors', jsonb_build_array(jsonb_build_object('position', 1,
      'author', jsonb_build_object('wikidata', 'Q990000001', 'openlibrary', 'OL990001A', 'name', 'Terry Pratchett'))),
    'genres', jsonb_build_array(jsonb_build_object('genre', 'fantasy', 'rank', 1, 'source', 'wikidata', 'confidence', 1),
                                jsonb_build_object('genre', 'crime', 'rank', 2, 'source', 'apple', 'confidence', 0.9))))
), 'the service role stores a Book''s work, series, authors and genres in one call');

select lives_ok(format($$select public.enrich_save(%L::jsonb)$$, jsonb_build_object(
  'authors', '[]'::jsonb, 'series', '[]'::jsonb, 'works', '[]'::jsonb,
  'book', jsonb_build_object('id', :'men', 'matchedBy', 'title', 'status', 'enriched', 'mapVersion', 1,
    'work', jsonb_build_object('wikidata', 'Q990000020', 'title', 'Men at Arms'),
    'authors', jsonb_build_array(jsonb_build_object('position', 1,
      'author', jsonb_build_object('wikidata', 'Q990000001', 'name', 'Terry Pratchett'))),
    'genres', '[]'::jsonb))
), 'and the next Book links to the work and author already there');

select lives_ok(format($$select public.enrich_save(%L::jsonb)$$, jsonb_build_object(
  'book', jsonb_build_object('id', :'lathe', 'status', 'not_found', 'mapVersion', 1, 'work', null,
    'authors', jsonb_build_array(jsonb_build_object('position', 1, 'author', jsonb_build_object('name', 'Ursula K. Le Guin'))),
    'genres', '[]'::jsonb))
), 'a Book nobody knows is stored as not found, its author by name');

reset role;
select is(tests.queued(:'guards'), null, 'a stored Book leaves the queue');
select is((select count(*)::int from public.authors where wikidata_id = 'Q990000001'), 1,
  'one author row, whichever key found it');
select is((select openlibrary_key from public.authors where wikidata_id = 'Q990000001'), 'OL990001A',
  'with both keys');
select is((select p.name from public.series s join public.series p on p.id = s.parent_id where s.wikidata_id = 'Q990000011'),
  'Discworld', 'a sub-series knows its parent');

-- ---------------------------------------------------- the queue's own rules

select tests.act_as(:'ada_id');
select (public.add_to_library('{"title":"Thud!","authors":["Terry Pratchett"],"source":"apple","apple_id":"990000016104"}')).book_id
  as thud \gset
select (public.add_to_library('{"title":"Snuff","authors":["Terry Pratchett"],"source":"apple","apple_id":"990000016105"}')).book_id
  as snuff \gset
reset role;

select is(private.enrich_kick(), 'off', 'without the function''s address nothing is sent');
update private.enrich_settings set function_url = 'https://example.test/functions/v1/enrich';
select is(private.enrich_kick(), 'unavailable', 'nor without its token in the Vault');
update private.enrich_queue set attempts = 1 where book_id = :'thud';
update private.enrich_queue set attempts = 6 where book_id = :'snuff';
set local role service_role;
select public.enrich_failed(:'thud', 'source_unavailable 503 openlibrary.org');
select public.enrich_failed(:'snuff', 'source_unavailable 503 openlibrary.org');
reset role;
select ok((select not_before > now() + interval '9 minutes' from private.enrich_queue where book_id = :'thud'),
  'a Book whose sources failed waits before it is tried again');
select is((select status from public.book_enrichment where book_id = :'snuff'), 'failed',
  'after six attempts it is given up and recorded as failed');
delete from public.book_enrichment where book_id = :'guards';
set local role service_role;
select ok(public.enrich_backfill() >= 1, 'the backfill queues Books never enriched');
reset role;
select is(tests.queued(:'guards'), 'backfill', 'among them one whose enrichment was removed');

-- A stub never erases a fetched author.
set local role service_role;
select public.enrich_save('{"authors":[{"wikidata":"Q990000001","name":"T. Pratchett"}]}');
reset role;
select is((select photo_url from public.authors where wikidata_id = 'Q990000001'), 'https://upload.wikimedia.org/pratchett.jpg',
  'a credit stub from another work leaves the fetched author as it was');

-- ----------------------------------------------------- the readers, as Ada

select tests.act_as(:'ada_id');

select is((select count(*)::int from public.authors where wikidata_id = 'Q990000001'), 1, 'a member reads authors');
select results_eq(
  format($$select credit_position, name, author_key from public.book_authors_of(%L)$$, :'guards'),
  $$values (1::smallint, 'Terry Pratchett', 'Q990000001')$$,
  'a Book''s linked author, with the key their page opens by');

select is(public.author_page('Q990000001') -> 'author' ->> 'name', 'Terry Pratchett', 'the author page by Wikidata item');
select is(public.author_page('OL990001A') -> 'author' ->> 'key', 'Q990000001', 'by Open Library id, the same page');
select is(public.author_page('Q999999999'), null, 'an unknown author has no page');
select is(public.author_page('Q990000001') -> 'author' -> 'born', '{"date": "1948-04-28", "precision": 11}'::jsonb,
  'life dates with their precision');
select is(public.author_page('Q990000001') -> 'author' -> 'summary' ->> 'url', 'https://en.wikipedia.org/wiki/Terry_Pratchett',
  'the Wikipedia intro with its address, for the credit');
select is(public.author_page('Q990000001') -> 'author' -> 'photo' -> 'credit' ->> 'licence', 'CC BY 3.0',
  'the photo with its licence');
select is(public.author_page('Q990000001', 'de') -> 'author' -> 'summary' ->> 'language', 'en',
  'no German intro: the English one, saying so');

select is(
  (select jsonb_agg(g -> 'name') from jsonb_array_elements(public.author_page('Q990000001') -> 'series') g),
  '["Ankh-Morpork City Watch", "Discworld"]'::jsonb,
  'series groups, the sub-series first');
select is(
  (select jsonb_agg(jsonb_build_array(w ->> 'title', (w ->> 'position')::numeric, w -> 'entry' ->> 'status'))
     from jsonb_array_elements(public.author_page('Q990000001') -> 'series' -> 0 -> 'works') w),
  '[["Guards! Guards!", 1, "finished"], ["Men at Arms", 2, "want_to_read"], ["Feet of Clay", 3, null]]'::jsonb,
  'the City Watch in reading order, with her statuses');
select is(public.author_page('Q990000001') -> 'series' -> 0 -> 'works' -> 0 -> 'entry' ->> 'rating', '18',
  'and her rating of the one she finished');
select is(
  (select jsonb_agg(w ->> 'title') from jsonb_array_elements(public.author_page('Q990000001') -> 'series' -> 1 -> 'works') w),
  '["Small Gods"]'::jsonb,
  'Discworld lists only the works in no sub-series');
select is(public.author_page('Q990000001', 'de') -> 'series' -> 1 -> 'works' -> 0 ->> 'title', 'Einfach göttlich',
  'in her language where the work has a title in it');
select is(
  (select jsonb_agg(w ->> 'title') from jsonb_array_elements(public.author_page('Q990000001') -> 'other') w),
  '["The Science of Discworld"]'::jsonb,
  'non-fiction under Other');
select ok((public.author_page('Q990000001') -> 'genres') ? 'fantasy', 'the genre chips aggregate the works');

select is(public.book_series_info(:'guards') -> 'series' -> 0 ->> 'name', 'Ankh-Morpork City Watch',
  'a Book''s series, the most specific first');
select is((public.book_series_info(:'guards') -> 'series' -> 0 ->> 'position')::numeric, 1::numeric, 'with its position');
select is((public.book_series_info(:'guards') -> 'series' -> 0 ->> 'count')::int, 3, 'and how many the series has');

select is(
  (select jsonb_build_array(n -> 'series' ->> 'name', n -> 'next' ->> 'title', n -> 'next' -> 'entry' ->> 'status')
     from jsonb_array_elements(public.next_in_series()) n),
  '["Ankh-Morpork City Watch", "Men at Arms", "want_to_read"]'::jsonb,
  'next in her series: the one after the last she finished, in the sub-series rather than Discworld');

-- ---------------------------------------------------------- her genres

select results_eq(format($$select genre_id from public.book_genres(%L)$$, :'guards'),
  $$values ('fantasy'), ('crime')$$, 'a Book''s computed genres, in rank order');
select results_eq(format($$select * from public.set_entry_genres(%L, array['crime', 'fantasy', 'crime'])$$, :'guards_entry_id'),
  $$values ('crime'), ('fantasy')$$, 'she sets her own, duplicates folded');
select results_eq(format($$select genre_id, source from public.book_genres(%L)$$, :'guards'),
  $$values ('crime', 'member'), ('fantasy', 'member')$$, 'and sees hers instead of the computed ones');
select throws_ok(format($$select public.set_entry_genres(%L, array['fantasy','crime','horror','romance'])$$, :'guards_entry_id'),
  '22023', 'genres_invalid', 'four genres are too many');
select throws_ok(format($$select public.set_entry_genres(%L, array['space-western'])$$, :'guards_entry_id'),
  '22023', 'genres_invalid', 'an unknown genre is refused');
select throws_ok(format($$select public.set_entry_genres(%L, array['fantasy'])$$, :'ben_guards_entry'),
  'P0002', 'entry_not_found', 'not on another member''s entry');
select is(
  (select genre_ids from public.library_genres() where entry_id = :'guards_entry_id'),
  array['crime', 'fantasy'], 'her Library''s genres carry her choice');

select tests.act_as(:'ben_id');
select results_eq(format($$select genre_id from public.book_genres(%L)$$, :'guards'),
  $$values ('fantasy'), ('crime')$$, 'another member still sees the computed genres');
select is((select count(*)::int from public.entry_genres where entry_id = :'guards_entry_id'), 0,
  'and none of hers');

select tests.act_as(:'ada_id');
select results_eq(format($$select * from public.reset_entry_genres(%L)$$, :'guards_entry_id'),
  $$values ('fantasy'), ('crime')$$, 'reset: back to the computed genres');

-- ---------------------------------------------------------- her series

select is(public.set_entry_series(:'lathe_entry', null, 'The Ada Cycle', 6.5) -> 'series' -> 0 ->> 'name',
  'The Ada Cycle', 'she puts a Book into a series by name, at a position with a decimal');
select is((public.book_series_info(:'lathe') ->> 'overridden')::boolean, true, 'her correction stands');
select is((select source from public.series where name = 'The Ada Cycle' and created_by = :'ada_id'), 'member',
  'a series nobody knew is hers');
select throws_ok(format($$select public.set_entry_series(%L, null, null, 2)$$, :'lathe_entry'),
  '22023', 'series_invalid', 'a position without a series is refused');
select is(public.set_entry_series(:'guards_entry_id', null, null, null) -> 'series', '[]'::jsonb,
  'she can say a Book is in no series');
select is((public.reset_entry_series(:'guards_entry_id') -> 'series' -> 0 ->> 'name'), 'Ankh-Morpork City Watch',
  'reset: the computed series again');

select tests.act_as(:'ben_id');
select is((select count(*)::int from public.series where name = 'The Ada Cycle'), 0,
  'another member does not see the series she named');

reset role;
select * from finish();
rollback;
