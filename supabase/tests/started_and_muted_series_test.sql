-- started_and_muted_series: Home's two series lists from one evaluation (perf assessment F5):
--   supabase test db
--
-- {"open": started_series(...), "muted": muted_series_list(...)}, item for item, from one run of
-- the chain; the two old functions keep their answers (their own tests cover what the items hold).
-- Invoker rights, so nobody sees another member's series, mutes or progress; a signed-out caller
-- cannot call it.

begin;
select plan(13);

insert into public.invite_codes (code, label, max_uses) values ('T-SERIES-BOTH', 'started and muted series test', 5);

create schema if not exists tests;

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-SERIES-BOTH"}'::jsonb, now(), now(), now());
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

create sequence tests.n start 990500;

create or replace function tests.series(p_name text, p_parent uuid default null)
returns uuid language sql as $$
  insert into public.series (name, source, parent_id) values (p_name, 'wikidata', p_parent) returning id
$$;

create or replace function tests.work(p_title text, p_series uuid, p_pos numeric)
returns uuid language plpgsql as $$
declare v_work uuid; v_book uuid; v_n bigint := nextval('tests.n');
begin
  insert into public.works (wikidata_id, title) values ('Q' || v_n, p_title) returning id into v_work;
  insert into public.books (title, authors, source, apple_id) values (p_title, array['Test Author'], 'apple', '9905' || v_n)
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

grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

select tests.member('ada@series-both.pgtap.test') as ada_id \gset
select tests.member('ben@series-both.pgtap.test') as ben_id \gset

-- Alpha: Ada finished its first, Ben finished nothing there. Beta: Ben read the first; Ada has no book of it.
select tests.series('Alpha') as alpha \gset
select tests.work('Alpha 1', :'alpha', 1) as a1 \gset
select tests.work('Alpha 2', :'alpha', 2);
select tests.series('Beta') as beta \gset
select tests.work('Beta 1', :'beta', 1) as b1 \gset
select tests.work('Beta 2', :'beta', 2);
select tests.series('Gamma') as gamma \gset
select tests.work('Gamma 1', :'gamma', 1) as g1 \gset
select tests.work('Gamma 2', :'gamma', 2);

select tests.shelve(:'ada_id', :'a1', 'finished', 10);
select tests.shelve(:'ada_id', :'g1', 'finished', 20);
select tests.shelve(:'ben_id', :'b1', 'finished', 5);
select tests.shelve(:'ben_id', :'g1', 'reading', 1);

-- ---------------------------------------------------------------- Ada, nothing muted
select tests.act_as(:'ada_id');
select is(public.started_and_muted_series(50, 'en'),
          jsonb_build_object('open', public.started_series(50, 'en'), 'muted', public.muted_series_list(50, 'en')),
          'nothing muted: both sides are what the two functions answer');
select is(public.started_and_muted_series(50, 'en') -> 'muted', '[]'::jsonb, 'and the muted side is empty');
select is((select array_agg(i->'series'->>'name' order by i->'series'->>'name')
             from jsonb_array_elements(public.started_and_muted_series(50, 'en') -> 'open') i),
          array['Alpha', 'Gamma'], 'the open side names her two started series');

-- ---------------------------------------------------------------- Ada muted Gamma
select public.mute_series(:'gamma');
select is(public.started_and_muted_series(50, 'en'),
          jsonb_build_object('open', public.started_series(50, 'en'), 'muted', public.muted_series_list(50, 'en')),
          'with a mute: both sides are still what the two functions answer, item for item');
select is((select array_agg(i->'series'->>'name') from jsonb_array_elements(public.started_and_muted_series(50, 'en') -> 'open') i),
          array['Alpha'], 'Gamma left the open side');
select is((select array_agg(i->'series'->>'name') from jsonb_array_elements(public.started_and_muted_series(50, 'en') -> 'muted') i),
          array['Gamma'], 'and is on the muted side');
select is(public.started_and_muted_series(1, 'en'),
          jsonb_build_object('open', public.started_series(1, 'en'), 'muted', public.muted_series_list(1, 'en')),
          'the limit cuts each side by itself, as it does the two functions');
select is(public.started_series_items(50, 'en', true), public.muted_series_list(50, 'en'),
          'the helper both old functions call still answers the muted items as an array');

-- ---------------------------------------------------------------- member A cannot see member B's rows
select tests.act_as(:'ben_id');
select is((select array_agg(i->'series'->>'name' order by i->'series'->>'name')
             from jsonb_array_elements(public.started_and_muted_series(50, 'en') -> 'open') i),
          array['Beta', 'Gamma'], 'Ben sees his own started series, not Ada''s Alpha');
select is(public.started_and_muted_series(50, 'en') -> 'muted', '[]'::jsonb,
          'Ben cannot see Ada''s mute: Gamma is open for him, his muted side is empty');
select ok(not exists (select 1 from jsonb_array_elements(public.started_and_muted_series(50, 'en') -> 'open') i
                       where i->'series'->>'name' = 'Alpha'),
          'Ada''s Alpha, which only she started, is in none of his lists');

-- ---------------------------------------------------------------- signed out
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok($$select public.started_and_muted_series(50, 'en')$$, '42501', null, 'a signed-out caller cannot call it');
reset role;
select ok(has_function_privilege('authenticated', 'public.started_and_muted_series(integer, text)', 'execute')
          and not has_function_privilege('anon', 'public.started_and_muted_series(integer, text)', 'execute'),
          'authenticated may execute it, anon may not');

select * from finish();
rollback;
