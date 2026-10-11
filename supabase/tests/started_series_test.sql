-- started_series at the database boundary (issue #167): Home's "Next in your series".
--   supabase test db
--
-- A series is started when one of its works is currently reading or finished;
-- want to read alone and a work given up on do not start it. It is listed while a
-- work of it is open (not finished, not being read, not given up on), most recent
-- activity first, with the next open work, how many she finished and how many
-- whole-numbered works it has. Her own corrections count, a sub-series is named
-- rather than its parent, and nobody sees another member's reading. Assertions
-- ask about the one member this test made.

begin;
select plan(23);

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-STARTED', 'started series test', 5);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-STARTED"}'::jsonb, now(), now(), now());
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

create sequence tests.n start 990100;

create or replace function tests.series(p_name text, p_parent uuid default null)
returns uuid language sql as $$
  insert into public.series (name, source, parent_id) values (p_name, 'wikidata', p_parent) returning id
$$;

-- A work in a series at a position, with the one Book (an edition) that is it.
create or replace function tests.work(p_title text, p_series uuid, p_pos numeric)
returns uuid language plpgsql as $$
declare v_work uuid; v_book uuid; v_n bigint := nextval('tests.n');
begin
  insert into public.works (wikidata_id, title) values ('Q' || v_n, p_title) returning id into v_work;
  insert into public.books (title, authors, source, apple_id) values (p_title, array['Test Author'], 'apple', '9901' || v_n)
    returning id into v_book;
  insert into public.book_works (book_id, work_id, matched_by) values (v_book, v_work, 'title');
  insert into public.work_series (work_id, series_id, position, source) values (v_work, p_series, p_pos, 'wikidata');
  return v_work;
end;
$$;

-- Her entry of the Book that is a work: want, reading (since p_days ago), finished or abandoned (p_days ago).
create or replace function tests.shelve(p_member uuid, p_work uuid, p_how text, p_days integer default 0)
returns uuid language plpgsql as $$
declare v_entry uuid;
begin
  insert into public.library_entries (member_id, book_id)
    select p_member, bw.book_id from public.book_works bw where bw.work_id = p_work
    returning id into v_entry;
  if p_how = 'reading' then
    insert into public.reading_sessions (entry_id, started_on) values (v_entry, current_date - p_days);
  elsif p_how in ('finished', 'abandoned') then
    insert into public.reading_sessions (entry_id, started_on, ended_on, outcome)
      values (v_entry, current_date - p_days - 3, current_date - p_days, p_how::public.session_outcome);
  end if;
  return v_entry;
end;
$$;

select tests.member('ada@started.pgtap.test') as ada_id \gset
select tests.member('ben@started.pgtap.test') as ben_id \gset

grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

-- ------------------------------------------------------------------ the shelves

-- Alpha: finished 1 and 2 (the latest ten days ago); 3 is wanted, 4 and 5 are open.
select tests.series('Alpha') as alpha \gset
select tests.work('Alpha 1', :'alpha', 1) as a1 \gset
select tests.work('Alpha 2', :'alpha', 2) as a2 \gset
select tests.work('Alpha 3', :'alpha', 3) as a3 \gset
select tests.work('Alpha 4', :'alpha', 4) as a4 \gset
select tests.work('Alpha 5', :'alpha', 5) as a5 \gset
select tests.shelve(:'ada_id', :'a1', 'finished', 40);
select tests.shelve(:'ada_id', :'a2', 'finished', 10);
select tests.shelve(:'ada_id', :'a3', 'want');

-- Beta: only wanted.
select tests.series('Beta') as beta \gset
select tests.work('Beta 1', :'beta', 1) as b1 \gset
select tests.work('Beta 2', :'beta', 2);
select tests.shelve(:'ada_id', :'b1', 'want');

-- Gamma: only abandoned.
select tests.series('Gamma') as gamma \gset
select tests.work('Gamma 1', :'gamma', 1) as g1 \gset
select tests.work('Gamma 2', :'gamma', 2);
select tests.shelve(:'ada_id', :'g1', 'abandoned', 5);

