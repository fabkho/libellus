-- The reader's place, kept server-side (issue #131, phase 2):
--   supabase test db
--
-- A member saves where she is in her entry's ebook — a CFI, the fraction it is
-- through the book, the fingerprint of the file — and reads it back on another
-- device. Her places are hers alone: another member reads none of them and
-- cannot write one on her entry. A place never travels backwards: a save older
-- than the stored one is ignored and the stored one is returned, and a direct
-- update that is not newer changes nothing either. A CFI that is empty or too
-- long, a fraction outside 0–1 and a fingerprint that is not 64 hex characters
-- are refused, by the function and by the table. A place goes with its entry,
-- and with the member when she deletes her account.
--
-- Everything runs in one transaction, so `now()` stands still: the times a save
-- carries are written as offsets from it.
-- Assertions ask about the rows this test made, never about how many rows a
-- table holds.

begin;
select plan(34);

create schema if not exists tests;

-- ------------------------------------------------------------------ fixtures

insert into public.invite_codes (code, label, max_uses) values ('T-PLACES', 'reader places test', 5);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-PLACES"}'::jsonb, now(), now(), now());
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

-- An entry's place and a member's places, past the members' own RLS.
create or replace function tests.cfi_of(p_entry uuid)
returns text language sql security definer as $$
  select cfi from public.reader_places where entry_id = p_entry
$$;

create or replace function tests.places_of(p_member uuid)
returns bigint language sql security definer as $$
  select count(*) from public.reader_places where member_id = p_member
$$;

select tests.member('ada@places.pgtap.test') as ada_id \gset
select tests.member('ben@places.pgtap.test') as ben_id \gset

grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

-- Two fingerprints, as the device makes them: SHA-256 in lower-case hex.
\set hash_a '\'aa11bb22cc33dd44ee55ff6677889900aa11bb22cc33dd44ee55ff6677889900\''
\set hash_b '\'bb11bb22cc33dd44ee55ff6677889900aa11bb22cc33dd44ee55ff6677889900\''

select tests.act_as(:'ada_id');
select (public.add_to_library('{"title":"Dune","source":"apple","apple_id":"990000013101"}')).id as dune \gset
select (public.add_to_library('{"title":"Emma","source":"apple","apple_id":"990000013102"}')).id as emma \gset
select (public.add_to_library('{"title":"Solaris","source":"apple","apple_id":"990000013103"}')).id as solaris \gset

select tests.act_as(:'ben_id');
select (public.add_to_library('{"title":"Ubik","source":"apple","apple_id":"990000013104"}')).id as ubik \gset

-- ---------------------------------------------------------- her own place

reset role;
select tests.act_as(:'ada_id');

select is(
  (public.save_reader_place(:'dune', 'epubcfi(/6/14[chap05]!/4/2/2[p17]:0)', 0.25, :hash_a,
                            now() - interval '10 minutes')).cfi,
  'epubcfi(/6/14[chap05]!/4/2/2[p17]:0)', 'she saves where she is and gets the place back');

select results_eq(
  format($$select cfi, fraction, file_hash, member_id from public.reader_places where entry_id = %L$$, :'dune'),
  format($$values ('epubcfi(/6/14[chap05]!/4/2/2[p17]:0)', 0.25::real, %L::text, %L::uuid)$$, :hash_a, :'ada_id'),
  'and reads it back: the CFI, the fraction, the file it was read in, hers');

select is(
  (public.save_reader_place(:'dune', 'epubcfi(/6/20!/4/2:0)', 0.5, :hash_b, now() - interval '5 minutes')).cfi,
  'epubcfi(/6/20!/4/2:0)', 'reading on replaces the place');
select is(tests.cfi_of(:'dune'), 'epubcfi(/6/20!/4/2:0)', 'and that is what is stored');

-- ------------------------------------------------------------ forward only

select is(
  (public.save_reader_place(:'dune', 'epubcfi(/6/4!/4/2:0)', 0.05, :hash_a, now() - interval '1 hour')).cfi,
  'epubcfi(/6/20!/4/2:0)', 'a save from a device that read earlier returns the place that stands');
select results_eq(
  format($$select cfi, fraction from public.reader_places where entry_id = %L$$, :'dune'),
  $$values ('epubcfi(/6/20!/4/2:0)', 0.5::real)$$,
  'and does not overwrite the newer one');

update public.reader_places
   set cfi = 'epubcfi(/6/2!/4/2:0)', fraction = 0.01, updated_at = now() - interval '2 hours'
 where entry_id = :'dune';
select is(tests.cfi_of(:'dune'), 'epubcfi(/6/20!/4/2:0)',
  'a direct update that is not newer changes nothing either');

update public.reader_places
   set cfi = 'epubcfi(/6/30!/4/2:0)', fraction = 0.8, updated_at = now() - interval '1 minute'
 where entry_id = :'dune';
select is(tests.cfi_of(:'dune'), 'epubcfi(/6/30!/4/2:0)', 'a newer one goes through');

-- A device whose clock runs far ahead cannot park a place in the future.
select ok(
  (public.save_reader_place(:'dune', 'epubcfi(/6/32!/4/2:0)', 0.85, :hash_b, now() + interval '2 hours')).updated_at
    <= now(),
  'a place from a clock hours ahead is stamped now');
select is(tests.cfi_of(:'dune'), 'epubcfi(/6/32!/4/2:0)', 'and is the place that stands');

-- ---------------------------------------------------------- the one row

select lives_ok(
  format($$insert into public.reader_places (entry_id, cfi, fraction, file_hash, updated_at)
           values (%L, 'epubcfi(/6/8!/4/2:0)', 0.3, %L, now() - interval '30 minutes')$$, :'emma', :hash_a),
  'she may write a place of her own directly: it is one row');
