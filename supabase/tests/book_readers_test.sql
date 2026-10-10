-- Readers on a Book's page (social v2a contract §1.5, task V2A-C6):
--   supabase test db
--
-- book_readers(book, after, limit): the followed members who hold the same work, one row each with her most
-- relevant state and only what her profile shows the caller. The privacy matrix: a private account whose request
-- is pending or declined, a block either way, a hidden Book, each switch off, ratings off (no stars), reviews off
-- (no review), a failed Catalogue row (it pairs nobody), another edition (it does), a stranger, another work, the
-- caller's own row; the order, the keyset page, the spoiler fold, the likes, no extra field; and who may ask.

begin;
select plan(56);

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-READERS-1', 'readers test', 60);

create or replace function tests.member(p_email text, p_name text default null)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, jsonb_strip_nulls(jsonb_build_object('invite_code', 'T-READERS-1', 'name', p_name)), now(), now(), now());
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

create or replace function tests.act_anon()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
end;
$$;

-- A snapshot the way a client sends one: a blurb of her own, and a cover on a host that is not a source's.
create or replace function tests.snap(p_title text)
returns jsonb language sql as $$
  select jsonb_build_object('title', p_title, 'authors', jsonb_build_array('An Author'), 'source', 'apple',
                            'apple_id', (9800000000 + floor(random() * 99999999))::bigint::text,
                            'description', 'Blurb of ' || p_title,
                            'cover_url', 'https://example.org/' || md5(p_title) || '.jpg',
                            'cover_thumbhash', 'abc', 'cover_dominant', '#112233', 'cover_secondary', '#445566')
$$;

create or replace function tests.book_of(p_entry uuid)
returns uuid language sql security definer as $$ select book_id from public.library_entries where id = p_entry $$;

grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

create temporary table ids (name text primary key, id uuid) on commit drop;
grant all on ids to authenticated, anon;

-- Whatever else is in this database is checked already: the claims below see only this test's Books.
update public.books set checked_at = now() where owner_id is null and checked_at is null;

create or replace function tests.ed(p_title text, p_work text default 'OL7771001W')
returns jsonb language sql as $$
  select jsonb_build_object('title', p_title, 'authors', jsonb_build_array('An Author'), 'source', 'openlibrary',
                            'openlibrary_edition_key', 'OL' || (floor(random() * 8000000) + 1000000)::bigint || 'M',
                            'openlibrary_work_key', p_work)
$$;
grant execute on all functions in schema tests to anon, authenticated;

create or replace function tests.readers(p_caller uuid, p_book uuid, p_after jsonb default null, p_limit integer default 50)
returns jsonb language plpgsql security definer as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_caller, 'role', 'authenticated')::text, true);
  return public.book_readers(p_book, p_after, p_limit);
end;
$$;
create or replace function tests.names(p_answer jsonb)
returns text[] language sql as $$
  select coalesce(array_agg(i -> 'member' ->> 'name' order by n), '{}') from jsonb_array_elements(p_answer -> 'items') with ordinality as t(i, n)
$$;
create or replace function tests.row_of(p_answer jsonb, p_name text)
returns jsonb language sql as $$ select i from jsonb_array_elements(p_answer -> 'items') i where i -> 'member' ->> 'name' = p_name $$;
grant execute on all functions in schema tests to anon, authenticated;

-- ---------------------------------------------------------------- the cast

