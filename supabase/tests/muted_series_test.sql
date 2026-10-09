-- mute_series / unmute_series and the muted list at the database boundary (issue #167).
--   supabase test db
--
-- She can mute a whole started series on Home: started_series leaves it out,
-- muted_series_list names it (the same items), unmute brings it back. It stays
-- muted when she reads on in it. Nobody sees or changes another member's mutes,
-- a signed-out caller is refused, an unknown series is refused, and both functions
-- are idempotent. A series that no longer qualifies as started is in neither list.

begin;
select plan(32);

insert into public.invite_codes (code, label, max_uses) values ('T-MUTED', 'muted series test', 5);

create schema if not exists tests;

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-MUTED"}'::jsonb, now(), now(), now());
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

create sequence tests.n start 990200;

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


select tests.member('ada@muted.pgtap.test') as ada_id \gset
select tests.member('ben@muted.pgtap.test') as ben_id \gset

grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

-- Alpha: finished 1 and 2 (the latest ten days ago); 3, 4 and 5 are open.
select tests.series('Alpha') as alpha \gset
select tests.work('Alpha 1', :'alpha', 1) as a1 \gset
select tests.work('Alpha 2', :'alpha', 2) as a2 \gset
select tests.work('Alpha 3', :'alpha', 3) as a3 \gset
select tests.work('Alpha 4', :'alpha', 4);
select tests.work('Alpha 5', :'alpha', 5);
select tests.shelve(:'ada_id', :'a1', 'finished', 40);
select tests.shelve(:'ada_id', :'a2', 'finished', 10);

-- Epsilon: reading its first, started three days ago.
select tests.series('Epsilon') as epsilon \gset
select tests.work('Epsilon 1', :'epsilon', 1) as e1 \gset
select tests.work('Epsilon 2', :'epsilon', 2);
select tests.shelve(:'ada_id', :'e1', 'reading', 3);

-- Delta: finished, all of it: complete.
select tests.series('Delta') as delta \gset
select tests.work('Delta 1', :'delta', 1) as d1 \gset
select tests.shelve(:'ada_id', :'d1', 'finished', 20);

-- Iota, with its sub-series Iota Guard: one work in both, finished 60 days ago.
select tests.series('Iota') as iota \gset
select tests.series('Iota Guard', :'iota') as iota_guard \gset
select tests.work('Iota 1', :'iota_guard', 1) as i1 \gset
select tests.work('Iota 2', :'iota_guard', 2);
select tests.work('Iota 3', :'iota', 3);
insert into public.work_series (work_id, series_id, position, source) values (:'i1', :'iota', 1, 'wikidata');
select tests.shelve(:'ada_id', :'i1', 'finished', 60);

-- Ben reads Alpha too.
select tests.shelve(:'ben_id', :'a1', 'finished', 5);

create function tests.names(p_list jsonb) returns jsonb language sql as $$
  select coalesce(jsonb_agg(s -> 'series' ->> 'name'), '[]') from jsonb_array_elements(p_list) s
$$;
grant execute on function tests.names(jsonb) to anon, authenticated;

-- ------------------------------------------------------------------ as Ada

select tests.act_as(:'ada_id');

select is(tests.names(public.started_series()), '["Epsilon", "Alpha", "Iota Guard"]'::jsonb, 'before muting: the started series');
select is(public.muted_series_list(), '[]'::jsonb, 'nothing is muted');

select lives_ok(format('select public.mute_series(%L)', :'alpha'), 'she mutes Alpha');
select is(tests.names(public.started_series()), '["Epsilon", "Iota Guard"]'::jsonb, 'a muted series leaves Home');
select is(tests.names(public.muted_series_list()), '["Alpha"]'::jsonb, 'and is in the muted list');
select is(
  (select jsonb_build_array(s ->> 'finished', s -> 'next' ->> 'title') from jsonb_array_elements(public.muted_series_list()) s),
  '["2", "Alpha 3"]'::jsonb,
  'with the same item as before: how many she finished, the next open work');
select is(public.started_series(1) -> 0 -> 'series' ->> 'name', 'Epsilon', 'a limit counts what is left');

select lives_ok(format('select public.mute_series(%L)', :'alpha'), 'muting again is fine');
select is((select count(*)::int from public.muted_series), 1, 'and changes nothing');

-- She reads on in it: it stays muted, and the muted item moves on with her.
reset role;
select tests.shelve(:'ada_id', :'a3', 'reading', 0);
select tests.act_as(:'ada_id');
select is(tests.names(public.started_series()), '["Epsilon", "Iota Guard"]'::jsonb, 'reading another work of it does not unmute it');
select is(public.muted_series_list() -> 0 -> 'next' ->> 'title', 'Alpha 4', 'the muted item shows what is open now');

select lives_ok(format('select public.unmute_series(%L)', :'alpha'), 'she unmutes Alpha');
select is(tests.names(public.started_series()), '["Alpha", "Epsilon", "Iota Guard"]'::jsonb, 'it is back on Home, in its place');
select is(public.muted_series_list(), '[]'::jsonb, 'and not in the muted list');
select lives_ok(format('select public.unmute_series(%L)', :'alpha'), 'unmuting again is fine');
select lives_ok(format('select public.unmute_series(%L)', :'epsilon'), 'so is unmuting one that was never muted');

-- A series that does not qualify is in neither list, muted or not.
select public.mute_series(:'delta');
select is(public.muted_series_list(), '[]'::jsonb, 'a muted series she has finished is not in the muted list');
select is(tests.names(public.started_series()), '["Alpha", "Epsilon", "Iota Guard"]'::jsonb, 'nor on Home');

-- A sub-series and its parent: Home names the sub-series, and muting it does not bring the parent back.
select public.mute_series(:'iota_guard');
select is(tests.names(public.started_series()), '["Alpha", "Epsilon"]'::jsonb, 'muting the sub-series hides it, and its parent does not take its place');
select is(tests.names(public.muted_series_list()), '["Iota Guard"]'::jsonb, 'the muted list names the sub-series');
select public.unmute_series(:'iota_guard');
select public.mute_series(:'iota');
select is(tests.names(public.started_series()), '["Alpha", "Epsilon", "Iota Guard"]'::jsonb, 'muting the parent hides nothing while its sub-series is the one named');
select is(public.muted_series_list(), '[]'::jsonb, 'and it is not in the muted list');
select public.unmute_series(:'iota');

-- ------------------------------------------------------- unknown, not signed in

select throws_ok(format('select public.mute_series(%L)', gen_random_uuid()), 'P0002', 'series_not_found', 'an unknown series is refused');
select throws_ok(format('select public.unmute_series(%L)', gen_random_uuid()), 'P0002', 'series_not_found', 'also to unmute');

select public.mute_series(:'alpha');

-- ------------------------------------------------------------ nobody else's

select tests.act_as(:'ben_id');
select is(tests.names(public.started_series()), '["Alpha"]'::jsonb, 'Ben still has Alpha on Home');
select is(public.muted_series_list(), '[]'::jsonb, 'and sees none of Ada''s mutes');
select is((select count(*)::int from public.muted_series), 0, 'the table shows him no row of hers');
select throws_ok(format('insert into public.muted_series (member_id, series_id) values (%L, %L)', :'ben_id', :'alpha'), '42501', null, 'there is no direct write');
select public.unmute_series(:'alpha');

select tests.act_as(:'ada_id');
select is(tests.names(public.muted_series_list()), '["Alpha"]'::jsonb, 'his unmute did not touch hers');

reset role;
set local role anon;
select throws_ok(format('select public.mute_series(%L)', :'alpha'), '42501', null, 'signed out: mute refused');
select throws_ok(format('select public.unmute_series(%L)', :'alpha'), '42501', null, 'signed out: unmute refused');
select throws_ok($$select public.muted_series_list()$$, '42501', null, 'signed out: the muted list refused');
reset role;

select * from finish();
rollback;
