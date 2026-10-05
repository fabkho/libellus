-- Undo of a read's first progress save goes back to "no progress" (issue #104):
--   supabase test db
--
-- update_progress(p_clear => true) takes the open read's progress back to none
-- (page, percent and their stamp all null), books the day as a return to 0 so a
-- day that began with none and ends there has no row, may carry the total, and
-- names no value. sync_write forwards it, so a queued Undo clears the same way.
-- Both values null without the flag stays refused.

begin;
select plan(22);

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-CLEAR', 'clear progress test', 5);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-CLEAR"}'::jsonb, now(), now(), now());
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

create or replace function tests.open_session(p_entry uuid)
returns uuid language sql security definer as $$
  select id from public.reading_sessions where entry_id = p_entry and outcome is null
$$;

-- The open read's progress as stored: "p20", "%30" or "none" (stamp included).
create or replace function tests.progress_of(p_session uuid)
returns text language sql security definer as $$
  select case
    when progress_page is not null then 'p' || progress_page
    when progress_percent is not null then '%' || progress_percent
    when progress_updated_at is null then 'none'
    else 'none but stamped' end
    from public.reading_sessions where id = p_session
$$;

create or replace function tests.day_of(p_session uuid, p_day date)
returns text language sql security definer as $$
  select coalesce(start_page::text, '%' || start_percent::text, '') || '-' || coalesce(end_page::text, '%' || end_percent::text)
    from public.reading_progress_days where session_id = p_session and day = p_day
$$;

select tests.member('ida@clear.test') as ida_id \gset
select tests.member('max@clear.test') as max_id \gset
select (now() at time zone 'utc')::date as today \gset
select ((now() at time zone 'utc')::date - 1)::date as yesterday \gset

grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

select tests.act_as(:'ida_id');
-- Begun today: the first save books a day. Emma has no page count (percent).
select (public.add_to_library('{"title":"Dune","source":"apple","apple_id":"990000104001","page_count":300}',
  'reading', :'today'::date)).id as dune \gset
select (public.add_to_library('{"title":"Emma","source":"apple","apple_id":"990000104002"}',
  'reading', :'today'::date)).id as emma \gset
-- Begun a week ago: a first value books no day, the second does.
select (public.add_to_library('{"title":"Kindred","source":"apple","apple_id":"990000104003","page_count":300}',
  'reading', current_date - 7)).id as kindred \gset
select tests.open_session(:'dune') as dune_s \gset
select tests.open_session(:'emma') as emma_s \gset
select tests.open_session(:'kindred') as kindred_s \gset

select tests.act_as(:'max_id');
select (public.add_to_library('{"title":"Dune","source":"apple","apple_id":"990000104001","page_count":300}',
  'reading', :'today'::date)).id as max_dune \gset
select tests.act_as(:'ida_id');

-- ------------------------------------------------------------- the first save

select lives_ok(
  format($$ select public.update_progress(%L, 20, null, p_day => %L) $$, :'dune', :'today'),
  'a first save');
select is(tests.progress_of(:'dune_s') || ' ' || tests.day_of(:'dune_s', :'today'), 'p20 -20',
  'sets the page and books the day');

select is(
  (select progress_page is null and progress_percent is null and progress_updated_at is null
     from public.update_progress(:'dune', p_clear => true, p_day => :'today'::date)),
  true, 'clearing returns the session with no progress');
select is(tests.progress_of(:'dune_s'), 'none', 'it is stored as none, not as page 0');
select is(tests.day_of(:'dune_s', :'today'), null, 'and the day it began is gone, as after an Undo');

select lives_ok(
  format($$ select public.update_progress(%L, p_clear => true) $$, :'dune'),
  'clearing a read that has no progress is allowed');
select is(tests.progress_of(:'dune_s'), 'none', 'and leaves it as it is');

-- A percent read, and one set again after a clear.
select lives_ok(
  format($$ select public.update_progress(%L, null, 30, p_day => %L) $$, :'emma', :'today'),
  'a percent');
select lives_ok(
  format($$ select public.update_progress(%L, p_clear => true, p_day => %L) $$, :'emma', :'today'),
  'cleared');
select is(tests.progress_of(:'emma_s'), 'none', 'a percent goes back to none too');
select lives_ok(
  format($$ select public.update_progress(%L, 40, null, p_day => %L) $$, :'dune', :'today'),
  'a value set after a clear');
select is(tests.progress_of(:'dune_s') || ' ' || tests.day_of(:'dune_s', :'today'), 'p40 -40', 'is a first value again');

-- ----------------------------------------------------------- a day with history

select public.update_progress(:'kindred', 30, null, p_day => :'yesterday'::date);
select public.update_progress(:'kindred', 55, null, p_day => :'yesterday'::date);
select public.update_progress(:'kindred', p_clear => true, p_day => :'today'::date);
select is(tests.progress_of(:'kindred_s') || ' ' || tests.day_of(:'kindred_s', :'yesterday') || ' ' || tests.day_of(:'kindred_s', :'today'),
  'none 30-55 55-0', 'earlier days stay; today is booked as a return to 0');

-- ----------------------------------------------------------------- the rules

select throws_ok(
  format($$ select public.update_progress(%L, 10, null, p_clear => true) $$, :'dune'),
  '22023', 'progress_invalid', 'a clear that names a page is refused');
select throws_ok(
  format($$ select public.update_progress(%L, null, 10, p_clear => true) $$, :'dune'),
  '22023', 'progress_invalid', 'or a percent');
select throws_ok(
  format($$ select public.update_progress(%L) $$, :'dune'),
  '22023', 'progress_invalid', 'no value without the flag is still refused');

-- With the total: an Undo of a first save that set her own total too.
select lives_ok(
  format($$ select public.update_progress(%L, p_set_page_count => true, p_page_count => 250, p_clear => true) $$, :'dune'),
  'clearing may come with the total');
select is(
  (select tests.progress_of(:'dune_s') || ' ' || page_count_override from public.library_entries where id = :'dune'),
  'none 250', 'which is set');

-- ------------------------------------------------- offline, other members, closed

select is(
  (select tests.progress_of(:'dune_s') from (select public.update_progress(:'dune', 60, null, p_day => :'today'::date)) _),
  'p60', 'set again');
select public.sync_write(gen_random_uuid(), 'update_progress',
  format('{"p_entry_id":"%s","p_clear":true,"p_day":"%s"}', :'dune', :'today')::jsonb);
select is(tests.progress_of(:'dune_s'), 'none', 'a write that waited offline clears the same way (sync_write)');

select tests.act_as(:'max_id');
select throws_ok(
  format($$ select public.update_progress(%L, p_clear => true) $$, :'dune'),
  'P0002', 'entry_not_found', 'another member''s entry is not found');

select tests.act_as(:'ida_id');
select public.finish_reading(:'dune', current_date, null, null);
select throws_ok(
  format($$ select public.update_progress(%L, p_clear => true) $$, :'dune'),
  '22023', 'not_reading', 'a finished read has no open session to clear');

select * from finish();
rollback;