insert into ids values
  ('ben', tests.member('ben@readers.pgtap.test', 'Ben')),
  ('ada', tests.member('ada@readers.pgtap.test', 'Ada')),     -- finished, a spoiler review, five stars
  ('cy',  tests.member('cy@readers.pgtap.test', 'Cy')),       -- finished with a plain review, older
  ('dee', tests.member('dee@readers.pgtap.test', 'Dee')),     -- finished, no review
  ('dan', tests.member('dan@readers.pgtap.test', 'Dan')),     -- reading
  ('eve', tests.member('eve@readers.pgtap.test', 'Eve')),     -- wants to read
  ('fay', tests.member('fay@readers.pgtap.test', 'Fay')),     -- abandoned, switch on
  ('gus', tests.member('gus@readers.pgtap.test', 'Gus')),     -- abandoned, switch off
  ('hal', tests.member('hal@readers.pgtap.test', 'Hal')),     -- private, request pending
  ('ivy', tests.member('ivy@readers.pgtap.test', 'Ivy')),     -- private, request declined
  ('jo',  tests.member('jo@readers.pgtap.test', 'Jo')),       -- blocked by Ben
  ('kim', tests.member('kim@readers.pgtap.test', 'Kim')),     -- blocked Ben
  ('lee', tests.member('lee@readers.pgtap.test', 'Lee')),     -- hidden Book
  ('mo',  tests.member('mo@readers.pgtap.test', 'Mo')),       -- finished, Finished switch off
  ('nia', tests.member('nia@readers.pgtap.test', 'Nia')),     -- reading, Reading switch off
  ('ola', tests.member('ola@readers.pgtap.test', 'Ola')),     -- wants, Want switch off
  ('pat', tests.member('pat@readers.pgtap.test', 'Pat')),     -- finished, Ratings off
  ('quin', tests.member('quin@readers.pgtap.test', 'Quin')),  -- finished, Reviews off
  ('rex', tests.member('rex@readers.pgtap.test', 'Rex')),     -- an edition the check failed
  ('sue', tests.member('sue@readers.pgtap.test', 'Sue')),     -- public, not followed
  ('tim', tests.member('tim@readers.pgtap.test', 'Tim')),     -- another work
  ('una', tests.member('una@readers.pgtap.test', 'Una'));     -- reading AND finished earlier (reading wins)

-- Everyone public but Hal and Ivy (private); then their switches.
select tests.act_as((select id from ids where name = 'ada')); select public.set_private(false);
select tests.act_as((select id from ids where name = 'cy')); select public.set_private(false);
select tests.act_as((select id from ids where name = 'dee')); select public.set_private(false);
select tests.act_as((select id from ids where name = 'dan')); select public.set_private(false);
select tests.act_as((select id from ids where name = 'eve')); select public.set_private(false);
select tests.act_as((select id from ids where name = 'fay')); select public.set_private(false);
select tests.act_as((select id from ids where name = 'gus')); select public.set_private(false);
select tests.act_as((select id from ids where name = 'hal')); select public.set_private(true);
select tests.act_as((select id from ids where name = 'ivy')); select public.set_private(true);
select tests.act_as((select id from ids where name = 'jo')); select public.set_private(false);
select tests.act_as((select id from ids where name = 'kim')); select public.set_private(false);
select tests.act_as((select id from ids where name = 'lee')); select public.set_private(false);
select tests.act_as((select id from ids where name = 'mo')); select public.set_private(false);
select tests.act_as((select id from ids where name = 'nia')); select public.set_private(false);
select tests.act_as((select id from ids where name = 'ola')); select public.set_private(false);
select tests.act_as((select id from ids where name = 'pat')); select public.set_private(false);
select tests.act_as((select id from ids where name = 'quin')); select public.set_private(false);
select tests.act_as((select id from ids where name = 'rex')); select public.set_private(false);
select tests.act_as((select id from ids where name = 'sue')); select public.set_private(false);
select tests.act_as((select id from ids where name = 'tim')); select public.set_private(false);
select tests.act_as((select id from ids where name = 'una')); select public.set_private(false);
select tests.act_as((select id from ids where name = 'gus')); select public.set_social_sections('{"abandoned": false}');
select tests.act_as((select id from ids where name = 'mo')); select public.set_social_sections('{"finished": false}');
select tests.act_as((select id from ids where name = 'nia')); select public.set_social_sections('{"reading": false}');
select tests.act_as((select id from ids where name = 'ola')); select public.set_social_sections('{"want": false}');
select tests.act_as((select id from ids where name = 'pat')); select public.set_social_sections('{"ratings": false}');
select tests.act_as((select id from ids where name = 'quin')); select public.set_social_sections('{"reviews": false}');

