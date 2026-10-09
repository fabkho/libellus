-- Social v1, D3: the activity a member's reading writes (docs/proposals/social-v1-contract.md §1.3):
--   supabase test db
--
-- Adding to Want to read, starting, finishing, putting down and a review written later each
-- write one row, through every path a member has (the RPCs and sync_write); an import, logging
-- an old read and the service role write nothing; a correction inside the settle window
-- replaces what was written; rows go with their read and their entry; old rows are purged.
-- The table is closed to the API roles. Assertions ask about rows this test made.
--
-- A Book added with a status writes its session's row, not want: the session replaces the want
-- row written in the same statement. Separate statements (this file's, the app's calls) keep both.

begin;
select plan(28);

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-SOCIAL-3', 'social activity test', 10);

create or replace function tests.member(p_email text, p_name text default null)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, jsonb_strip_nulls(jsonb_build_object('invite_code', 'T-SOCIAL-3', 'name', p_name)), now(), now(), now());
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

-- A Catalogue snapshot add_to_library takes, with an id of its own.
create or replace function tests.snap(p_title text)
returns jsonb language sql as $$
  select jsonb_build_object('title', p_title, 'authors', jsonb_build_array('An Author'), 'source', 'apple',
                            'apple_id', (9900000000 + floor(random() * 99999999))::bigint::text)
$$;

-- Past RLS, for the assertions: the kinds an entry has, sorted.
create or replace function tests.kinds(p_entry uuid)
returns text[] language sql security definer as $$
  select coalesce(array_agg(kind order by kind), '{}') from public.activity where entry_id = p_entry
$$;
create or replace function tests.row_of(p_entry uuid, p_kind text)
returns public.activity language sql security definer as $$
  select * from public.activity where entry_id = p_entry and kind = p_kind limit 1
$$;
create or replace function tests.rows_of(p_member uuid)
returns bigint language sql security definer as $$ select count(*) from public.activity where member_id = p_member $$;
create or replace function tests.session_of(p_entry uuid)
returns uuid language sql security definer as $$
  select id from public.reading_sessions where entry_id = p_entry order by created_at desc, started_on desc nulls last limit 1
$$;

grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

create temporary table ids (name text primary key, id uuid) on commit drop;
grant all on ids to authenticated;
create temporary table counts (name text primary key, n bigint) on commit drop;
grant all on counts to authenticated;

insert into ids values
  ('ada', tests.member('ada@social3.pgtap.test', 'Ada')),
  ('ben', tests.member('ben@social3.pgtap.test', 'Ben'));

-- Most of the test reads rows at once: no settle window. (The file is one transaction, so now()
-- is the same everywhere; statement_timestamp() is not.)
update private.social_config set settle_window = interval '0';

select has_table('public', 'activity', 'activity exists');
select has_index('public', 'activity', 'activity_feed', 'the feed reads it by member and time');

select tests.act_as((select id from ids where name = 'ben'));
select throws_ok($$ select 1 from public.activity $$, '42501', null, 'members cannot read activity directly');

-- ------------------------------------------------------------- the four kinds

select tests.act_as((select id from ids where name = 'ada'));

insert into ids values ('e1', (public.add_to_library(tests.snap('Kindred'), 'want_to_read')).id);
select is(tests.kinds((select id from ids where name = 'e1')), array['want'], 'adding to Want to read writes want');

select public.start_reading((select id from ids where name = 'e1'), current_date);
select is(tests.kinds((select id from ids where name = 'e1')), array['started', 'want'], 'starting writes started');
select is((tests.row_of((select id from ids where name = 'e1'), 'started')).on_day, current_date, 'on the day she started');

select public.finish_reading((select id from ids where name = 'e1'), current_date, 18, 'Loved it');
select is(tests.kinds((select id from ids where name = 'e1')), array['finished', 'started', 'want'], 'finishing writes finished');