select is((select member_id from public.reader_places where entry_id = :'emma'), :'ada_id'::uuid,
  'the member column names her without being sent');
select throws_ok(
  format($$insert into public.reader_places (entry_id, cfi, fraction, file_hash)
           values (%L, 'epubcfi(/6/9!/4/2:0)', 0.4, %L)$$, :'emma', :hash_a),
  '23505', null, 'an entry has one place, not two');

-- --------------------------------------------------------- hers alone

reset role;
select tests.act_as(:'ben_id');

select is_empty(format($$select 1 from public.reader_places where entry_id = %L$$, :'dune'),
  'another member reads none of her places');
select throws_ok(
  format($$select public.save_reader_place(%L, 'epubcfi(/6/2!/4/2:0)', 0.9, %L, now())$$, :'dune', :hash_a),
  'P0002', 'entry_not_found', 'and cannot save a place on her entry');
select throws_ok(
  format($$insert into public.reader_places (member_id, entry_id, cfi, fraction, file_hash)
           values (%L, %L, 'epubcfi(/6/2!/4/2:0)', 0.9, %L)$$, :'ben_id', :'dune', :hash_a),
  '42501', null, 'nor write one for it directly');
update public.reader_places set cfi = 'epubcfi(/6/2!/4/2:0)', updated_at = now() where entry_id = :'dune';
select is(tests.cfi_of(:'dune'), 'epubcfi(/6/32!/4/2:0)', 'nor change hers: RLS hands him no row to write');

select is(
  (public.save_reader_place(:'ubik', 'epubcfi(/6/12!/4/2:0)', 0.6, :hash_b, now() - interval '1 minute')).member_id,
  :'ben_id'::uuid, 'his own place on his own entry is his');
select is(tests.places_of(:'ben_id'), 1::bigint, 'and the only one he has');

-- ------------------------------------------------------------- the shape

reset role;
select tests.act_as(:'ada_id');

select throws_ok(format($$select public.save_reader_place(%L, '', 0.5, %L, now())$$, :'solaris', :hash_a),
  '22023', 'place_invalid', 'an empty CFI is refused');
select throws_ok(
  format($$select public.save_reader_place(%L, %L, 0.5, %L, now())$$, :'solaris', repeat('a', 2001), :hash_a),
  '22023', 'place_invalid', 'a CFI over 2000 characters is refused');
select throws_ok(format($$select public.save_reader_place(%L, 'epubcfi(/6/2!/4/2:0)', 1.5, %L, now())$$, :'solaris', :hash_a),
  '22023', 'place_invalid', 'a fraction past the end of the book is refused');
select throws_ok(format($$select public.save_reader_place(%L, 'epubcfi(/6/2!/4/2:0)', -0.1, %L, now())$$, :'solaris', :hash_a),
  '22023', 'place_invalid', 'a fraction below the start is refused');
select throws_ok(format($$select public.save_reader_place(%L, 'epubcfi(/6/2!/4/2:0)', 0.5, 'abc123', now())$$, :'solaris'),
  '22023', 'place_invalid', 'a fingerprint that is not a SHA-256 is refused');
select throws_ok(
  format($$select public.save_reader_place(%L, 'epubcfi(/6/2!/4/2:0)', 0.5, %L, now())$$, :'solaris', upper(:hash_a)),
  '22023', 'place_invalid', 'and one in upper case too: the device writes lower-case hex');

select throws_ok(
  format($$insert into public.reader_places (entry_id, cfi, fraction, file_hash)
           values (%L, 'epubcfi(/6/2!/4/2:0)', 2, %L)$$, :'solaris', :hash_a),
  '23514', null, 'the table refuses a fraction outside 0–1 whatever a client sends');
select throws_ok(
  format($$insert into public.reader_places (entry_id, cfi, fraction, file_hash)
           values (%L, 'epubcfi(/6/2!/4/2:0)', 0.5, 'nothex')$$, :'solaris'),
  '23514', null, 'and a fingerprint that is not 64 hex characters');

-- ------------------------------------------------------- signed out, gone

select lives_ok(
  format($$select public.save_reader_place(%L, 'epubcfi(/6/2!/4/2:0)', 0.2, %L, now())$$, :'solaris', :hash_a),
  'a place on her third book, to watch it go');

reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok(
  format($$select public.save_reader_place(%L, 'epubcfi(/6/2!/4/2:0)', 0.2, %L, now())$$, :'dune', :hash_a),
  '42501', null, 'a signed-out caller cannot save a place');

reset role;
delete from public.library_entries where id = :'solaris';
select is(tests.cfi_of(:'solaris'), null, 'a place goes with its entry');

select tests.act_as(:'ben_id');
select public.delete_my_account();
reset role;
select is(tests.places_of(:'ben_id'), 0::bigint, 'and a member''s places go with her account');

-- ------------------------------------------------------------ the table

select ok((select relrowsecurity from pg_class where oid = 'public.reader_places'::regclass),
  'row level security is on');
select ok(
  not has_table_privilege('anon', 'public.reader_places', 'select')
  and not has_table_privilege('anon', 'public.reader_places', 'insert'),
  'anon has nothing on the table');
select ok(
  has_table_privilege('authenticated', 'public.reader_places', 'select')
  and has_table_privilege('authenticated', 'public.reader_places', 'insert')
  and has_table_privilege('authenticated', 'public.reader_places', 'update')
  and not has_table_privilege('authenticated', 'public.reader_places', 'delete'),
  'a member reads and writes her places, and deletes none by hand');

select * from finish();
rollback;