-- ------------------------------------------------------------------ their Books (all editions of one work)

select tests.act_as((select id from ids where name = 'ben'));
insert into ids values ('ben_e', (public.add_to_library(tests.ed('The Work'), 'want_to_read', null)).id);
select tests.act_as((select id from ids where name = 'ada')); insert into ids values ('ada_e', (public.add_to_library(tests.ed('The Work'), 'finished', date '2026-10-05' - 5, date '2026-10-05', 18, 'Ada review', true)).id);
select tests.act_as((select id from ids where name = 'cy')); insert into ids values ('cy_e', (public.add_to_library(tests.ed('The Work'), 'finished', date '2026-10-01' - 5, date '2026-10-01', 14, 'Cy review', false)).id);
select tests.act_as((select id from ids where name = 'dee')); insert into ids values ('dee_e', (public.add_to_library(tests.ed('The Work'), 'finished', date '2026-10-09' - 5, date '2026-10-09', 12, null, false)).id);
select tests.act_as((select id from ids where name = 'dan')); insert into ids values ('dan_e', (public.add_to_library(tests.ed('The Work'), 'reading', date '2026-10-08')).id);
select tests.act_as((select id from ids where name = 'eve')); insert into ids values ('eve_e', (public.add_to_library(tests.ed('The Work'), 'want_to_read', null)).id);
select tests.act_as((select id from ids where name = 'fay')); insert into ids values ('fay_e', (public.add_to_library(tests.ed('The Work'), 'reading', date '2026-09-20')).id);
select tests.act_as((select id from ids where name = 'gus')); insert into ids values ('gus_e', (public.add_to_library(tests.ed('The Work'), 'reading', date '2026-09-20')).id);
select tests.act_as((select id from ids where name = 'hal')); insert into ids values ('hal_e', (public.add_to_library(tests.ed('The Work'), 'finished', date '2026-10-04' - 5, date '2026-10-04', 16, 'Hal review', false)).id);
select tests.act_as((select id from ids where name = 'ivy')); insert into ids values ('ivy_e', (public.add_to_library(tests.ed('The Work'), 'finished', date '2026-10-04' - 5, date '2026-10-04', 16, 'Ivy review', false)).id);
select tests.act_as((select id from ids where name = 'jo')); insert into ids values ('jo_e', (public.add_to_library(tests.ed('The Work'), 'finished', date '2026-10-04' - 5, date '2026-10-04', 16, 'Jo review', false)).id);
select tests.act_as((select id from ids where name = 'kim')); insert into ids values ('kim_e', (public.add_to_library(tests.ed('The Work'), 'finished', date '2026-10-04' - 5, date '2026-10-04', 16, 'Kim review', false)).id);
select tests.act_as((select id from ids where name = 'lee')); insert into ids values ('lee_e', (public.add_to_library(tests.ed('The Work'), 'finished', date '2026-10-04' - 5, date '2026-10-04', 16, 'Lee review', false)).id);
select tests.act_as((select id from ids where name = 'mo')); insert into ids values ('mo_e', (public.add_to_library(tests.ed('The Work'), 'finished', date '2026-10-04' - 5, date '2026-10-04', 16, 'Mo review', false)).id);
select tests.act_as((select id from ids where name = 'nia')); insert into ids values ('nia_e', (public.add_to_library(tests.ed('The Work'), 'reading', date '2026-10-04')).id);
select tests.act_as((select id from ids where name = 'ola')); insert into ids values ('ola_e', (public.add_to_library(tests.ed('The Work'), 'want_to_read', null)).id);
select tests.act_as((select id from ids where name = 'pat')); insert into ids values ('pat_e', (public.add_to_library(tests.ed('The Work'), 'finished', date '2026-10-03' - 5, date '2026-10-03', 16, 'Pat review', false)).id);
select tests.act_as((select id from ids where name = 'quin')); insert into ids values ('quin_e', (public.add_to_library(tests.ed('The Work'), 'finished', date '2026-10-07' - 5, date '2026-10-07', 10, 'Quin review', false)).id);
select tests.act_as((select id from ids where name = 'rex')); insert into ids values ('rex_e', (public.add_to_library(tests.ed('The Work'), 'finished', date '2026-10-04' - 5, date '2026-10-04', 16, 'Rex review', false)).id);
select tests.act_as((select id from ids where name = 'sue')); insert into ids values ('sue_e', (public.add_to_library(tests.ed('The Work'), 'finished', date '2026-10-04' - 5, date '2026-10-04', 16, 'Sue review', false)).id);
select tests.act_as((select id from ids where name = 'tim')); insert into ids values ('tim_e', (public.add_to_library(tests.ed('Another Work', 'OL7771002W'), 'finished', date '2026-09-01', date '2026-10-04', 16, 'Tim review', false)).id);
select tests.act_as((select id from ids where name = 'una')); insert into ids values ('una_fin', (public.add_to_library(tests.ed('The Work'), 'finished', date '2026-09-10' - 5, date '2026-09-10', 20, 'Una earlier', false)).id);
select tests.act_as((select id from ids where name = 'una')); insert into ids values ('una_e', (public.add_to_library(tests.ed('The Work'), 'reading', date '2026-10-02')).id);