insert into ids values ('e2', (public.add_to_library(tests.snap('Infinite Jest'), 'reading', current_date - 2)).id);
select is(tests.kinds((select id from ids where name = 'e2')), array['started'], 'adding as Currently reading writes started, not want');
select public.abandon_reading((select id from ids where name = 'e2'), current_date, 'too slow for now');
select is(tests.kinds((select id from ids where name = 'e2')), array['abandoned', 'started'], 'putting it down writes abandoned');

select public.read_again((select id from ids where name = 'e1'), current_date);
select is(tests.kinds((select id from ids where name = 'e1')), array['finished', 'started', 'started', 'want'], 'reading it again writes started again');

-- --------------------------------------------------------------- a later review

insert into ids values ('e3', (public.add_to_library(tests.snap('Piranesi'), 'reading', current_date - 5)).id);
select public.finish_reading((select id from ids where name = 'e3'), current_date, 16, null);
select public.update_session(tests.session_of((select id from ids where name = 'e3')), current_date - 5, current_date, 16, 'Words, a day later.', null);
select is(tests.kinds((select id from ids where name = 'e3')), array['finished', 'reviewed', 'started'], 'a review written after the finish writes reviewed');

-- -------------------------------------------------------- what writes nothing

insert into ids values ('old', (public.add_to_library(tests.snap('Middlemarch'), 'finished', current_date - 40, current_date - 30, 16, null)).id);
select is(tests.kinds((select id from ids where name = 'old')), '{}'::text[], 'logging a read that ended a month ago writes nothing');

-- A finished read without dates only comes from an import or an edit; written here as one
-- statement with her as the member (add_to_library refuses a finish without an end).
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub', (select id from ids where name = 'ada'), 'role', 'authenticated')::text, true);
do $$
declare v_book uuid; v_entry uuid;
begin
  insert into public.books (title, authors, source, apple_id) values ('Emma', array['X'], 'apple', '9988776611')
    returning id into v_book;
  insert into public.library_entries (member_id, book_id) values ((select id from ids where name = 'ada'), v_book)
    returning id into v_entry;
  insert into ids values ('undated', v_entry);
  insert into public.reading_sessions (entry_id, outcome) values (v_entry, 'finished');
end;
$$;
select is(tests.kinds((select id from ids where name = 'undated')), '{}'::text[], 'a finished read without dates writes nothing');
select tests.act_as((select id from ids where name = 'ada'));

insert into ids values ('recent', (public.add_to_library(tests.snap('Circe'), 'finished', current_date - 3, current_date - 1, 14, null)).id);
select is(tests.kinds((select id from ids where name = 'recent')), array['finished'], 'a read logged that ended yesterday is news');

insert into counts values ('before_import', tests.rows_of((select id from ids where name = 'ada')));
select is(
  (select array_agg(r ->> 'outcome' order by n) from jsonb_array_elements(public.import_books(jsonb_build_array(
    jsonb_build_object('key', 'social:1', 'status', 'want_to_read',
      'book', jsonb_build_object('title', 'Imported Wish', 'authors', jsonb_build_array('X'), 'source', 'manual',
                                 'cover_url', 'https://example.org/wish.jpg')),
    jsonb_build_object('key', 'social:2', 'status', 'finished', 'started_on', current_date - 2, 'ended_on', current_date, 'rating', 12,
      'book', jsonb_build_object('title', 'Imported Today', 'authors', jsonb_build_array('X'), 'source', 'manual',
                                 'cover_url', 'https://example.org/today.jpg'))))) with ordinality as t(r, n)),
  array['added', 'added'],
  'the import itself works');
select is(tests.rows_of((select id from ids where name = 'ada')), (select n from counts where name = 'before_import'),
  'an import writes nothing, not even a read that ended today');

-- The quiet setting at run time (a function-level SET of it needs superuser, so the imports are
-- recognised by their call stack instead: the import assertions above): while it is on, nothing is written.
select set_config('libellus.quiet', 'on', true);
insert into ids values ('hushed', (public.add_to_library(tests.snap('Quiet Book'), 'reading', current_date)).id);
select is(tests.kinds((select id from ids where name = 'hushed')), '{}'::text[], 'while libellus.quiet is on, adding a Book as Currently reading writes nothing');
select set_config('libellus.quiet', '', true);
insert into ids values ('loud', (public.add_to_library(tests.snap('Loud Book'), 'reading', current_date)).id);
select is(tests.kinds((select id from ids where name = 'loud')), array['started'], 'once it is off, the next one writes its row again');
reset role;