-- Delta: finished, all of it.
select tests.series('Delta') as delta \gset
select tests.work('Delta 1', :'delta', 1) as d1 \gset
select tests.work('Delta 2', :'delta', 2) as d2 \gset
select tests.shelve(:'ada_id', :'d1', 'finished', 20);
select tests.shelve(:'ada_id', :'d2', 'finished', 15);

-- Epsilon: reading its first, started three days ago (a series is started by reading).
select tests.series('Epsilon') as epsilon \gset
select tests.work('Epsilon 1', :'epsilon', 1) as e1 \gset
select tests.work('Epsilon 2', :'epsilon', 2);
select tests.work('Epsilon 3', :'epsilon', 3);
select tests.shelve(:'ada_id', :'e1', 'reading', 3);

-- Eta: finished 1 yesterday, gave up on 2, so the next is 3.
select tests.series('Eta') as eta \gset
select tests.work('Eta 1', :'eta', 1) as h1 \gset
select tests.work('Eta 2', :'eta', 2) as h2 \gset
select tests.work('Eta 3', :'eta', 3);
select tests.shelve(:'ada_id', :'h1', 'finished', 1);
select tests.shelve(:'ada_id', :'h2', 'abandoned', 1);

-- Theta: reading both of its two works: nothing left to offer.
select tests.series('Theta') as theta \gset
select tests.work('Theta 1', :'theta', 1) as t1 \gset
select tests.work('Theta 2', :'theta', 2) as t2 \gset
select tests.shelve(:'ada_id', :'t1', 'reading', 30);
select tests.shelve(:'ada_id', :'t2', 'reading', 30);

-- Iota, with its sub-series Iota Guard: one work in both, finished 60 days ago.
select tests.series('Iota') as iota \gset
select tests.series('Iota Guard', :'iota') as iota_guard \gset
select tests.work('Iota 1', :'iota_guard', 1) as i1 \gset
select tests.work('Iota 2', :'iota_guard', 2);
select tests.work('Iota 3', :'iota', 3);
insert into public.work_series (work_id, series_id, position, source) values (:'i1', :'iota', 1, 'wikidata');
select tests.shelve(:'ada_id', :'i1', 'finished', 60);

-- Kappa: three works, none hers; her own Book is placed at 1 by her correction (finished).
select tests.series('Kappa') as kappa \gset
select tests.work('Kappa 1', :'kappa', 1);
select tests.work('Kappa 2', :'kappa', 2);
select tests.work('Kappa 3', :'kappa', 3);
select tests.series('Elsewhere') as elsewhere \gset
select tests.work('Placed by Ada', :'elsewhere', 1) as placed \gset
select tests.shelve(:'ada_id', :'placed', 'finished', 80) as placed_entry \gset
insert into public.entry_series (entry_id, member_id, series_id, position) values (:'placed_entry', :'ada_id', :'kappa', 1);

-- Lambda: one work, finished: complete as far as anyone knows.
select tests.series('Lambda') as lambda \gset
select tests.work('Lambda 1', :'lambda', 1) as l1 \gset
select tests.shelve(:'ada_id', :'l1', 'finished', 2);

-- ------------------------------------------------------------------ as Ada

select tests.act_as(:'ada_id');

select is(
  (select jsonb_agg(s -> 'series' ->> 'name') from jsonb_array_elements(public.started_series()) s),
  '["Eta", "Epsilon", "Alpha", "Iota Guard", "Kappa"]'::jsonb,
  'the series she has started and not finished, the most recent activity first');

select is(
  (select jsonb_agg(s -> 'series' ->> 'name') from jsonb_array_elements(public.started_series()) s
    where s -> 'series' ->> 'name' in ('Beta', 'Gamma')),
  null,
  'only want to read, or only abandoned, does not start a series');
select is(
  (select jsonb_agg(s -> 'series' ->> 'name') from jsonb_array_elements(public.started_series()) s
    where s -> 'series' ->> 'name' in ('Delta', 'Lambda')),
  null,
  'a series all of whose known works she finished is not listed');