-- Abandoned reads, Lee's Book hidden, Rex's edition failed (its keys stay, as a direct mark leaves them).
select tests.act_as((select id from ids where name = 'fay')); select public.abandon_reading((select id from ids where name = 'fay_e'), date '2026-09-30', 'no');
select tests.act_as((select id from ids where name = 'gus')); select public.abandon_reading((select id from ids where name = 'gus_e'), date '2026-09-30', 'no');
select tests.act_as((select id from ids where name = 'lee')); select public.set_entry_hidden((select id from ids where name = 'lee_e'), true);
reset role;
update public.books set checked_at = now(), check_failed = true where id = tests.book_of((select id from ids where name = 'rex_e'));
insert into ids values ('book', tests.book_of((select id from ids where name = 'ben_e')));

-- ----------------------------------------------------------------- who Ben follows

-- A private account is asked for through her follow link.
create temporary table links (name text primary key, link text) on commit drop;
grant all on links to authenticated;
select tests.act_as((select id from ids where name = 'hal')); insert into links values ('hal', public.my_social() ->> 'link');
select tests.act_as((select id from ids where name = 'ivy')); insert into links values ('ivy', public.my_social() ->> 'link');
select tests.act_as((select id from ids where name = 'ben'));
select public.follow_target((select link from links where name = 'hal'));
select public.follow_target((select link from links where name = 'ivy'));

select tests.act_as((select id from ids where name = 'ben'));
select public.follow((select id from ids where name = 'ada'));
select public.follow((select id from ids where name = 'cy'));
select public.follow((select id from ids where name = 'dee'));
select public.follow((select id from ids where name = 'dan'));
select public.follow((select id from ids where name = 'eve'));
select public.follow((select id from ids where name = 'fay'));
select public.follow((select id from ids where name = 'gus'));
select public.follow((select id from ids where name = 'hal'));
select public.follow((select id from ids where name = 'ivy'));
select public.follow((select id from ids where name = 'jo'));
select public.follow((select id from ids where name = 'kim'));
select public.follow((select id from ids where name = 'lee'));
select public.follow((select id from ids where name = 'mo'));
select public.follow((select id from ids where name = 'nia'));
select public.follow((select id from ids where name = 'ola'));
select public.follow((select id from ids where name = 'pat'));
select public.follow((select id from ids where name = 'quin'));
select public.follow((select id from ids where name = 'rex'));
select public.follow((select id from ids where name = 'tim'));
select public.follow((select id from ids where name = 'una'));
select tests.act_as((select id from ids where name = 'ivy')); select public.answer_request((select id from ids where name = 'ben'), false);
select tests.act_as((select id from ids where name = 'ben')); select public.block((select id from ids where name = 'jo'));
select tests.act_as((select id from ids where name = 'kim')); select public.block((select id from ids where name = 'ben'));
reset role;

