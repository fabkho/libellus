-- Collections' last-edited time, at the database boundary:
--   supabase test db
--
-- `collections.updated_at` is the time a Collection was last edited: renamed,
-- or a Book put on it, taken off it or moved within it (the app lists
-- Collections by it, latest first). Triggers keep it, so every write path
-- bumps it. Inside one transaction `now()` does not move, so each case first
-- sets the Collection's `updated_at` far back, as the owner, then acts as the
-- member and asks whether it moved.

begin;
select plan(13);

create schema if not exists tests;

-- ------------------------------------------------------------------ fixtures

insert into public.invite_codes (code, label, max_uses) values ('T-EDITED', 'collections edited test', 5);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-EDITED"}'::jsonb, now(), now(), now());
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

-- Puts a Collection's last-edited time far back (as the owner of the tables).
create or replace function tests.age(p_collection uuid)
returns void language plpgsql security definer as $$
begin
  update public.collections set updated_at = timestamptz '2000-01-01 00:00+00' where id = p_collection;
end;
$$;

create or replace function tests.edited(p_collection uuid)
returns timestamptz language sql security definer as $$
  select updated_at from public.collections where id = p_collection
$$;

grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

select tests.member('ida@edited.test') as ida_id \gset
select tests.act_as(:'ida_id');

\set piranesi '{"title":"Piranesi","authors":["Susanna Clarke"],"source":"apple","apple_id":"990000001601"}'
\set klara '{"title":"Klara and the Sun","authors":["Kazuo Ishiguro"],"source":"apple","apple_id":"990000001602"}'
\set dune '{"title":"Dune","authors":["Frank Herbert"],"source":"apple","apple_id":"990000001603"}'

-- ------------------------------------------------------------------ created

select id as shelf_id from public.create_collection('Shelf') \gset
select is(tests.edited(:'shelf_id'), now(), 'a new Collection is edited now');

-- ------------------------------------------------------------------- rename

select tests.age(:'shelf_id');
select lives_ok(format($$ select public.rename_collection(%L, 'Shelf two') $$, :'shelf_id'), 'she renames it');
select is(tests.edited(:'shelf_id'), now(), 'a rename is an edit');

-- ---------------------------------------------------------------- add, remove

select tests.age(:'shelf_id');
select id as piranesi_id from public.add_to_collection(:'shelf_id', :'piranesi'::jsonb) \gset
select is(tests.edited(:'shelf_id'), now(), 'a Book put on it is an edit');

select id as klara_id from public.add_to_collection(:'shelf_id', :'klara'::jsonb) \gset

select tests.age(:'shelf_id');
select lives_ok(format($$ select public.reorder_collection(%L, array[%L, %L]::uuid[]) $$,
  :'shelf_id', :'klara_id', :'piranesi_id'), 'she puts its Books in a new order');
select is(tests.edited(:'shelf_id'), now(), 'moving a Book within it is an edit');

select tests.age(:'shelf_id');
select lives_ok(format($$ select public.remove_from_collection(%L, %L) $$, :'shelf_id', :'klara_id'),
  'she takes a Book off it');
select is(tests.edited(:'shelf_id'), now(), 'a Book taken off it is an edit');

-- ------------------------------------------------------- only that Collection

select id as other_id from public.create_collection('Other') \gset
select tests.age(:'shelf_id');
select tests.age(:'other_id');
select public.add_to_collection(:'shelf_id', :'dune'::jsonb);
select is(tests.edited(:'other_id'), timestamptz '2000-01-01 00:00+00',
  'an edit of one Collection leaves the others'' time alone');

-- A Library entry removed takes its memberships along: the Collection it was on changed.
select tests.age(:'shelf_id');
select public.remove_from_library(:'piranesi_id');
select is(tests.edited(:'shelf_id'), now(), 'a Book removed from the Library, and so off the Collection, is an edit');

-- -------------------------------------------------------------- the backfill

-- The migration's backfill: the latest time a Book was put on it, else when it was made. Run the
-- same statement over Collections whose time is cleared (the column is not null, so a copy).
reset role;
create temporary table backfill as
select c.id,
       greatest(c.created_at,
                coalesce((select max(e.added_at) from public.collection_entries e where e.collection_id = c.id), c.created_at)) as at
  from public.collections c where c.id in (:'shelf_id', :'other_id');
select ok(
  (select at from backfill where id = :'shelf_id') >= (select max(added_at) from public.collection_entries where collection_id = :'shelf_id'),
  'the backfill is at least the latest time a Book was put on the Collection');
select is(
  (select at from backfill where id = :'other_id'),
  (select created_at from public.collections where id = :'other_id'),
  'and an empty Collection''s is when it was made');

-- ----------------------------------------------------------- the DB's order

select tests.act_as(:'ida_id');
select tests.age(:'other_id');
select public.rename_collection(:'shelf_id', 'Shelf three');
select is(
  (select array_agg(name order by updated_at desc, name) from public.collections where member_id = :'ida_id'),
  array['Shelf three', 'Other'],
  'sorted by updated_at, latest first, the edited one leads');

select * from finish();
rollback;
