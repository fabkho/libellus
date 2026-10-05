-- Save offline, sync later (issue #93):
--   supabase test db
--
-- A write the device queued goes through `sync_write` with the id the device gave
-- it. It is applied once, through the same function as the online call: sent again
-- (an answer lost on the way back), it changes nothing and answers with the first
-- result, so a start is not refused as `already_reading` and an add is not added
-- twice. A refusal raises the function's own code and records nothing. The ids of
-- the rows a write made come back (`entry_id`, `session_id`), so the writes queued
-- behind it can name them. Members cannot read or write the record directly and
-- cannot answer from another member's write. A progress update that waited longer
-- than #68's window is booked on the window's first day. Assertions ask about the
-- rows this test made, never about how many rows a table holds.

begin;
select plan(34);

create schema if not exists tests;

-- ------------------------------------------------------------------ fixtures

insert into public.invite_codes (code, label, max_uses) values ('T-SYNC', 'sync write test', 5);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-SYNC"}'::jsonb, now(), now(), now());
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

create or replace function tests.sessions_of(p_entry uuid)
returns bigint language sql security definer as $$
  select count(*) from public.reading_sessions where entry_id = p_entry
$$;

create or replace function tests.entries_of(p_member uuid, p_apple_id text)
returns bigint language sql security definer as $$
  select count(*) from public.library_entries e join public.books b on b.id = e.book_id
   where e.member_id = p_member and b.apple_id = p_apple_id
$$;

create or replace function tests.recorded(p_request uuid)
returns bigint language sql security definer as $$
  select count(*) from public.synced_writes where request_id = p_request
$$;

select tests.member('ida@sync.test') as ida_id \gset
select tests.member('max@sync.test') as max_id \gset
select ((now() at time zone 'utc')::date - 1)::date as yesterday \gset
select ((now() at time zone 'utc')::date - 5)::date as five_days_ago \gset

grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

select gen_random_uuid() as add_req \gset
select gen_random_uuid() as start_req \gset
select gen_random_uuid() as progress_req \gset
select gen_random_uuid() as finish_req \gset
select gen_random_uuid() as refused_req \gset
select gen_random_uuid() as late_req \gset
select gen_random_uuid() as coll_req \gset
select gen_random_uuid() as bad_req \gset

select tests.act_as(:'ida_id');

-- Kindred is in her Library already (made online).
select (public.add_to_library('{"title":"Kindred","source":"apple","apple_id":"990000093001","page_count":300}')).id as kindred \gset

-- ------------------------------------------------------------------ add, twice

select is(
  (public.sync_write(:'add_req', 'add_to_library',
     '{"p_book":{"title":"Dune","source":"apple","apple_id":"990000093002","page_count":600},"p_status":"want_to_read"}') ->> 'replayed')::boolean,
  false, 'a queued add is applied');
select (public.sync_write(:'add_req', 'add_to_library',
  '{"p_book":{"title":"Dune","source":"apple","apple_id":"990000093002","page_count":600},"p_status":"want_to_read"}') ->> 'entry_id') as dune \gset
select is(tests.entries_of(:'ida_id', '990000093002'), 1::bigint, 'sent again, it adds nothing (no already_in_library either)');
select is((select id from public.library_entries where member_id = :'ida_id' and id = :'dune'), :'dune'::uuid,
  'and answers with the entry the first send made');
select ok(public.sync_write(:'add_req', 'add_to_library', '{}') ? 'entry_id',
  'a replay answers from the record, whatever it carries');
select ok(not (public.sync_write(:'add_req', 'add_to_library', '{}') ? 'session_id'),
  'an add on Want to read made no read to name');

-- ---------------------------------------------------------------- start, twice

select is(
  (public.sync_write(:'start_req', 'start_reading', format('{"p_entry_id":"%s","p_started_on":"%s"}', :'dune', :'yesterday')::jsonb) ->> 'replayed')::boolean,
  false, 'a queued start is applied');
select is((select status from public.library_entries where id = :'dune'), 'reading'::public.entry_status, 'Dune is Currently reading');
select is(
  (public.sync_write(:'start_req', 'start_reading', format('{"p_entry_id":"%s","p_started_on":"%s"}', :'dune', :'yesterday')::jsonb) ->> 'replayed')::boolean,
  true, 'sent again, it is a replay, not already_reading');
select is(tests.sessions_of(:'dune'), 1::bigint, 'and starts no second read');
select is(
  public.sync_write(:'start_req', 'start_reading', '{}') ->> 'session_id',
  (select id::text from public.reading_sessions where entry_id = :'dune'),
  'it names the read it started');

-- --------------------------------------------------------- progress and finish

select lives_ok(
  format($$ select public.sync_write(%L, 'update_progress', '{"p_entry_id":"%s","p_page":120,"p_day":"%s"}') $$,
    :'progress_req', :'dune', :'yesterday'),
  'a queued progress update');
select is((select progress_page from public.reading_sessions where entry_id = :'dune'), 120, 'is saved');
select lives_ok(
  format($$ select public.sync_write(%L, 'update_progress', '{"p_entry_id":"%s","p_page":120,"p_day":"%s"}') $$,
    :'progress_req', :'dune', :'yesterday'),
  'sent again');
select is((select count(*) from public.reading_progress_days d join public.reading_sessions s on s.id = d.session_id
            where s.entry_id = :'dune'), 1::bigint, 'books its day once');

select lives_ok(
  format($$ select public.sync_write(%L, 'finish_reading', '{"p_entry_id":"%s","p_ended_on":"%s","p_rating":18,"p_review":"Spice."}') $$,
    :'finish_req', :'dune', :'yesterday'),
  'a queued finish');
select lives_ok(
  format($$ select public.sync_write(%L, 'finish_reading', '{"p_entry_id":"%s","p_ended_on":"%s"}') $$,
    :'finish_req', :'dune', :'yesterday'),
  'sent again, it is no not_reading');
select is((select rating from public.reading_sessions where entry_id = :'dune')::integer, 18, 'the finish kept its Rating');
select is((select status from public.library_entries where id = :'dune'), 'finished'::public.entry_status, 'Dune is Finished');

-- --------------------------------------------------------------------- refusal

select throws_ok(
  format($$ select public.sync_write(%L, 'finish_reading', '{"p_entry_id":"%s","p_ended_on":"%s"}') $$,
    :'refused_req', :'kindred', :'yesterday'),
  'not_reading', 'a refused write raises the function''s own code');
select is(tests.recorded(:'refused_req'), 0::bigint, 'and records nothing');
select throws_ok(
  format($$ select public.sync_write(%L, 'finish_reading', '{"p_entry_id":"%s","p_ended_on":"%s"}') $$,
    :'refused_req', :'kindred', :'yesterday'),
  'not_reading', 'sent again it is refused again');
select throws_ok(
  format($$ select public.sync_write(%L, 'change_edition', '{"p_entry_id":"%s"}') $$, :'bad_req', :'kindred'),
  'action_invalid', 'an online-only write is not callable here');
select throws_ok(
  format($$ select public.sync_write(null, 'remove_from_library', '{"p_entry_id":"%s"}') $$, :'kindred'),
  'request_invalid', 'a write without an id is refused');

-- ------------------------------------------------- a progress update that waited

select lives_ok(
  format($$ select public.sync_write(%L, 'start_reading', '{"p_entry_id":"%s","p_started_on":"%s"}') $$,
    gen_random_uuid(), :'kindred', :'five_days_ago'),
  'Kindred started five days ago');
select lives_ok(
  format($$ select public.sync_write(%L, 'update_progress', '{"p_entry_id":"%s","p_page":40}') $$,
    gen_random_uuid(), :'kindred'),
  'its first value');
select throws_ok(
  format($$ select public.update_progress(%L, 60, null, p_day => %L) $$, :'kindred', :'five_days_ago'),
  'date_invalid', 'online, a day five days back is refused (#68)');
select lives_ok(
  format($$ select public.sync_write(%L, 'update_progress', '{"p_entry_id":"%s","p_page":60,"p_day":"%s"}') $$,
    :'late_req', :'kindred', :'five_days_ago'),
  'queued five days ago, it syncs');
select is(
  (select end_page from public.reading_progress_days d join public.reading_sessions s on s.id = d.session_id
    where s.entry_id = :'kindred' and d.day = :'yesterday'::date),
  60, 'booked on the window''s first day, its value kept');

-- ---------------------------------------------------------------- collections

select (public.create_collection('Sea')).id as sea \gset
select lives_ok(
  format($$ select public.sync_write(%L, 'add_to_collection', '{"p_collection":"%s","p_book":{"title":"Kindred","source":"apple","apple_id":"990000093001"}}') $$,
    :'coll_req', :'sea', :'kindred'),
  'a queued add to a Collection');
select is(public.sync_write(:'coll_req', 'add_to_collection', '{}') ->> 'entry_id', :'kindred',
  'names the entry it put there');
select lives_ok(
  format($$ select public.sync_write(%L, 'reorder_collection', '{"p_collection":"%s","p_entries":["%s"]}') $$,
    gen_random_uuid(), :'sea', :'kindred'),
  'a queued reorder takes its entries as a list');

-- ------------------------------------------------------------- whose record

select throws_ok($$ select * from public.synced_writes $$, '42501', NULL, 'members cannot read the record');

select tests.act_as(:'max_id');
select throws_ok(
  format($$ select public.sync_write(%L, 'add_to_library', '{}') $$, :'add_req'),
  'request_invalid', 'nor answer from another member''s write');
select throws_ok(
  format($$ select public.sync_write(%L, 'remove_from_library', '{"p_entry_id":"%s"}') $$, gen_random_uuid(), :'kindred'),
  'entry_not_found', 'and the functions'' own rules hold: not his entry');

select * from finish();
rollback;