-- --------------------------------------------------------------------- the list

create temporary table answer (a jsonb);
grant all on answer to authenticated;
insert into answer select tests.readers((select id from ids where name = 'ben'), (select id from ids where name = 'book'));
create or replace function tests.a() returns jsonb language sql as $$ select a from answer $$;
grant execute on function tests.a() to authenticated;

select is(tests.names(tests.a()), array['Ada','Pat','Cy','Dee','Quin','Dan','Una','Fay','Eve'], 'the followed readers of the work, finished with a review first, then finished, reading, abandoned, wants (newest first)');
select is((tests.a() ->> 'total')::int, 9, 'the total counts them');
select is(tests.a() -> 'next', 'null'::jsonb, 'with nothing after');
select is((select array_agg(k order by k) from jsonb_object_keys(tests.a()) k), array['items','next','total'], 'the answer has no other field');
select is((select array_agg(k order by k) from jsonb_object_keys(tests.row_of(tests.a(), 'Ada')) k),
  array['day','folded','liked','likes','member','rating','review','sessionId','spoilers','state'], 'a row has no other field');
select is((select array_agg(k order by k) from jsonb_object_keys(tests.row_of(tests.a(), 'Ada') -> 'member') k), array['id','name','photo'], 'her card is the card');

select is(tests.row_of(tests.a(), 'Ben'), null, 'the caller''s own row is never listed');
select is(tests.row_of(tests.a(), 'Hal'), null, 'a private account whose request is pending is not');
select is(tests.row_of(tests.a(), 'Ivy'), null, 'nor one whose request was declined');
select is(tests.row_of(tests.a(), 'Jo'), null, 'nor one Ben blocked');
select is(tests.row_of(tests.a(), 'Kim'), null, 'nor one who blocked Ben');
select is(tests.row_of(tests.a(), 'Lee'), null, 'nor a hidden Book');
select is(tests.row_of(tests.a(), 'Mo'), null, 'nor a member whose Finished switch is off');
select is(tests.row_of(tests.a(), 'Nia'), null, 'nor Reading off');
select is(tests.row_of(tests.a(), 'Ola'), null, 'nor Want to read off');
select is(tests.row_of(tests.a(), 'Gus'), null, 'nor an abandoned read with that switch off');
select is(tests.row_of(tests.a(), 'Rex'), null, 'nor an edition the check failed, which pairs nobody');
select is(tests.row_of(tests.a(), 'Sue'), null, 'nor a stranger Ben does not follow');
select is(tests.row_of(tests.a(), 'Tim'), null, 'nor another work');

select is(tests.row_of(tests.a(), 'Ada') - 'member' - 'sessionId',
  jsonb_build_object('state', 'finished', 'day', '2026-10-05', 'rating', 18, 'review', 'Ada review', 'spoilers', true, 'folded', true, 'likes', 0, 'liked', false),
  'a finished read with her stars and review; a spoiler Ben has not finished is folded');
select is(tests.row_of(tests.a(), 'Cy') - 'member' - 'sessionId',
  jsonb_build_object('state', 'finished', 'day', '2026-10-01', 'rating', 14, 'review', 'Cy review', 'spoilers', false, 'folded', false, 'likes', 0, 'liked', false),
  'a review without spoilers is not folded');
select is(tests.row_of(tests.a(), 'Dee') - 'member' - 'sessionId' - 'day',
  jsonb_build_object('state', 'finished', 'rating', 12, 'review', null, 'spoilers', false, 'folded', false, 'likes', 0, 'liked', false), 'finished without a review');