-- The service role, or any write without a member, writes nothing.
select set_config('request.jwt.claims', '', true);
insert into ids values ('ben_entry', (select e.id from public.library_entries e where false));
do $$
declare v_book uuid; v_entry uuid;
begin
  insert into public.books (title, authors, source, apple_id) values ('Service', array['X'], 'apple', '9988776655')
    returning id into v_book;
  insert into public.library_entries (member_id, book_id) values ((select id from ids where name = 'ben'), v_book)
    returning id into v_entry;
  update ids set id = v_entry where name = 'ben_entry';
  insert into public.reading_sessions (entry_id, started_on) values (v_entry, current_date);
end;
$$;
select is(tests.kinds((select id from ids where name = 'ben_entry')), '{}'::text[], 'a write without a member writes nothing');

-- -------------------------------------------------------------- the settle window

update private.social_config set settle_window = interval '10 minutes';
select tests.act_as((select id from ids where name = 'ada'));

insert into ids values ('e5', (public.add_to_library(tests.snap('Gilead'), 'want_to_read')).id);
select is((tests.row_of((select id from ids where name = 'e5'), 'want')).visible_at, now() + interval '10 minutes',
  'a row is visible after the settle window');
select public.start_reading((select id from ids where name = 'e5'), current_date);
select is(tests.kinds((select id from ids where name = 'e5')), array['started'], 'starting inside the window replaces want');
select public.finish_reading((select id from ids where name = 'e5'), current_date, 20, null);
select is(tests.kinds((select id from ids where name = 'e5')), array['finished'], 'finishing inside the window replaces started');
select public.update_session(tests.session_of((select id from ids where name = 'e5')), current_date, current_date, 20, 'Early words.', null);
select is(tests.kinds((select id from ids where name = 'e5')), array['finished'], 'a review before the finish is visible goes with the finish');

-- ------------------------------------------------------------ rows go with their read

select public.delete_session(tests.session_of((select id from ids where name = 'e5')));
select is(tests.kinds((select id from ids where name = 'e5')), '{}'::text[], 'deleting a read deletes its rows');
select public.remove_from_library((select id from ids where name = 'e2'));
select is(tests.kinds((select id from ids where name = 'e2')), '{}'::text[], 'removing a Book deletes its rows');

-- -------------------------------------------------------------- through sync_write

reset role;
update private.social_config set settle_window = interval '0';
select tests.act_as((select id from ids where name = 'ada'));
insert into ids values ('e6', (public.add_to_library(tests.snap('Orlando'), 'want_to_read')).id);
select public.sync_write(gen_random_uuid(), 'start_reading',
  jsonb_build_object('p_entry_id', (select id from ids where name = 'e6'), 'p_started_on', current_date - 1));
select public.sync_write(gen_random_uuid(), 'finish_reading',
  jsonb_build_object('p_entry_id', (select id from ids where name = 'e6'), 'p_ended_on', current_date - 1, 'p_rating', 12));
select ok('finished' = any(tests.kinds((select id from ids where name = 'e6'))), 'a finish that waited offline writes finished when it syncs');
select is((tests.row_of((select id from ids where name = 'e6'), 'finished')).on_day, current_date - 1, 'dated the day she finished');

-- --------------------------------------------------------------------- purging

reset role;
insert into public.activity (member_id, entry_id, kind, on_day, created_at, visible_at)
  values ((select id from ids where name = 'ada'), (select id from ids where name = 'recent'), 'want', current_date,
          now() - interval '14 months', now() - interval '14 months');
select private.purge_activity();
select is(tests.kinds((select id from ids where name = 'recent')), array['finished'], 'rows older than 13 months are purged, newer ones stay');

select * from finish();
rollback;
