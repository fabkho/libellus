-- The author line of a Book that is not in the Catalogue (a search result, a work opened from an author's page):
--   supabase test db
--
-- authors_by_ref(work, names, keys) finds the authors by the Open Library id the search gave, by the authors of the
-- Book's work and by the credited name (accents, case, dots and spacing aside; of several rows with one name, the one
-- with the most works); a member reads it, anon does not, and a name nobody has answers nothing.

begin;
select plan(13);

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-BYREF', 'authors by ref test', 5);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-BYREF"}'::jsonb, now(), now(), now());
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

select tests.member('ada@byref.pgtap.test') as ada_id \gset

-- Card, with her work; a second row by the same name that holds no work; Lem by his accented name; Tolkien by dots.
insert into public.authors (wikidata_id, openlibrary_key, name) values ('Q990100001', 'OL990100A', 'Orson Scott Card');
insert into public.authors (name) values ('Orson Scott CARD');
insert into public.authors (wikidata_id, name) values ('Q990100002', 'Stanisław Lem');
insert into public.authors (openlibrary_key, name) values ('OL990101A', 'J. R. R. Tolkien');
insert into public.authors (name) values ('Nobody Famous');
insert into public.works (openlibrary_key, title) values ('OL990100W', 'Speaker for the Dead');
insert into public.work_authors (work_id, author_id, position)
  select w.id, a.id, 1 from public.works w, public.authors a where w.openlibrary_key = 'OL990100W' and a.wikidata_id = 'Q990100001';

select tests.act_as(:'ada_id');

select results_eq(
  $$select ref, name, author_key from public.authors_by_ref(null, '{}', array['OL990100A'])$$,
  $$values ('OL990100A'::text, 'Orson Scott Card'::text, 'Q990100001'::text)$$,
  'by the Open Library id the search gave: the author row, its page key the Wikidata item');

select results_eq(
  $$select ref, credit_position, name, author_key from public.authors_by_ref('OL990100W', '{}', '{}')$$,
  $$values (null::text, 1::smallint, 'Orson Scott Card'::text, 'Q990100001'::text)$$,
  'by the Book''s work: the authors of the work row the author pages hold');

select results_eq(
  $$select ref, author_key from public.authors_by_ref(null, array['orson  scott  card'], '{}')$$,
  $$values ('orson  scott  card'::text, 'Q990100001'::text)$$,
  'by name, as people write it; of two rows with the name, the one with works');

select results_eq(
  $$select ref, author_key from public.authors_by_ref(null, array['Stanislaw Lem'], '{}')$$,
  $$values ('Stanislaw Lem'::text, 'Q990100002'::text)$$,
  'accents aside');

select results_eq(
  $$select ref, author_key from public.authors_by_ref(null, array['J.R.R. Tolkien'], '{}')$$,
  $$values ('J.R.R. Tolkien'::text, 'OL990101A'::text)$$,
  'dots and spacing aside; an author with no Wikidata item has her Open Library id for a key');

select is(
  (select author_key from public.authors_by_ref(null, array['Nobody Famous'], '{}')),
  (select id::text from public.authors where name = 'Nobody Famous'),
  'an author known by name only has her row''s uuid for a key');

select is((select count(*)::int from public.authors_by_ref('OL990100W', array['Orson Scott Card', 'Stanislaw Lem', 'Nobody Known'], array['OL990100A', 'OL1A'])),
  4, 'all three ways at once: the id, the work, and the two names that are authors; an unknown name and an unknown id answer nothing');

select is((select count(*)::int from public.authors_by_ref(null, array['Someone Nobody Has'], array['OL5A'])), 0,
  'a name and an id no author row has answer nothing');
select is((select count(*)::int from public.authors_by_ref(null, array['', '  . '], '{}')), 0, 'an empty name answers nothing');
select lives_ok($$select * from public.authors_by_ref(null, null, null)$$, 'nothing asked, nothing answered');
select is(public.author_name_key('  Ursula K.  Le Guin.'), 'ursula k le guin', 'the name as compared: lower case, dots and spaces as one space');

reset role;
set local role anon;
select throws_ok($$select * from public.authors_by_ref(null, array['Orson Scott Card'], '{}')$$, '42501', null, 'anon cannot ask');
select throws_ok($$select public.author_name_key('x')$$, '42501', null, 'nor compare');

reset role;
select * from finish();
rollback;