select is(tests.row_of(tests.a(), 'Pat') ->> 'rating', null, 'Ratings off: no stars');
select is(tests.row_of(tests.a(), 'Pat') ->> 'review', 'Pat review', 'but her review');
select is(tests.row_of(tests.a(), 'Quin') ->> 'review', null, 'Reviews off: no review');
select is(tests.row_of(tests.a(), 'Quin') ->> 'rating', '10', 'but her stars');
select is(tests.row_of(tests.a(), 'Quin') ->> 'state', 'finished', 'and she is listed as finished, below the reviews');
select is(tests.row_of(tests.a(), 'Dan') - 'member', jsonb_build_object('state', 'reading', 'day', '2026-10-08', 'rating', null, 'review', null, 'spoilers', false, 'folded', false, 'sessionId', null, 'likes', 0, 'liked', false), 'reading: the start day');
select is(tests.row_of(tests.a(), 'Una') ->> 'state', 'reading', 'an open read wins over an earlier finished one of hers (one row per member)');
select is(tests.row_of(tests.a(), 'Una') ->> 'review', null, 'and shows none of it');
select is(tests.row_of(tests.a(), 'Fay') - 'member', jsonb_build_object('state', 'abandoned', 'day', '2026-09-30', 'rating', null, 'review', null, 'spoilers', false, 'folded', false, 'sessionId', null, 'likes', 0, 'liked', false), 'abandoned, with that switch on');
select is(tests.row_of(tests.a(), 'Eve') ->> 'state', 'want', 'wants to read');
select is(tests.row_of(tests.a(), 'Eve') ->> 'day', current_date::text, 'since the day she added it');

-- ------------------------------------------------------------------- the page

create or replace function tests.walk(p_limit integer) returns text[] language plpgsql security definer as $$
declare v_after jsonb; v_all text[] := '{}'; v_answer jsonb; v_pages int := 0;
begin
  loop
    v_answer := tests.readers((select id from ids where name = 'ben'), (select id from ids where name = 'book'), v_after, p_limit);
    v_all := v_all || tests.names(v_answer);
    v_pages := v_pages + 1;
    exit when v_answer -> 'next' = 'null'::jsonb or v_pages > 20;
    v_after := v_answer -> 'next';
  end loop;
  return v_all || array['pages=' || v_pages];
end;
$$;
grant execute on function tests.walk(integer) to authenticated;
select is(tests.walk(4), array['Ada','Pat','Cy','Dee','Quin','Dan','Una','Fay','Eve', 'pages=3'], 'a page of four, followed by its cursor to the end: every reader once, in order');
select is(tests.walk(1), array['Ada','Pat','Cy','Dee','Quin','Dan','Una','Fay','Eve', 'pages=9'], 'and a page of one');
select is(tests.walk(50), array['Ada','Pat','Cy','Dee','Quin','Dan','Una','Fay','Eve', 'pages=1'], 'and one page of fifty');
select is(tests.names(tests.readers((select id from ids where name = 'ben'), (select id from ids where name = 'book'), null, 2)), array['Ada', 'Pat'], 'the first page of two');
select is(tests.readers((select id from ids where name = 'ben'), (select id from ids where name = 'book'), null, 2) -> 'next', jsonb_build_object('rank', 1, 'day', '2026-10-03', 'member', (select id from ids where name = 'pat')), 'with the cursor of its last row');
select is((tests.readers((select id from ids where name = 'ben'), (select id from ids where name = 'book'), null, 2) ->> 'total')::int, 9, 'and the total of all');
select is(tests.names(tests.readers((select id from ids where name = 'ben'), (select id from ids where name = 'book'), null, 1000)), array['Ada','Pat','Cy','Dee','Quin','Dan','Una','Fay','Eve'], 'a limit over fifty is fifty at most (all nine here)');
select throws_ok($$ select tests.readers((select id from ids where name = 'ben'), (select id from ids where name = 'book'), '{"rank": "x"}') $$, '22023', 'after_invalid', 'a cursor that is not one is refused');