select is(
  (select jsonb_agg(s -> 'series' ->> 'name') from jsonb_array_elements(public.started_series()) s
    where s -> 'series' ->> 'name' = 'Theta'),
  null,
  'nor one whose remaining works she is all reading');
select is(
  (select jsonb_agg(s -> 'series' ->> 'name') from jsonb_array_elements(public.started_series()) s
    where s -> 'series' ->> 'name' = 'Iota'),
  null,
  'a sub-series is named rather than its parent');

select is(
  (select s -> 'next' ->> 'title' from jsonb_array_elements(public.started_series()) s where s -> 'series' ->> 'name' = 'Alpha'),
  'Alpha 3',
  'the next open work is the first after the furthest she started');
select is(
  (select s -> 'next' -> 'entry' ->> 'status' from jsonb_array_elements(public.started_series()) s where s -> 'series' ->> 'name' = 'Alpha'),
  'want_to_read',
  'with her status of it, Want to read');
select is(
  (select (s -> 'next' ->> 'position')::numeric from jsonb_array_elements(public.started_series()) s where s -> 'series' ->> 'name' = 'Alpha'),
  3::numeric,
  'and its place in the series');
select is(
  (select jsonb_build_array((s ->> 'finished')::int, (s ->> 'count')::int)
     from jsonb_array_elements(public.started_series()) s where s -> 'series' ->> 'name' = 'Alpha'),
  '[2, 5]'::jsonb,
  'how many she finished, of how many the series has');
select is(
  (select s -> 'next' -> 'entry' from jsonb_array_elements(public.started_series()) s where s -> 'series' ->> 'name' = 'Epsilon'),
  null,
  'a work she has no entry of has none');
select is(
  (select jsonb_build_array(s -> 'next' ->> 'title', (s ->> 'finished')::int)
     from jsonb_array_elements(public.started_series()) s where s -> 'series' ->> 'name' = 'Epsilon'),
  '["Epsilon 2", 0]'::jsonb,
  'reading its first starts a series: nothing finished, the second is next');
select is(
  (select s ->> 'activeOn' from jsonb_array_elements(public.started_series()) s where s -> 'series' ->> 'name' = 'Epsilon'),
  (current_date - 3)::text,
  'the day she began reading is her activity in it');
select is(
  (select s ->> 'activeOn' from jsonb_array_elements(public.started_series()) s where s -> 'series' ->> 'name' = 'Alpha'),
  (current_date - 10)::text,
  'else her latest finish');
select is(
  (select s -> 'next' ->> 'title' from jsonb_array_elements(public.started_series()) s where s -> 'series' ->> 'name' = 'Eta'),
  'Eta 3',
  'a work she gave up on is not offered again');
select is(
  (select s ->> 'finished' from jsonb_array_elements(public.started_series()) s where s -> 'series' ->> 'name' = 'Eta'),
  '1',
  'nor counted as finished');
select is(
  (select s -> 'next' ->> 'title' from jsonb_array_elements(public.started_series()) s where s -> 'series' ->> 'name' = 'Kappa'),
  'Kappa 2',
  'her own correction (a Book placed in the series) counts as the place it takes');
select is(
  (select s -> 'next' ->> 'title' from jsonb_array_elements(public.started_series()) s where s -> 'series' ->> 'name' = 'Iota Guard'),
  'Iota 2',
  'the sub-series'' next work');

select is(jsonb_array_length(public.started_series(2)), 2, 'a limit');
select is(jsonb_array_length(public.started_series(null)), 5, 'no limit: all');
select is(public.started_series(2) -> 0 -> 'series' ->> 'name', 'Eta', 'the limit keeps the most recent');

-- ------------------------------------------------------------ nobody else's

select tests.act_as(:'ben_id');
select is(public.started_series(), '[]'::jsonb, 'another member has started nothing of hers');

reset role;
set local role anon;
select throws_ok($$select public.started_series()$$, '42501', null, 'signed out: refused');
reset role;

select tests.act_as(:'ada_id');
select lives_ok($$select public.started_series(10, 'de')$$, 'in her language');

select * from finish();
rollback;
