-- Progress on an earlier day (docs/plans/backdated-progress.md, rules R1-R12, chain tests E1-E15):
--   supabase test db
--
-- set_progress_day(entry, day, page | percent) records where the member ended an earlier day of her
-- open read, delete_progress_day(entry, day) removes one. One row per day; a value is clamped
-- between the day's start and the next day's end; the next day is re-chained (and goes when it then
-- reads nothing); the read's value moves only when the days lead it and the day is the latest, and
-- only then is reading_sessions written (so a buddy read's Section is refreshed exactly then).
-- Queued offline through sync_write, the explicit day is kept. Everything through the real
-- functions as the member; the chain of each case is seeded directly (a test helper), then the
-- whole chain is compared, and the chain invariant (each day starts where the one before ended, no
-- day reads a negative amount) is checked after it. Assertions ask about the rows this test made.

begin;
select plan(208);

create schema if not exists tests;

-- ------------------------------------------------------------------ fixtures

insert into public.invite_codes (code, label, max_uses) values ('T-DAYEDIT', 'progress day edit test', 50);

create or replace function tests.member(p_email text, p_name text default null)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, jsonb_strip_nulls(jsonb_build_object('invite_code', 'T-DAYEDIT', 'name', p_name)), now(), now(), now());
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

create or replace function tests.today()
returns date language sql stable as $$ select (now() at time zone 'utc')::date $$;

-- A stored value: "212", "%35", "" (none).
create or replace function tests.v(p_page integer, p_percent integer)
returns text language sql immutable as $$
  select coalesce(p_page::text, '%' || p_percent::text, '')
$$;

-- A read's days as "ago:start-end", oldest first: "11:-30 10:30-58 3:170-%36".
create or replace function tests.days(p_session uuid)
returns text language sql security definer as $$
  select coalesce(string_agg((tests.today() - day)::text || ':' || tests.v(start_page, start_percent) || '-'
                             || tests.v(end_page, end_percent), ' ' order by day), '')
    from public.reading_progress_days where session_id = p_session
$$;

-- The read's value: "212", "%35", "" (none).
create or replace function tests.p(p_session uuid)
returns text language sql security definer as $$
  select tests.v(progress_page, progress_percent) from public.reading_sessions where id = p_session
$$;

create or replace function tests.stamp(p_session uuid)
returns timestamptz language sql security definer as $$
  select progress_updated_at from public.reading_sessions where id = p_session
$$;

-- The physical versions of the read's row and of its days: any write (even one that changes no
-- value) gives a row a new ctid, so "unchanged" means nothing was written.
create or replace function tests.session_version(p_session uuid)
returns text language sql security definer as $$
  select ctid::text from public.reading_sessions where id = p_session
$$;
create or replace function tests.days_version(p_session uuid)
returns text language sql security definer as $$
  select coalesce(string_agg(day::text || '@' || ctid::text, ',' order by day), '')
    from public.reading_progress_days where session_id = p_session
$$;