-- ------------------------------------------------------ likes, spoilers, switches
select tests.act_as((select id from ids where name = 'ben'));
select public."like"((select (tests.row_of(tests.a(), 'Ada') ->> 'sessionId')::uuid));
select is(tests.row_of(tests.readers((select id from ids where name = 'ben'), (select id from ids where name = 'book')), 'Ada') -> 'likes', '1'::jsonb, 'Ben likes Ada''s read: the count');
select is(tests.row_of(tests.readers((select id from ids where name = 'ben'), (select id from ids where name = 'book')), 'Ada') -> 'liked', 'true'::jsonb, 'and he has');
select is(tests.row_of(tests.readers((select id from ids where name = 'ben'), (select id from ids where name = 'book')), 'Cy') -> 'liked', 'false'::jsonb, 'not Cy''s');

select public.finish_reading(null::uuid, null, null, null, null) where false;
select tests.act_as((select id from ids where name = 'ben'));
select public.start_reading((select id from ids where name = 'ben_e'), current_date - 2);
select public.finish_reading((select id from ids where name = 'ben_e'), current_date, 14, null, false);
select is(tests.row_of(tests.readers((select id from ids where name = 'ben'), (select id from ids where name = 'book')), 'Ada') -> 'folded', 'false'::jsonb, 'once Ben has finished the work, the spoiler is not folded');

select tests.act_as((select id from ids where name = 'ada')); select public.set_social_sections('{"reviews": false}');
select is(tests.row_of(tests.readers((select id from ids where name = 'ben'), (select id from ids where name = 'book')), 'Ada') ->> 'review', null, 'Ada switches reviews off: her review goes');
select is((tests.row_of(tests.readers((select id from ids where name = 'ben'), (select id from ids where name = 'book')), 'Ada') ->> 'spoilers')::boolean, false, 'and so does its spoiler flag');

select tests.act_as((select id from ids where name = 'hal')); select public.answer_request((select id from ids where name = 'ben'), true);
select is(tests.row_of(tests.readers((select id from ids where name = 'ben'), (select id from ids where name = 'book')), 'Hal') ->> 'review', 'Hal review', 'Hal accepts Ben: she is listed, with her review');
select tests.act_as((select id from ids where name = 'ben')); select public.block((select id from ids where name = 'cy'));
select is(tests.row_of(tests.readers((select id from ids where name = 'ben'), (select id from ids where name = 'book')), 'Cy'), null, 'Ben blocks Cy: she goes');
select tests.act_as((select id from ids where name = 'ben')); select public.unfollow((select id from ids where name = 'dee'));
select is(tests.row_of(tests.readers((select id from ids where name = 'ben'), (select id from ids where name = 'book')), 'Dee'), null, 'and so does a member Ben stops following');

-- ------------------------------------------------ Books that have no readers to show
select tests.act_as((select id from ids where name = 'ben'));
insert into ids values ('manual', (select book_id from public.add_manual_book('Ben''s Notebook', array['Ben'], null, null)));
select is(public.book_readers((select id from ids where name = 'manual')), '{"total": 0, "items": [], "next": null}'::jsonb, 'a Manual book has no work: nobody');
select is(public.book_readers(gen_random_uuid()), '{"total": 0, "items": [], "next": null}'::jsonb, 'a Book that is not there: nobody, the same answer');
select is(public.book_readers(tests.book_of((select id from ids where name = 'rex_e'))), '{"total": 0, "items": [], "next": null}'::jsonb, 'a failed Catalogue row Ben does not hold: nobody');

-- ------------------------------------------------------------------- who may ask
select tests.act_anon();
select throws_ok($$ select public.book_readers(gen_random_uuid()) $$, '42501', null, 'a visitor cannot call it');
reset role;
select is(has_function_privilege('authenticated', 'public.book_readers(uuid, jsonb, integer)', 'execute'), true, 'a member can');
select is(has_function_privilege('anon', 'public.book_readers(uuid, jsonb, integer)', 'execute'), false, 'a visitor cannot');

select * from finish();
rollback;
