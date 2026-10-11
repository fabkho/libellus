-- Series pages bloated with split volumes (migration 20261026010000):
--   supabase test db
--
-- Memory, Sorrow, and Thorn as Wikidata has it: three novels and their eight paperback halves
-- ("The Dragonbone Chair, part 1" at 1.1 … "To Green Angel Tower, Part 4" at 3.4). The cleanup drops the
-- halves' series links and the works nothing else needs; the novels, the legitimate decimals (Ender's
-- Saga 1.5, The Housemaid 2.5, The Murderbot Diaries 7.5, The Last King of Osten Ard 0.5) and titles
-- that only look like a part all stay; a half in somebody's Library stays as a work (without the series
-- link) and her author page still shows it; nobody but the owner of the database may run it.

begin;
select plan(20);

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-SPLIT', 'split volumes test', 5);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-SPLIT"}'::jsonb, now(), now(), now());
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

select tests.member('ada@split.pgtap.test') as ada_id \gset

grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

-- A work of the fixture: Wikidata item, title, year, position in a series.
create or replace function tests.work(p_qid text, p_title text, p_series text, p_position numeric, p_kind text default 'novel')
returns jsonb language sql as $$
  select jsonb_build_object('wikidata', p_qid, 'title', p_title, 'kind', p_kind,
    'authors', jsonb_build_array(jsonb_build_object('wikidata', 'Q991000001', 'name', 'Tad Williams')),
    'series', jsonb_build_array(jsonb_build_object('series', jsonb_build_object('wikidata', p_series),
                                                   'position', p_position, 'source', 'wikidata')))
$$;

-- ---------------------------------------------------------------- the fixture

select jsonb_build_object(
  'authors', jsonb_build_array(jsonb_build_object('wikidata', 'Q991000001', 'name', 'Tad Williams', 'fetched', true, 'worksFetched', true)),
  'series', jsonb_build_array(
    jsonb_build_object('wikidata', 'Q991000010', 'name', 'Memory, Sorrow, and Thorn', 'fetched', true),
    jsonb_build_object('wikidata', 'Q991000011', 'name', 'Ender''s Saga', 'fetched', true),
    jsonb_build_object('wikidata', 'Q991000012', 'name', 'The Housemaid', 'fetched', true),
    jsonb_build_object('wikidata', 'Q991000013', 'name', 'The Murderbot Diaries', 'fetched', true),
    jsonb_build_object('wikidata', 'Q991000014', 'name', 'The Last King of Osten Ard', 'fetched', true),
    jsonb_build_object('wikidata', 'Q991000015', 'name', 'Another Cycle', 'fetched', true)),
  'works', jsonb_build_array(
    -- Memory, Sorrow, and Thorn: the novels …
    tests.work('Q991100001', 'The Dragonbone Chair', 'Q991000010', 1),
    tests.work('Q991100002', 'Stone of Farewell', 'Q991000010', 2),
    tests.work('Q991100003', 'To Green Angel Tower', 'Q991000010', 3),
    -- … and their paperback halves.
    tests.work('Q991100011', 'The Dragonbone Chair, part 1', 'Q991000010', 1.1),
    tests.work('Q991100012', 'The Dragonbone Chair, part 2', 'Q991000010', 1.2),
    tests.work('Q991100013', 'Stone of Farewell, part 1', 'Q991000010', 2.1, 'other'),
    tests.work('Q991100014', 'Stone of Farewell, part 2', 'Q991000010', 2.2),
    tests.work('Q991100015', 'To Green Angel Tower, Part 1', 'Q991000010', 3.1),
    tests.work('Q991100016', 'To Green Angel Tower, part 2', 'Q991000010', 3.2),
    tests.work('Q991100017', 'To Green Angel Tower, part 3', 'Q991000010', 3.3),
    tests.work('Q991100018', 'To Green Angel Tower, part 4', 'Q991000010', 3.4),
    -- The legitimate decimals, each with the novel before it.
    tests.work('Q991100021', 'Ender''s Game', 'Q991000011', 1),
    tests.work('Q991100022', 'A War of Gifts', 'Q991000011', 1.5, 'novella'),
    tests.work('Q991100023', 'The Housemaid''s Secret', 'Q991000012', 2),
    tests.work('Q991100024', 'The Housemaid''s Wedding', 'Q991000012', 2.5),
    tests.work('Q991100025', 'Network Effect', 'Q991000013', 7),
    tests.work('Q991100026', 'Rapport', 'Q991000013', 7.5, 'novella'),
    tests.work('Q991100027', 'The Witchwood Crown', 'Q991000014', 1),
    tests.work('Q991100028', 'The Heart of What Was Lost', 'Q991000014', 0.5),
    -- Looks like a part, has no parent at its position; or its parent is in another series.
    tests.work('Q991100031', 'Orphan, part 2', 'Q991000015', 1.2),
    tests.work('Q991100032', 'The Dragonbone Chair, part 5', 'Q991000015', 1.5),
    tests.work('Q991100033', 'Another Novel', 'Q991000015', 1),
    -- A decimal that is not "<title>, part N": a sequel's subtitle, a part spelled out.
    tests.work('Q991100034', 'Another Novel, part one', 'Q991000015', 1.1),
    tests.work('Q991100035', 'Another Novel: the Tale', 'Q991000015', 1.2))) as fixture \gset