-- A day's start / end, in a unit, through the read's page count (the client's valueIn).
create or replace function tests.start_in(p_session uuid, p_ago integer, p_unit text)
returns integer language sql security definer as $$
  select private.progress_value_in(d.start_page, d.start_percent, p_unit, coalesce(e.page_count_override, b.page_count))
    from public.reading_progress_days d
    join public.reading_sessions s on s.id = d.session_id
    join public.library_entries e on e.id = s.entry_id
    join public.books b on b.id = e.book_id
   where d.session_id = p_session and d.day = tests.today() - p_ago
$$;
create or replace function tests.end_in(p_session uuid, p_ago integer, p_unit text)
returns integer language sql security definer as $$
  select private.progress_value_in(d.end_page, d.end_percent, p_unit, coalesce(e.page_count_override, b.page_count))
    from public.reading_progress_days d
    join public.reading_sessions s on s.id = d.session_id
    join public.library_entries e on e.id = s.entry_id
    join public.books b on b.id = e.book_id
   where d.session_id = p_session and d.day = tests.today() - p_ago
$$;
-- Do the days lead the read's value: the latest day's end equals it in pages AND in percent.
create or replace function tests.leads(p_session uuid)
returns boolean language sql security definer as $$
  with x as (
    select s.progress_page, s.progress_percent, coalesce(e.page_count_override, b.page_count) as n,
           (select d from public.reading_progress_days d where d.session_id = s.id order by d.day desc limit 1) as l
      from public.reading_sessions s
      join public.library_entries e on e.id = s.entry_id
      join public.books b on b.id = e.book_id
     where s.id = p_session
  )
  select bool_and(private.progress_value_in(progress_page, progress_percent, u, n)
                  = private.progress_value_in((l).end_page, (l).end_percent, u, n))
    from x, unnest(array['page', 'percent']) u
$$;
-- Every buddy member row's version (any write gives a row a new ctid).
create or replace function tests.buddy_rows_version()
returns text language sql security definer as $$
  select coalesce(string_agg(buddy_read_id || ':' || member_id || '@' || ctid::text, ',' order by buddy_read_id, member_id), '')
    from public.buddy_read_members
$$;

-- The chain invariant, in the read's unit (pages with a page count, else percent), conversions as
-- the client's valueIn: each day starts where the one before ended, and no day reads less than 0.
create or replace function tests.chain_ok(p_session uuid)
returns boolean language sql security definer as $$
  with c as (
    select coalesce(e.page_count_override, b.page_count) as n
      from public.reading_sessions s
      join public.library_entries e on e.id = s.entry_id
      join public.books b on b.id = e.book_id
     where s.id = p_session
  ), r as (
    select d.day,
           private.progress_value_in(d.start_page, d.start_percent, case when c.n > 0 then 'page' else 'percent' end, c.n) as st,
           private.progress_value_in(d.end_page, d.end_percent, case when c.n > 0 then 'page' else 'percent' end, c.n) as en
      from public.reading_progress_days d, c
     where d.session_id = p_session
  ), w as (
    select st, en, lag(en) over (order by day) as prev_en, row_number() over (order by day) as k from r
  )
  select coalesce(bool_and(en >= st and (k = 1 or st = prev_en)), true) from w
$$;

-- Seeds a read's days and value directly (the chain each case starts from): rows "ago:start-end"
-- as tests.days prints them, the value as "212", "%35" or "" (none), stamped at a fixed moment.
create or replace function tests.seed(p_session uuid, p_rows text, p_value text)
returns void language plpgsql security definer as $$
declare
  v_tok text;
  v_s   text;
  v_e   text;
begin
  delete from public.reading_progress_days where session_id = p_session;
  if p_rows <> '' then
    foreach v_tok in array string_to_array(p_rows, ' ') loop
      v_s := split_part(split_part(v_tok, ':', 2), '-', 1);
      v_e := split_part(split_part(v_tok, ':', 2), '-', 2);
      insert into public.reading_progress_days (session_id, day, start_page, start_percent, end_page, end_percent)
      values (p_session, tests.today() - split_part(v_tok, ':', 1)::integer,
              case when v_s <> '' and v_s not like '\%%' then v_s::integer end,
              case when v_s like '\%%' then substr(v_s, 2)::integer end,
              case when v_e not like '\%%' then v_e::integer end,
              case when v_e like '\%%' then substr(v_e, 2)::integer end);
    end loop;
  end if;
  update public.reading_sessions
     set progress_page = case when p_value <> '' and p_value not like '\%%' then p_value::integer end,
         progress_percent = case when p_value like '\%%' then substr(p_value, 2)::integer end,
         progress_updated_at = case when p_value <> '' then '2026-01-01 00:00+00'::timestamptz end
   where id = p_session;
end;
$$;

-- The member's calls (as the member: these run with her role and her execute grant).
create or replace function tests.set(p_entry uuid, p_ago integer, p_page integer, p_percent integer default null)
returns text language plpgsql as $$
begin
  perform public.set_progress_day(p_entry, tests.today() - p_ago, p_page, p_percent);
  return tests.days(tests.open_session(p_entry));
end;
$$;
create or replace function tests.del(p_entry uuid, p_ago integer)
returns text language plpgsql as $$
begin
  perform public.delete_progress_day(p_entry, tests.today() - p_ago);
  return tests.days(tests.open_session(p_entry));
end;
$$;

-- Buddy reads: n parts "Section k" ending at k/n, then the whole book.
create or replace function tests.secs(p_n integer)
returns jsonb language sql as $$
  select jsonb_agg(x order by o)
    from (select k as o, jsonb_build_object('kind', 'part', 'label', 'Section ' || k,
                                            'to_fraction', round(k::numeric / p_n, 4)) as x
            from generate_series(1, p_n) k
          union all
          select p_n + 1, jsonb_build_object('kind', 'end', 'label', 'The whole book', 'to_fraction', 1)) s
$$;
create or replace function tests.auto(p_read uuid, p_member uuid)
returns integer language sql security definer as $$
  select auto_through from public.buddy_read_members where buddy_read_id = p_read and member_id = p_member
$$;
create or replace function tests.set_auto(p_read uuid, p_member uuid, p_auto integer)
returns void language sql security definer as $$
  update public.buddy_read_members set auto_through = p_auto where buddy_read_id = p_read and member_id = p_member
$$;
create or replace function tests.member_version(p_read uuid, p_member uuid)
returns text language sql security definer as $$
  select ctid::text from public.buddy_read_members where buddy_read_id = p_read and member_id = p_member
$$;

select tests.member('ida@dayedit.test') as ida \gset
select tests.member('max@dayedit.test') as max \gset
select tests.today() as today \gset

grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

-- Ida reads Dune (480 pages, begun 12 days ago); Emma (no page count, begun 6 days ago);
-- Kindred (300 pages, begun 8 days ago) for the never-tracked and import cases.
select tests.act_as(:'ida');
select (public.add_to_library('{"title":"Dune","source":"apple","apple_id":"990000478001","page_count":480}',
  'reading', :'today'::date - 12)).id as dune \gset
select (public.add_to_library('{"title":"Emma","source":"apple","apple_id":"990000478002"}',
  'reading', :'today'::date - 6)).id as emma \gset
select (public.add_to_library('{"title":"Kindred","source":"apple","apple_id":"990000478003","page_count":300}',
  'reading', :'today'::date - 8)).id as kindred \gset
select (public.add_to_library('{"title":"Beloved","source":"apple","apple_id":"990000478004","page_count":300}',
  'want_to_read')).id as beloved \gset
reset role;
select tests.open_session(:'dune') as dune_s \gset
select tests.open_session(:'emma') as emma_s \gset
select tests.open_session(:'kindred') as kin_s \gset

-- The plan's chain (today = day 0, 480 pages): its days and P = 212.
\set chain '11:-30 10:30-58 8:58-96 7:96-120 5:120-151 4:151-170 2:170-188 1:188-212'

-- ------------------------------------------------------------------ who may

select tests.seed(:'dune_s', :'chain', '212');
select set_config('request.jwt.claims', '', true);
select throws_ok(
  format($$ select public.set_progress_day(%L, %L, 178) $$, :'dune', :'today'::date - 3),
  '42501', 'not_signed_in', 'not signed in: refused');
select throws_ok(
  format($$ select public.delete_progress_day(%L, %L) $$, :'dune', :'today'::date - 2),
  '42501', 'not_signed_in', 'a remove too');

select tests.act_as(:'max');
select throws_ok(
  format($$ select public.set_progress_day(%L, %L, 178) $$, :'dune', :'today'::date - 3),
  'P0002', 'entry_not_found', 'another member''s entry is not found');
select throws_ok(
  format($$ select public.delete_progress_day(%L, %L) $$, :'dune', :'today'::date - 2),
  'P0002', 'entry_not_found', 'nor for a remove');
select throws_ok(
  format($$ select public.set_progress_day(%L, %L, 1) $$, gen_random_uuid(), :'today'::date - 1),
  'P0002', 'entry_not_found', 'an entry that does not exist');
reset role;
select is(tests.days(:'dune_s'), :'chain', 'her days are untouched by the refused calls');

select tests.act_as(:'ida');
select throws_ok(
  format($$ select public.set_progress_day(%L, %L, 10) $$, :'beloved', :'today'::date - 1),
  '22023', 'not_reading', 'a Book she is not reading has no days to set');
select throws_ok(
  format($$ select public.delete_progress_day(%L, %L) $$, :'beloved', :'today'::date - 1),
  '22023', 'not_reading', 'nor to remove');
reset role;

select is(
  (select array_agg(privilege_type::text order by privilege_type::text)
     from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'reading_progress_days' and grantee = 'authenticated'),
  array['SELECT'], 'members still only read their days: the table grants are unchanged');
select ok(not has_function_privilege('anon', 'public.set_progress_day(uuid, date, integer, integer)', 'execute')
          and not has_function_privilege('anon', 'public.delete_progress_day(uuid, date)', 'execute'),
  'anon cannot call either');
select ok(has_function_privilege('authenticated', 'public.set_progress_day(uuid, date, integer, integer)', 'execute')
          and has_function_privilege('authenticated', 'public.delete_progress_day(uuid, date)', 'execute'),
  'a signed-in member can');
select ok(not has_function_privilege('authenticated', 'private.progress_day_write(public.reading_sessions, integer, date, integer, integer, boolean)', 'execute')
          and not has_function_privilege('authenticated', 'private.progress_value_in(integer, integer, text, integer)', 'execute'),
  'the private helpers are not callable by members');
select is(
  (select array_agg(p.proname::text || ':' || p.prosecdef || ':' || coalesce(array_to_string(p.proconfig, ','), '') order by p.proname)
     from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('set_progress_day', 'delete_progress_day')),
  array['delete_progress_day:true:search_path=pg_catalog, public', 'set_progress_day:true:search_path=pg_catalog, public'],
  'both are security definer with a pinned search_path');
select tests.act_as(:'ida');

-- ------------------------------------------------------------------ input (R8)

select throws_ok(
  format($$ select public.set_progress_day(%L, %L, 178, 40) $$, :'dune', :'today'::date - 3),
  '22023', 'progress_invalid', 'a page and a percent: refused');
select throws_ok(
  format($$ select public.set_progress_day(%L, %L) $$, :'dune', :'today'::date - 3),
  '22023', 'progress_invalid', 'neither: refused');
select throws_ok(
  format($$ select public.set_progress_day(%L, %L, 481) $$, :'dune', :'today'::date - 3),
  '22023', 'progress_invalid', 'a page past the page count: refused');
select throws_ok(
  format($$ select public.set_progress_day(%L, %L, -1) $$, :'dune', :'today'::date - 3),
  '22023', 'progress_invalid', 'a negative page: refused');
select throws_ok(
  format($$ select public.set_progress_day(%L, %L, null, 101) $$, :'dune', :'today'::date - 3),
  '22023', 'progress_invalid', 'percent 101: refused');
select throws_ok(
  format($$ select public.set_progress_day(%L, %L, 10) $$, :'emma', :'today'::date - 3),
  '22023', 'progress_invalid', 'N1: a page on a read with no page count: refused (it counts in percent)');
select lives_ok(
  format($$ select public.set_progress_day(%L, %L, null, 10) $$, :'emma', :'today'::date - 3),
  'N1: a percent on it is taken');
select tests.seed(:'emma_s', '', '');

-- ------------------------------------------------------------------ days (R7)

select throws_ok(
  format($$ select public.set_progress_day(%L, null, 178) $$, :'dune'),
  '22023', 'date_invalid', 'no day: refused');
select throws_ok(
  format($$ select public.delete_progress_day(%L, null) $$, :'dune'),
  '22023', 'date_invalid', 'no day to remove: refused');
select throws_ok(
  format($$ select public.set_progress_day(%L, %L, 230) $$, :'dune', :'today'::date + 2),
  '22023', 'date_invalid', 'UTC today + 2 is a day no time zone has: refused');
select throws_ok(
  format($$ select tests.set(%L, 13, 20) $$, :'dune'),
  '22023', 'date_invalid', 'E9: a day before the read began: refused');
select is(tests.days(:'dune_s'), :'chain', 'refused input and days change nothing');
select is(tests.set(:'dune', 12, 20), '12:-20 11:20-30 10:30-58 8:58-96 7:96-120 5:120-151 4:151-170 2:170-188 1:188-212',
  'the day the read began is allowed: a first day before the first row starts at the base (none) and the first row then starts at it');
select ok(tests.chain_ok(:'dune_s'), '(chain whole)');
select tests.seed(:'dune_s', :'chain', '212');
select is(tests.set(:'dune', -1, 230), :'chain' || ' -1:212-230',
  'UTC today + 1 is allowed (a time zone ahead): a day after the latest, starting at its end');
select is(tests.p(:'dune_s'), '230', 'and as the latest day with the days leading, it moves the read''s value');

-- A row already before the read's start (the start date was edited later) stays editable and removable.
select tests.seed(:'dune_s', :'chain', '212');
select public.update_session(:'dune_s', :'today'::date - 6, null);
select is(tests.set(:'dune', 8, 90), '11:-30 10:30-58 8:58-90 7:90-120 5:120-151 4:151-170 2:170-188 1:188-212',
  'a row before the (later) start date can be edited');
select is(tests.del(:'dune', 10), '11:-30 8:30-90 7:90-120 5:120-151 4:151-170 2:170-188 1:188-212',
  'and removed');
select throws_ok(
  format($$ select tests.set(%L, 9, 60) $$, :'dune'),
  '22023', 'date_invalid', 'but no new day before it');
select public.update_session(:'dune_s', :'today'::date - 12, null);

-- ------------------------------------------------------------------ the plan's chain, E1-E8

select tests.seed(:'dune_s', :'chain', '212');
select is(tests.set(:'dune', 3, 178), '11:-30 10:30-58 8:58-96 7:96-120 5:120-151 4:151-170 3:170-178 2:178-188 1:188-212',
  'E1: a new day 3 ago at 178 starts at 170; the next day then starts at 178 (+10, not +18)');
select ok(tests.chain_ok(:'dune_s'), '(chain whole)');
select is(tests.p(:'dune_s'), '212', 'E1: a day in the middle leaves the read''s value');

select tests.seed(:'dune_s', :'chain', '212');
select is(tests.set(:'dune', 2, 175), '11:-30 10:30-58 8:58-96 7:96-120 5:120-151 4:151-170 2:170-175 1:175-212',
  'E2: editing 2 ago to 175 moves its end and the next day''s start');
select ok(tests.chain_ok(:'dune_s'), '(chain whole)');

select tests.seed(:'dune_s', :'chain', '212');
select tests.session_version(:'dune_s') as v0 \gset
select is(tests.set(:'dune', 2, 212), '11:-30 10:30-58 8:58-96 7:96-120 5:120-151 4:151-170 2:170-212',
  'E3: 2 ago up to the next day''s end: the next day reads nothing and goes');
select ok(tests.chain_ok(:'dune_s'), '(chain whole)');
select is(tests.p(:'dune_s'), '212', 'E3: 2 ago is now the latest and ends at the read''s value');
select is(tests.session_version(:'dune_s'), :'v0', 'E3: the value did not change, so the read was not written');

select tests.seed(:'dune_s', :'chain', '212');
select is(tests.del(:'dune', 2), '11:-30 10:30-58 8:58-96 7:96-120 5:120-151 4:151-170 1:170-212',
  'E4: removing 2 ago: the next day absorbs its pages (+42)');
select ok(tests.chain_ok(:'dune_s'), '(chain whole)');
select is(tests.p(:'dune_s'), '212', 'E4: the value stays');

select tests.seed(:'dune_s', :'chain', '212');
select is(tests.del(:'dune', 1), '11:-30 10:30-58 8:58-96 7:96-120 5:120-151 4:151-170 2:170-188',
  'E5: removing the latest day');
select is(tests.p(:'dune_s'), '188', 'E5: takes the read''s value back to where that day started');
select is(tests.stamp(:'dune_s'), '2026-01-01 00:00+00'::timestamptz, 'E5: progress_updated_at is not moved');

select tests.seed(:'dune_s', :'chain', '212');
select is(tests.set(:'dune', 1, 220), '11:-30 10:30-58 8:58-96 7:96-120 5:120-151 4:151-170 2:170-188 1:188-220',
  'E6: editing the latest day to 220');
select is(tests.p(:'dune_s'), '220', 'E6: the days lead, so the read follows it');
select is(tests.stamp(:'dune_s'), '2026-01-01 00:00+00'::timestamptz, 'E6: and progress_updated_at still is not moved');

select tests.seed(:'dune_s', :'chain', '212');
select is(tests.set(:'dune', 1, 150), '11:-30 10:30-58 8:58-96 7:96-120 5:120-151 4:151-170 2:170-188',
  'the latest day set below its start is clamped to the start: the day has no row');
select is(tests.p(:'dune_s'), '188', 'and the read goes back to that start, as a remove');

select tests.seed(:'dune_s', :'chain', '212');
select is(tests.set(:'dune', 9, 70), '11:-30 10:30-58 9:58-70 8:70-96 7:96-120 5:120-151 4:151-170 2:170-188 1:188-212',
  'E7: a new day 9 ago at 70 (between 58 and 96)');
select ok(tests.chain_ok(:'dune_s'), '(chain whole)');

select tests.seed(:'dune_s', :'chain', '212');
select tests.days_version(:'dune_s') as dv0 \gset
select is(tests.set(:'dune', 3, 100), :'chain',
  'E8: a new day below the day before''s end is clamped to it (170): it reads nothing, so no row');
select is(tests.days_version(:'dune_s'), :'dv0', 'E8: and no day is written');
select tests.seed(:'dune_s', :'chain', '212');
select is(tests.set(:'dune', 3, 300), '11:-30 10:30-58 8:58-96 7:96-120 5:120-151 4:151-170 3:170-188 1:188-212',
  'a new day above the next day''s end is clamped to it (188): the next day then reads nothing and goes');
select ok(tests.chain_ok(:'dune_s'), '(chain whole)');
select tests.seed(:'dune_s', :'chain', '212');
select is(tests.set(:'dune', 7, 200), '11:-30 10:30-58 8:58-96 7:96-151 4:151-170 2:170-188 1:188-212',
  'an edit above the next day''s end is clamped to it: the next day goes');
select ok(tests.chain_ok(:'dune_s'), '(chain whole)');
select tests.seed(:'dune_s', :'chain', '212');
select is(tests.set(:'dune', 7, 10), '11:-30 10:30-58 8:58-96 5:96-151 4:151-170 2:170-188 1:188-212',
  'an edit below the day''s start is clamped to it: the day goes, the next day absorbs it');
select ok(tests.chain_ok(:'dune_s'), '(chain whole)');

-- Several edits in a row, each re-chaining one neighbour: the chain stays whole throughout.
select tests.seed(:'dune_s', :'chain', '212');
select tests.set(:'dune', 3, 178);
select tests.set(:'dune', 6, 130);
select tests.set(:'dune', 4, 165);
select tests.del(:'dune', 8);
select tests.set(:'dune', 0, 240);
select is(tests.days(:'dune_s'), '11:-30 10:30-58 7:58-120 6:120-130 5:130-151 4:151-165 3:165-178 2:178-188 1:188-212 0:212-240',
  'five edits across the read (adds, an edit, a remove, today) re-chain one neighbour each');
select ok(tests.chain_ok(:'dune_s'), 'and the chain is whole: every day starts at the end of the one before, none reads less than 0');
select is(tests.p(:'dune_s'), '240', 'the last of them (today, the latest) moved the read');
select is((select sum(coalesce(end_page, 0) - coalesce(start_page, 0))::int
             from public.reading_progress_days where session_id = :'dune_s'), 240,
  'the days add up to the latest end minus the base');

-- ------------------------------------------------------------------ R5: who leads

-- E10: the read is ahead of its days (P = 230, the latest day ends at 212).
select tests.seed(:'dune_s', :'chain', '230');
select tests.session_version(:'dune_s') as v0 \gset
select is(tests.set(:'dune', 0, 260), :'chain' || ' 0:212-230',
  'E10: a day after the latest is bounded by the read''s value (230), not the page count');
select is(tests.p(:'dune_s'), '230', 'E10: the value is untouched');
select is(tests.session_version(:'dune_s'), :'v0', 'E10: and the read is not written');
select tests.seed(:'dune_s', :'chain', '230');
select is(tests.set(:'dune', 1, 225), '11:-30 10:30-58 8:58-96 7:96-120 5:120-151 4:151-170 2:170-188 1:188-225',
  'editing the latest day while the read is ahead: bounded by the value');
select is(tests.p(:'dune_s'), '230', 'and the value stays: the days do not lead it');

-- The read is behind its days (a lower page count clamped it: P 200 < E_L 212).
select tests.seed(:'dune_s', :'chain', '212');
select tests.act_as(:'ida');
select public.update_progress(:'dune', null, null, true, 200);
reset role;
select is(tests.p(:'dune_s'), '200', '(a page count of 200 clamps the read''s value, the days stay)');
select is(tests.days(:'dune_s'), :'chain', '(days above the page count stay)');
select throws_ok(
  format($$ select tests.set(%L, 1, 205) $$, :'dune'),
  '22023', 'progress_invalid', 'a page past the new page count is refused');
select is(tests.set(:'dune', 1, 195), '11:-30 10:30-58 8:58-96 7:96-120 5:120-151 4:151-170 2:170-188 1:188-195',
  'the latest day can come down under it');
select is(tests.p(:'dune_s'), '200', 'the value stays: the days did not lead it');
select is(tests.set(:'dune', 0, 200), '11:-30 10:30-58 8:58-96 7:96-120 5:120-151 4:151-170 2:170-188 1:188-195 0:195-200',
  'a day after it, up to the value');
select is(tests.set(:'dune', 1, 197), '11:-30 10:30-58 8:58-96 7:96-120 5:120-151 4:151-170 2:170-188 1:188-197 0:197-200',
  'now the days lead again; a middle day re-chains as usual');
select is(tests.set(:'dune', 0, 199), '11:-30 10:30-58 8:58-96 7:96-120 5:120-151 4:151-170 2:170-188 1:188-197 0:197-199',
  'and the latest day moves the read');
select is(tests.p(:'dune_s'), '199', '(to 199)');
-- The same flow in percent: a page count changed, then set_progress_day against the clamped value.
select tests.seed(:'dune_s', :'chain', '212');
select tests.act_as(:'ida');
select public.update_progress(:'dune', null, null, true, 200);
reset role;
select is(tests.p(:'dune_s'), '200', '(percent flow: the page count of 200 clamps the read to 200; days end at 212 = 106 %)');
select is(tests.set(:'dune', 1, null, 97), '11:-30 10:30-58 8:58-96 7:96-120 5:120-151 4:151-170 2:170-188 1:188-%97',
  'the latest day brought under the page count in percent (97 % of 200)');
select is(tests.p(:'dune_s'), '200', 'the read stays: the days did not lead it');
select is(tests.set(:'dune', 0, null, 100), '11:-30 10:30-58 8:58-96 7:96-120 5:120-151 4:151-170 2:170-188 1:188-%97 0:%97-200',
  'a day after it set to 100 %: bounded by the read (200 = 100 %), it ends on the read''s stored value');
select ok(tests.leads(:'dune_s'), 'so the days lead the read again, in pages and in percent');
select ok(tests.chain_ok(:'dune_s'), '(chain whole)');
select tests.days_version(:'dune_s') as dv_pc \gset
select is(tests.set(:'dune', 0, 200), '11:-30 10:30-58 8:58-96 7:96-120 5:120-151 4:151-170 2:170-188 1:188-%97 0:%97-200',
  'page 200 on it then is the end it has');
select is(tests.days_version(:'dune_s'), :'dv_pc', 'and writes nothing');
select tests.act_as(:'ida');
select public.update_progress(:'dune', null, null, true, 480);
reset role;

-- E11: a read with no days and no value.
select tests.seed(:'kin_s', '', '');
select is(tests.set(:'kindred', 5, 40), '5:-40', 'E11: a first day from nothing');
select is(tests.p(:'kin_s'), '40', 'E11: the days lead, so it is the read''s value');
select ok(tests.stamp(:'kin_s') is not null, 'E11: stamped, as a value must be');
select tests.days_version(:'kin_s') || tests.session_version(:'kin_s') as kv0 \gset
select is(tests.set(:'kindred', 5, 40), '5:-40', 'E14: the same write again');
select is(tests.days_version(:'kin_s') || tests.session_version(:'kin_s'), :'kv0', 'E14: writes neither the day nor the read');
select is(tests.del(:'kindred', 5), '', 'R6: removing the only day of a never-tracked read');
select is(tests.p(:'kin_s'), '', 'takes the read back to no value');
select ok(tests.stamp(:'kin_s') is null, 'and its stamp with it');

-- E12: an import: a value, no days.
select tests.seed(:'kin_s', '', '212');
select tests.session_version(:'kin_s') as v0 \gset
select is(tests.set(:'kindred', 2, 200), '2:-200', 'E12: an imported read takes a first day from nothing');
select is(tests.p(:'kin_s'), '212', 'E12: and keeps its value (the days do not lead it)');
select is(tests.session_version(:'kin_s'), :'v0', 'E12: the read is not written');
select is(tests.set(:'kindred', 2, 250), '2:-212', 'R11: bounded by the value');
select is(tests.set(:'kindred', 1, 230), '2:-212 1:212-230',
  'once the days reach the value they lead: a day after them can go past it (up to the page count)');
select is(tests.p(:'kin_s'), '230', 'and moves the read');
select is(tests.del(:'kindred', 1), '2:-212', 'removing that latest day');
select is(tests.p(:'kin_s'), '212', 'brings the read back to where it started');
select is(tests.del(:'kindred', 2), '', 'removing the first day too');
select is(tests.p(:'kin_s'), '', 'which started from nothing: the read has no value again');

-- ------------------------------------------------------------------ units (R8), E13

-- Pages, a percent day: 170 of 480 is 35 %, 188 is 39 %.
select tests.seed(:'dune_s', :'chain', '212');
select is(tests.set(:'dune', 3, null, 36), '11:-30 10:30-58 8:58-96 7:96-120 5:120-151 4:151-170 3:170-%36 2:%36-188 1:188-212',
  'E13: a percent day between page days: its start is the page before, the next day starts at its percent');
select ok(tests.chain_ok(:'dune_s'), '(chain whole, through the conversion)');
-- S1 (review): a percent on the next day's end (in percent) ends the day on that day's STORED end.
select tests.seed(:'dune_s', :'chain', '212');
select is(tests.set(:'dune', 3, null, 39), '11:-30 10:30-58 8:58-96 7:96-120 5:120-151 4:151-170 3:170-188 1:188-212',
  'S1 repro 1: 39 % on day 3, which is the next day''s end in percent (188 = 39 %): the day ends on page 188 and the next day goes');
select ok(tests.chain_ok(:'dune_s'), 'S1 repro 1: the chain is whole (no 1-page seam before day 1)');
select ok(tests.end_in(:'dune_s', 3, 'page') = tests.start_in(:'dune_s', 1, 'page')
          and tests.end_in(:'dune_s', 3, 'percent') = tests.start_in(:'dune_s', 1, 'percent'),
  'S1 repro 1: day 3 ends where day 1 starts, in pages and in percent');
select is(tests.p(:'dune_s'), '212', 'S1 repro 1: the read is untouched');
select tests.days_version(:'dune_s') as dv_s1 \gset
select is(tests.set(:'dune', 3, null, 39), '11:-30 10:30-58 8:58-96 7:96-120 5:120-151 4:151-170 3:170-188 1:188-212',
  'S1: the same percent again');
select is(tests.days_version(:'dune_s'), :'dv_s1', 'S1: is a no-op');
select tests.seed(:'dune_s', :'chain', '212');
select is(tests.set(:'dune', 3, null, 50), '11:-30 10:30-58 8:58-96 7:96-120 5:120-151 4:151-170 3:170-188 1:188-212',
  'E13: 50 % clamped in percent to the next day''s end (188 = 39 %) ends the day on that page too');
select ok(tests.chain_ok(:'dune_s'), '(chain whole)');
select tests.seed(:'dune_s', :'chain', '212');
select is(tests.set(:'dune', 3, null, 30), :'chain',
  'E13: clamped in percent to the start (170 = 35 %): no row');
select tests.seed(:'dune_s', :'chain', '212');
select is(tests.set(:'dune', 2, null, 44), '11:-30 10:30-58 8:58-96 7:96-120 5:120-151 4:151-170 2:170-212',
  'S1 repro 2: 44 % on day 2, the latest day''s end in percent (212 = 44 %): day 2 ends on page 212 and day 1 goes');
select is(tests.p(:'dune_s'), '212', 'S1 repro 2: the read keeps its page value');
select ok(tests.leads(:'dune_s'), 'S1 repro 2: and the days lead it in pages and in percent');
select ok(tests.chain_ok(:'dune_s'), '(chain whole)');
select is(tests.set(:'dune', 2, 230), '11:-30 10:30-58 8:58-96 7:96-120 5:120-151 4:151-170 2:170-230',
  'S1 repro 2: so the next page write on the latest day goes past 212 in one call');
select is(tests.p(:'dune_s'), '230', '(and moves the read)');
select tests.seed(:'dune_s', :'chain', '212');
select is(tests.set(:'dune', 1, null, 46), '11:-30 10:30-58 8:58-96 7:96-120 5:120-151 4:151-170 2:170-188 1:188-%46',
  'the latest day set in percent');
select is(tests.p(:'dune_s'), '%46', 'moves the read to that percent');
select is(tests.set(:'dune', 1, 221), '11:-30 10:30-58 8:58-96 7:96-120 5:120-151 4:151-170 2:170-188 1:188-%46',
  'a page equal to its end in pages (46 % = 221) changes nothing');
select is(tests.set(:'dune', 1, 230), '11:-30 10:30-58 8:58-96 7:96-120 5:120-151 4:151-170 2:170-188 1:188-230',
  'and a page that differs ends it in pages again');
select is(tests.p(:'dune_s'), '230', '(the read too)');

-- A read without a page count counts in percent; a page then bounds nothing.
select tests.seed(:'emma_s', '5:-%10 3:%10-%25', '%25');
select is(tests.set(:'emma', 4, null, 20), '5:-%10 4:%10-%20 3:%20-%25', 'percent only: a day in the middle');
select is(tests.set(:'emma', 2, null, 31), '5:-%10 4:%10-%20 3:%20-%25 2:%25-%31', 'a day after the latest');
select is(tests.p(:'emma_s'), '%31', 'moves the read');
select is(tests.del(:'emma', 3), '5:-%10 4:%10-%20 2:%20-%31', 'a remove in percent');
select ok(tests.chain_ok(:'emma_s'), '(chain whole)');

-- ------------------------------------------------------------------ remove (R6)

select tests.seed(:'dune_s', :'chain', '212');
select tests.days_version(:'dune_s') as dv0 \gset
select tests.session_version(:'dune_s') as v0 \gset
select is(tests.del(:'dune', 3), :'chain', 'removing a day without a row does nothing');
select ok(tests.days_version(:'dune_s') = :'dv0' and tests.session_version(:'dune_s') = :'v0', 'and writes nothing');
select is(tests.del(:'dune', 11), '10:-58 8:58-96 7:96-120 5:120-151 4:151-170 2:170-188 1:188-212',
  'removing the first day: the next one starts at the base (none)');
select ok(tests.chain_ok(:'dune_s'), '(chain whole)');

-- A day that went back (a re-read booked "-n" by the Today sheet).
select tests.seed(:'dune_s', '3:100-150 2:150-120 1:120-160', '160');
select is(tests.set(:'dune', 2, 120), '3:100-150 2:150-120 1:120-160',
  'a day that went back, set to the end it has: kept, not clamped away (idempotent)');
select is(tests.set(:'dune', 2, 130), '3:100-150 2:150-130 1:130-160',
  'it can come up towards its start');
select is(tests.del(:'dune', 2), '3:100-150 1:150-160', 'and its removal leaves the next day the difference');
select tests.seed(:'dune_s', '3:100-150 2:150-120', '120');
select is(tests.del(:'dune', 3), '2:100-120', 'removing the day before one that went back');
select tests.seed(:'dune_s', '3:100-150 2:150-100', '100');
select is(tests.del(:'dune', 3), '', 'where the next day then reads nothing, it goes too');
select is(tests.p(:'dune_s'), '100', 'and the read stays at the start: it is where both days began');

-- ------------------------------------------------------------------ idempotence (R9), E14

select tests.seed(:'dune_s', :'chain', '212');
select tests.set(:'dune', 3, 178);
select tests.days_version(:'dune_s') as dv1 \gset
select tests.session_version(:'dune_s') as v1 \gset
select is(tests.set(:'dune', 3, 178), '11:-30 10:30-58 8:58-96 7:96-120 5:120-151 4:151-170 3:170-178 2:178-188 1:188-212',
  'E14: the same write twice');
select is(tests.days_version(:'dune_s'), :'dv1', 'E14: the second writes no day');
select is(tests.session_version(:'dune_s'), :'v1', 'E14: and not the read');
select tests.seed(:'dune_s', :'chain', '212');
select tests.set(:'dune', 3, 100);
select tests.days_version(:'dune_s') as dv2 \gset
select is(tests.set(:'dune', 3, 100), :'chain', 'a write clamped onto the day''s start, again');
select is(tests.days_version(:'dune_s'), :'dv2', 'writes nothing either time');
-- An out-of-range value (sent only by a queued write whose neighbours changed) is clamped against
-- the neighbours each call meets: after the first took the next day away, a repeat meets the one
-- after it. The outbox sends a write once (its request id), so a replay never repeats it.
select tests.seed(:'dune_s', :'chain', '212');
select is(tests.set(:'dune', 3, 300), '11:-30 10:30-58 8:58-96 7:96-120 5:120-151 4:151-170 3:170-188 1:188-212',
  'a value above the next day''s end, clamped to it (the next day goes)');
select is(tests.set(:'dune', 3, 300), '11:-30 10:30-58 8:58-96 7:96-120 5:120-151 4:151-170 3:170-212',
  'the same out-of-range call again is clamped to the next end it meets: not a no-op (documented)');
select tests.seed(:'dune_s', :'chain', '212');
select tests.del(:'dune', 2);
select tests.days_version(:'dune_s') as dv3 \gset
select tests.session_version(:'dune_s') as v3 \gset
select is(tests.del(:'dune', 2), '11:-30 10:30-58 8:58-96 7:96-120 5:120-151 4:151-170 1:170-212', 'the same remove twice');
select ok(tests.days_version(:'dune_s') = :'dv3' and tests.session_version(:'dune_s') = :'v3', 'the second writes nothing');
select tests.seed(:'dune_s', :'chain', '212');
select tests.del(:'dune', 1);
select tests.session_version(:'dune_s') as v4 \gset
select is(tests.del(:'dune', 1), '11:-30 10:30-58 8:58-96 7:96-120 5:120-151 4:151-170 2:170-188', 'removing the latest day twice');
select ok(tests.p(:'dune_s') = '188' and tests.session_version(:'dune_s') = :'v4',
  'lowers the read once: the second remove finds no day and writes nothing');

-- ------------------------------------------------------------------ open reads only (R10), E15

select tests.act_as(:'ida');
select (public.add_to_library('{"title":"Middlemarch","source":"apple","apple_id":"990000478005","page_count":300}',
  'reading', :'today'::date - 5)).id as mm \gset
select (public.add_to_library('{"title":"Ulysses","source":"apple","apple_id":"990000478006","page_count":300}',
  'reading', :'today'::date - 5)).id as uly \gset
reset role;
select tests.open_session(:'mm') as mm_s \gset
select tests.open_session(:'uly') as uly_s \gset
select tests.seed(:'mm_s', '3:-50 2:50-80', '80');
select tests.seed(:'uly_s', '3:-50 2:50-80', '80');
select tests.act_as(:'ida');
select public.finish_reading(:'mm', :'today'::date, null, null);
select public.abandon_reading(:'uly', :'today'::date, 'not now');
select throws_ok(format($$ select public.set_progress_day(%L, %L, 60) $$, :'mm', :'today'::date - 2),
  '22023', 'not_reading', 'E15: a finished read''s days are not editable');
select throws_ok(format($$ select public.delete_progress_day(%L, %L) $$, :'mm', :'today'::date - 2),
  '22023', 'not_reading', 'E15: nor removable');
select throws_ok(format($$ select public.set_progress_day(%L, %L, 60) $$, :'uly', :'today'::date - 2),
  '22023', 'not_reading', 'an abandoned read''s neither');
reset role;
select is((select string_agg(tests.v(start_page, start_percent) || '-' || tests.v(end_page, end_percent), ' ' order by day)
             from public.reading_progress_days where session_id = :'mm_s'), '-50 50-80',
  'the finished read keeps its days');

-- ------------------------------------------------------------------ sync_write (offline)

select tests.seed(:'dune_s', :'chain', '212');
select tests.act_as(:'ida');
select gen_random_uuid() as rq1 \gset
select is(public.sync_write(:'rq1', 'set_progress_day',
            jsonb_build_object('p_entry_id', :'dune', 'p_day', :'today'::date - 9, 'p_page', 70)),
  '{"replayed": false}'::jsonb, 'a queued set_progress_day is applied');
select is(tests.days(:'dune_s'), '11:-30 10:30-58 9:58-70 8:70-96 7:96-120 5:120-151 4:151-170 2:170-188 1:188-212',
  'on its own day 9 days ago: not moved up to yesterday as a queued update_progress is');
select is(public.sync_write(:'rq1', 'set_progress_day',
            jsonb_build_object('p_entry_id', :'dune', 'p_day', :'today'::date - 9, 'p_page', 80)),
  '{"replayed": true}'::jsonb, 'the same request again is a replay');
select is(tests.days(:'dune_s'), '11:-30 10:30-58 9:58-70 8:70-96 7:96-120 5:120-151 4:151-170 2:170-188 1:188-212',
  'and applies nothing');
select is(public.sync_write(gen_random_uuid(), 'set_progress_day',
            jsonb_build_object('p_entry_id', :'dune', 'p_day', :'today'::date - 9, 'p_page', 70)),
  '{"replayed": false}'::jsonb, 'the same write under another request id');
select is(tests.days(:'dune_s'), '11:-30 10:30-58 9:58-70 8:70-96 7:96-120 5:120-151 4:151-170 2:170-188 1:188-212',
  'is a no-op (R9)');
-- A queue replayed in order: add 3 ago, change 2 ago, remove 1 ago, remove 3 ago.
select public.sync_write(gen_random_uuid(), 'set_progress_day',
  jsonb_build_object('p_entry_id', :'dune', 'p_day', :'today'::date - 3, 'p_page', 178));
select public.sync_write(gen_random_uuid(), 'set_progress_day',
  jsonb_build_object('p_entry_id', :'dune', 'p_day', :'today'::date - 2, 'p_percent', 38));
select public.sync_write(gen_random_uuid(), 'delete_progress_day',
  jsonb_build_object('p_entry_id', :'dune', 'p_day', :'today'::date - 1));
select gen_random_uuid() as rq2 \gset
select is(public.sync_write(:'rq2', 'delete_progress_day',
            jsonb_build_object('p_entry_id', :'dune', 'p_day', :'today'::date - 3)),
  '{"replayed": false}'::jsonb, 'a queued delete_progress_day is applied');
select is(tests.days(:'dune_s'), '11:-30 10:30-58 9:58-70 8:70-96 7:96-120 5:120-151 4:151-170 2:170-%38',
  'four queued writes replayed in order give the chain the online calls would');
select is(tests.p(:'dune_s'), '%38', 'the removal of the latest day moved the read to where it started (the percent day)');
select is(public.sync_write(:'rq2', 'delete_progress_day',
            jsonb_build_object('p_entry_id', :'dune', 'p_day', :'today'::date - 3)),
  '{"replayed": true}'::jsonb, 'a replayed remove answers from the first send');
select throws_ok(
  format($$ select public.sync_write(gen_random_uuid(), 'set_progress_day', %L::jsonb) $$,
         jsonb_build_object('p_entry_id', :'mm', 'p_day', :'today'::date - 2, 'p_page', 60)),
  '22023', 'not_reading', 'a queued write the database refuses is refused with its own error');
select throws_ok(
  $$ select public.sync_write(gen_random_uuid(), 'set_progress_days', '{}') $$,
  '22023', 'action_invalid', 'an unknown action is still refused');
-- Malformed queued payloads and stale replays. The outbox (web/app/data/outbox.ts, createSender)
-- drops a refusal and goes on: a code raised by name (mapLibraryError's list) whatever the HTTP
-- status, and anything else answered with a 4xx (PostgREST answers class 22 with 400). None of
-- these is kept as sent: the claim rolls back with the error, so nothing is recorded for its id.
select gen_random_uuid() as rq_bad \gset
select throws_ok(
  format($$ select public.sync_write(%L, 'set_progress_day', '{}') $$, :'rq_bad'),
  '22023', 'date_invalid', 'an empty payload: refused by name (no day comes first)');
reset role;
select is((select count(*)::int from public.synced_writes where request_id = :'rq_bad'), 0,
  'and nothing is recorded for its request id');
select tests.act_as(:'ida');
select throws_ok(
  format($$ select public.sync_write(gen_random_uuid(), 'delete_progress_day', '{}') $$),
  '22023', 'date_invalid', 'an empty remove: refused by name');
select throws_ok(
  format($$ select public.sync_write(gen_random_uuid(), 'set_progress_day', %L::jsonb) $$,
         jsonb_build_object('p_entry_id', :'dune', 'p_day', :'today'::date - 3, 'p_page', 'many')),
  '22P02', null, 'a page that is no number: invalid_text_representation (a 400, refused)');
select throws_ok(
  format($$ select public.sync_write(gen_random_uuid(), 'set_progress_day', %L::jsonb) $$,
         jsonb_build_object('p_entry_id', :'dune', 'p_day', :'today'::date - 3, 'p_page', 99999999999)),
  '22003', null, 'a page past an integer: numeric_value_out_of_range (a 400, refused)');
select throws_ok(
  format($$ select public.sync_write(gen_random_uuid(), 'set_progress_day', %L::jsonb) $$,
         jsonb_build_object('p_entry_id', :'dune', 'p_day', :'today'::date - 3, 'p_page', 178, 'p_percent', 40)),
  '22023', 'progress_invalid', 'both a page and a percent: refused by name');
select throws_ok(
  format($$ select public.sync_write(gen_random_uuid(), 'set_progress_day', %L::jsonb) $$,
         jsonb_build_object('p_entry_id', :'dune', 'p_day', :'today'::date - 3)),
  '22023', 'progress_invalid', 'neither: refused by name');
select throws_ok(
  format($$ select public.sync_write(gen_random_uuid(), 'set_progress_day', %L::jsonb) $$,
         jsonb_build_object('p_entry_id', :'dune', 'p_day', 'someday', 'p_page', 178)),
  '22007', null, 'a day that is no day: invalid_datetime_format (date_invalid to the client)');
select throws_ok(
  format($$ select public.sync_write(gen_random_uuid(), 'delete_progress_day', %L::jsonb) $$,
         jsonb_build_object('p_entry_id', :'mm', 'p_day', :'today'::date - 2)),
  '22023', 'not_reading', 'a queued remove replayed after the read was finished: not_reading');
select (public.add_to_library('{"title":"Gone","source":"apple","apple_id":"990000478007","page_count":300}',
  'reading', :'today'::date - 5)).id as gone \gset
select public.remove_from_library(:'gone');
select throws_ok(
  format($$ select public.sync_write(gen_random_uuid(), 'set_progress_day', %L::jsonb) $$,
         jsonb_build_object('p_entry_id', :'gone', 'p_day', :'today'::date - 2, 'p_page', 60)),
  'P0002', 'entry_not_found', 'a queued write replayed after the entry left her Library: entry_not_found');
select throws_ok(
  format($$ select public.sync_write(gen_random_uuid(), 'delete_progress_day', %L::jsonb) $$,
         jsonb_build_object('p_entry_id', :'gone', 'p_day', :'today'::date - 2)),
  'P0002', 'entry_not_found', 'a queued remove too');
reset role;
select tests.days(:'dune_s') as dune_days \gset
select tests.act_as(:'max');
select throws_ok(
  format($$ select public.sync_write(gen_random_uuid(), 'set_progress_day', %L::jsonb) $$,
         jsonb_build_object('p_entry_id', :'dune', 'p_day', :'today'::date - 3, 'p_page', 178)),
  'P0002', 'entry_not_found', 'another member queueing a write to her entry: entry_not_found');
select throws_ok(
  format($$ select public.sync_write(gen_random_uuid(), 'delete_progress_day', %L::jsonb) $$,
         jsonb_build_object('p_entry_id', :'dune', 'p_day', :'today'::date - 2)),
  'P0002', 'entry_not_found', 'or a remove');
reset role;
select is(tests.days(:'dune_s'), :'dune_days', 'her days are unchanged');
select tests.act_as(:'ida');
select lives_ok(
  format($$ select public.sync_write(gen_random_uuid(), 'update_progress', %L::jsonb) $$,
         jsonb_build_object('p_entry_id', :'emma', 'p_percent', 40, 'p_day', :'today'::date - 5)),
  'the existing actions still work (update_progress)');
reset role;
select is(tests.days(:'emma_s'), '5:-%10 4:%10-%20 2:%20-%31 1:%31-%40',
  'and a queued update_progress''s old day is still moved up to yesterday');

-- ------------------------------------------------------------------ with update_progress (the Today save)

select tests.seed(:'dune_s', :'chain', '212');
select tests.act_as(:'ida');
select tests.set(:'dune', 3, 178);
select public.update_progress(:'dune', 230, p_day => :'today'::date);
select is(tests.days(:'dune_s'), '11:-30 10:30-58 8:58-96 7:96-120 5:120-151 4:151-170 3:170-178 2:178-188 1:188-212 0:212-230',
  'a Today save after a backdated day starts at the read''s value, as before');
select public.update_progress(:'dune', 212, p_day => :'today'::date);
select is(tests.days(:'dune_s'), '11:-30 10:30-58 8:58-96 7:96-120 5:120-151 4:151-170 3:170-178 2:178-188 1:188-212',
  'and its Undo takes the day away again');
select tests.del(:'dune', 1);
select public.update_progress(:'dune', 200, p_day => :'today'::date);
select is(tests.days(:'dune_s'), '11:-30 10:30-58 8:58-96 7:96-120 5:120-151 4:151-170 3:170-178 2:178-188 0:188-200',
  'after removing the latest day a Today save starts at the lowered value');
reset role;
select ok(tests.chain_ok(:'dune_s'), '(chain whole)');

-- ------------------------------------------------------------------ buddy reads (D2)

-- A room of a 400-page Book in 4 Sections (ends at 100, 200, 300, 400); Max hosts, Ida joined and
-- linked her copy. Her Section follows her read's value only.
select tests.member('host@dayedit.test', 'Host') as host \gset
select tests.act_as(:'host');
select (public.add_to_library('{"title":"Room Book","source":"apple","apple_id":"990000478010","page_count":400}')).id as he \gset
select public.create_buddy_read((select book_id from public.library_entries where id = :'he'),
  gen_random_uuid(), tests.secs(4), '{}', true) as rdj \gset
select tests.act_as(:'ida');
select (public.add_to_library('{"title":"Room Book","source":"apple","apple_id":"990000478010","page_count":400}')).id as ie \gset
select public.join_buddy_read((:'rdj'::jsonb) ->> 'link_token');
select public.link_buddy_entry(((:'rdj'::jsonb) ->> 'id')::uuid, :'ie');
select public.start_reading(:'ie', :'today'::date - 10);
reset role;
select ((:'rdj'::jsonb) ->> 'id') as rd \gset
select tests.open_session(:'ie') as ie_s \gset
select tests.seed(:'ie_s', '9:-80 7:80-150 5:150-190', '190');
select is(tests.auto(:'rd', :'ida'), 1, '(her read at 190 of 400 has completed Section 1)');

-- A stale Section shows whether a write refreshed it: only the read's value does.
select tests.set_auto(:'rd', :'ida', 0);
select tests.session_version(:'ie_s') as v0 \gset
select tests.member_version(:'rd', :'ida') as m0 \gset
select tests.act_as(:'ida');
select is(tests.set(:'ie', 7, 120), '9:-80 7:80-120 5:120-190', 'a day in the middle of her read in the room');
select is(tests.del(:'ie', 9), '7:-120 5:120-190', 'and a remove in the middle');
select is(tests.set(:'ie', 6, 160), '7:-120 6:120-160 5:160-190', 'and a new day in the middle');
reset role;
select is(tests.session_version(:'ie_s'), :'v0', 'leave her read unwritten (its value did not change)');
select is(tests.auto(:'rd', :'ida'), 0, 'so her Section is not refreshed: the stale value stays');
select is(tests.member_version(:'rd', :'ida'), :'m0', 'and her membership row is not written');

select tests.act_as(:'ida');
select is(tests.set(:'ie', 5, 210), '7:-120 6:120-160 5:160-210', 'the latest day up to 210');
reset role;
select is(tests.p(:'ie_s'), '210', 'moves her read');
select is(tests.auto(:'rd', :'ida'), 2, 'and refreshes her Section through the trigger update_progress uses: Section 2 done');
select tests.act_as(:'ida');
select tests.del(:'ie', 5);
reset role;
select is(tests.p(:'ie_s'), '160', 'removing the latest day lowers her read');
select is(tests.auto(:'rd', :'ida'), 1, 'and her Section follows it back');
select tests.act_as(:'ida');
select tests.set(:'ie', 2, 305);
reset role;
select is(tests.auto(:'rd', :'ida'), 3, 'a new latest day at 305 moves it on to Section 3');

-- A member in no room: a change of her read's value writes no buddy row and raises nothing.
select tests.member('zoe@dayedit.test', 'Zoe') as zoe \gset
select tests.act_as(:'zoe');
select (public.add_to_library('{"title":"Room Book","source":"apple","apple_id":"990000478010","page_count":400}',
  'reading', :'today'::date - 6)).id as ze \gset
reset role;
select tests.open_session(:'ze') as ze_s \gset
select tests.seed(:'ze_s', '5:-80 3:80-150', '150');
select tests.buddy_rows_version() as bv0 \gset
select ok(:'bv0' <> '', '(there are buddy member rows to watch: the room above)');
select tests.act_as(:'zoe');
select lives_ok(format($$ select tests.set(%L, 3, 250) $$, :'ze'),
  'a member in no room moves her latest day (and so her read)');
select lives_ok(format($$ select tests.del(%L, 3) $$, :'ze'), 'and removes it');
reset role;
select is(tests.p(:'ze_s'), '80', '(her read moved: 150, 250, then back to 80)');
select is(tests.buddy_rows_version(), :'bv0', 'no buddy member row was written');

select * from finish();
rollback;
