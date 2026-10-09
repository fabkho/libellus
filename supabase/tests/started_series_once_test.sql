-- muted_series_list answers without the chain when nothing is muted (perf assessment F5):
--   supabase test db
--
-- Both Home lists are public.started_series_items with p_muted false / true. The
-- wrapper of the muted list only skips the call for a member who muted nothing; for
-- everybody else both lists are what the helper answers, item for item. The existing
-- started_series_test / muted_series_test keep covering what the items hold.

begin;
select plan(10);

insert into public.invite_codes (code, label, max_uses) values ('T-SERIES-ONCE', 'series once test', 5);

create schema if not exists tests;

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-SERIES-ONCE"}'::jsonb, now(), now(), now());
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

create sequence tests.n start 990400;

create or replace function tests.series(p_name text, p_parent uuid default null)
returns uuid language sql as $$
  insert into public.series (name, source, parent_id) values (p_name, 'wikidata', p_parent) returning id
$$;

create or replace function tests.work(p_title text, p_series uuid, p_pos numeric)
returns uuid language plpgsql as $$
declare v_work uuid; v_book uuid; v_n bigint := nextval('tests.n');
begin
  insert into public.works (wikidata_id, title) values ('Q' || v_n, p_title) returning id into v_work;
  insert into public.books (title, authors, source, apple_id) values (p_title, array['Test Author'], 'apple', '9904' || v_n)
    returning id into v_book;
  insert into public.book_works (book_id, work_id, matched_by) values (v_book, v_work, 'title');
  insert into public.work_series (work_id, series_id, position, source) values (v_work, p_series, p_pos, 'wikidata');
  return v_work;
end;
$$;

create or replace function tests.shelve(p_member uuid, p_work uuid, p_how text, p_days integer default 0)
returns uuid language plpgsql as $$
declare v_entry uuid;
begin
  insert into public.library_entries (member_id, book_id)
    select p_member, bw.book_id from public.book_works bw where bw.work_id = p_work
    returning id into v_entry;
  if p_how = 'reading' then
    insert into public.reading_sessions (entry_id, started_on) values (v_entry, current_date - p_days);
  elsif p_how = 'finished' then
    insert into public.reading_sessions (entry_id, started_on, ended_on, outcome)
      values (v_entry, current_date - p_days - 3, current_date - p_days, 'finished');
  end if;
  return v_entry;
end;
$$;

select tests.member('ada@series-once.pgtap.test') as ada_id \gset
select tests.member('ben@series-once.pgtap.test') as ben_id \gset

grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

-- Alpha: finished 1 and 2, 3 to 5 open. Epsilon: reading its first. Delta: finished, all of it.
-- Iota with its sub-series Iota Guard: one work finished in the sub-series.
select tests.series('Alpha') as alpha \gset
select tests.work('Alpha 1', :'alpha', 1) as a1 \gset
select tests.work('Alpha 2', :'alpha', 2) as a2 \gset
select tests.work('Alpha 3', :'alpha', 3);
select tests.work('Alpha 4', :'alpha', 4);
select tests.series('Epsilon') as epsilon \gset
select tests.work('Epsilon 1', :'epsilon', 1) as e1 \gset
select tests.work('Epsilon 2', :'epsilon', 2);
select tests.series('Delta') as delta \gset
select tests.work('Delta 1', :'delta', 1) as d1 \gset
select tests.series('Iota') as iota \gset
select tests.series('Iota Guard', :'iota') as iota_guard \gset
select tests.work('Iota 1', :'iota_guard', 1) as i1 \gset
select tests.work('Iota 2', :'iota_guard', 2);
select tests.work('Iota 3', :'iota', 3);

select tests.shelve(:'ada_id', :'a1', 'finished', 40);
select tests.shelve(:'ada_id', :'a2', 'finished', 10);
select tests.shelve(:'ada_id', :'e1', 'reading', 3);
select tests.shelve(:'ada_id', :'d1', 'finished', 20);
select tests.shelve(:'ada_id', :'i1', 'finished', 60);
select tests.shelve(:'ben_id', :'a1', 'finished', 5);
select tests.shelve(:'ben_id', :'e1', 'reading', 1);

-- ---------------------------------------------------------------- ben muted nothing
select tests.act_as(:'ben_id');

select is(public.muted_series_list(50, 'en'), '[]'::jsonb, 'nothing muted: the muted list is empty');
select is(public.muted_series_list(50, 'en'), public.started_series_items(50, 'en', true),
          'and it is what the helper answers');
select ok(jsonb_array_length(public.started_series(50, 'en')) = 2
          and public.started_series(50, 'en') = public.started_series_items(50, 'en', false),
          'started_series lists his two series, as the helper does');

-- ---------------------------------------------------------------- ada muted three
select tests.act_as(:'ada_id');
select public.mute_series(:'alpha');
select public.mute_series(:'iota');
select public.mute_series(:'delta');   -- complete: muted, but in no list

select is(public.muted_series_list(50, 'en'), public.started_series_items(50, 'en', true),
          'with mutes the muted list is what the helper answers, item for item');
select is((select array_agg(i->'series'->>'name' order by i->'series'->>'name')
             from jsonb_array_elements(public.muted_series_list(50, 'en')) i),
          array['Alpha'], 'it names Alpha (Iota is a parent whose sub-series is open, Delta is complete)');
select is(public.started_series(50, 'en'), public.started_series_items(50, 'en', false),
          'started_series is what the helper answers');
select is((select array_agg(i->'series'->>'name' order by i->'series'->>'name')
             from jsonb_array_elements(public.started_series(50, 'en')) i),
          array['Epsilon', 'Iota Guard'], 'and leaves out what she muted');
select is(public.muted_series_list(1, 'en'), public.started_series_items(1, 'en', true),
          'the limit is passed on');

-- Unmuted again: the list empties through the shortcut and the chain alike.
select public.unmute_series(:'alpha');
select public.unmute_series(:'iota');
select public.unmute_series(:'delta');
select is(public.muted_series_list(50, 'en'), public.started_series_items(50, 'en', true),
          'after unmuting the muted list is still what the helper answers');
select is(public.muted_series_list(50, 'en'), '[]'::jsonb, 'and it is empty');

reset role;
select * from finish();
rollback;