set local role service_role;
select public.enrich_save(:'fixture'::jsonb);
-- One half is also in a second series, where it is a plain member.
select public.enrich_save(jsonb_build_object('works', jsonb_build_array(
  jsonb_build_object('wikidata', 'Q991100012', 'title', 'The Dragonbone Chair, part 2',
    'series', jsonb_build_array(jsonb_build_object('series', jsonb_build_object('wikidata', 'Q991000015'),
                                                   'position', 4, 'source', 'wikidata'))))));
reset role;

-- Ada has "Stone of Farewell, part 1" in her Library.
select tests.act_as(:'ada_id');
select (public.add_to_library('{"title":"Stone of Farewell, part 1","authors":["Tad Williams"],"source":"apple","apple_id":"991000016101"}',
                              'finished', '2026-09-01', '2026-09-10', 16)).book_id as half_book \gset
select public.set_entry_series((select id from public.library_entries where book_id = :'half_book'), null, 'Ada''s Own', 9);
reset role;
set local role service_role;
select public.enrich_save(jsonb_build_object('book', jsonb_build_object(
  'id', :'half_book', 'matchedBy', 'title', 'status', 'enriched', 'mapVersion', 1,
  'work', jsonb_build_object('wikidata', 'Q991100013', 'title', 'Stone of Farewell, part 1'),
  'authors', jsonb_build_array(jsonb_build_object('position', 1,
    'author', jsonb_build_object('wikidata', 'Q991000001', 'name', 'Tad Williams'))),
  'genres', '[]'::jsonb)));
reset role;

select id as mst from public.series where wikidata_id = 'Q991000010' \gset

select tests.act_as(:'ada_id');
select is(jsonb_array_length(public.series_works(:'mst') -> 'works'), 11,
  'before: Memory, Sorrow, and Thorn lists eleven works, the novels and their halves');
reset role;

-- ------------------------------------------------------------- the cleanup

select tests.act_as(:'ada_id');
select throws_ok($$select private.drop_split_volumes()$$, '42501', null, 'the cleanup is the owner''s: a signed-in member cannot run it');
reset role;

select is(private.drop_split_volumes(), '{"links": 8, "works": 6}'::jsonb,
  'it drops the eight links; of the eight halves six go, one is in her Library, one in another series');

select tests.act_as(:'ada_id');
select results_eq(
  format($$select w ->> 'title' from jsonb_array_elements(public.series_works(%L) -> 'works') w order by (w ->> 'position')::numeric nulls last, 1$$, :'mst'),
  $$values ('The Dragonbone Chair'), ('Stone of Farewell'), ('To Green Angel Tower')$$,
  'Memory, Sorrow, and Thorn lists the three novels');
select is((public.series_works(:'mst') ->> 'count')::int, 3, 'three books');
reset role;

select is((select count(*)::int from public.works where wikidata_id in
             ('Q991100011', 'Q991100014', 'Q991100015', 'Q991100016', 'Q991100017', 'Q991100018')), 0,
  'the halves nobody holds are gone');
select is((select count(*)::int from public.works where wikidata_id in ('Q991100001', 'Q991100002', 'Q991100003')), 3,
  'the novels are there');

-- Legitimate decimals and look-alikes survive.
select results_eq(
  $$select w.title, ws.position from public.work_series ws join public.works w on w.id = ws.work_id
     where w.wikidata_id in ('Q991100022', 'Q991100024', 'Q991100026', 'Q991100028') order by ws.position$$,
  $$values ('The Heart of What Was Lost', 0.5::numeric), ('A War of Gifts', 1.5::numeric),
           ('The Housemaid''s Wedding', 2.5::numeric), ('Rapport', 7.5::numeric)$$,
  'Osten Ard 0.5, Ender 1.5, Housemaid 2.5 and Murderbot 7.5 keep their places');
select is((select count(*)::int from public.work_series ws join public.works w on w.id = ws.work_id
            where w.wikidata_id in ('Q991100031', 'Q991100032', 'Q991100034', 'Q991100035')), 4,
  'so do a "part" with no parent at its position, one whose parent is in another series, and decimals titled otherwise');

-- The half in her Library: the work stays, without the series link.
select is((select count(*)::int from public.works where wikidata_id = 'Q991100013'), 1,
  'the half in her Library is still a work');
select is((select count(*)::int from public.work_series ws join public.works w on w.id = ws.work_id where w.wikidata_id = 'Q991100013'), 0,
  'and in no series');
select is((select count(*)::int from public.book_works where book_id = :'half_book'), 1, 'her Book still belongs to it');
select is((select count(*)::int from public.library_entries where book_id = :'half_book'), 1, 'her Library is as it was');
select is((select series_id from public.entry_series where member_id = :'ada_id'),
          (select id from public.series where name = 'Ada''s Own'), 'and her own series for it');

-- The half also in a second series loses only the first.
select is((select count(*)::int from public.work_series ws join public.works w on w.id = ws.work_id
            where w.wikidata_id = 'Q991100012'), 1, 'a half in a second series keeps that one');
select is((select s.name from public.work_series ws join public.works w on w.id = ws.work_id
             join public.series s on s.id = ws.series_id where w.wikidata_id = 'Q991100012'), 'Another Cycle',
  'and it is the other');

-- Her author page: the series with its three novels, the half she holds among the other works.
select tests.act_as(:'ada_id');
select is(
  (select jsonb_agg(w ->> 'title' order by (w ->> 'position')::numeric)
     from jsonb_array_elements(public.author_page('Q991000001') -> 'series') g,
          jsonb_array_elements(g -> 'works') w where g ->> 'name' = 'Memory, Sorrow, and Thorn'),
  '["The Dragonbone Chair", "Stone of Farewell", "To Green Angel Tower"]'::jsonb,
  'the author page: Memory, Sorrow, and Thorn with its three novels');
select is(
  (select w -> 'entry' ->> 'status' from jsonb_array_elements(public.author_page('Q991000001') -> 'other') w
    where w ->> 'title' = 'Stone of Farewell, part 1'),
  'finished', 'and the half in her Library, with her status, among the author''s other works (its kind there is other)');
select is(
  (select count(*)::int from jsonb_array_elements(public.author_page('Q991000001') -> 'other') w where w ->> 'title' ~ ', part [0-9]+$'),
  1, 'and no other half');
reset role;

select is(private.drop_split_volumes(), '{"links": 0, "works": 0}'::jsonb, 'run again, it finds nothing');

select * from finish();
rollback;
