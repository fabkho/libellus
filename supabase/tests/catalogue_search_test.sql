-- Searching the Catalogue (search_books), at the database boundary:
--   supabase test db
--
-- A member finds Catalogue Books by the beginnings of the words of their title
-- and authors, accents and case ignored, and an ISBN-13 by ISBN; her own Manual
-- books come along, other members' never do. Every assertion acts as a
-- signed-in member and asks only about the made-up words of the Books this
-- test made, never about how many rows the Catalogue holds.

begin;
select plan(15);

create schema if not exists tests;

-- ------------------------------------------------------------------ fixtures

insert into public.invite_codes (code, label, max_uses) values ('T-SEARCH', 'catalogue search test', 5);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-SEARCH"}'::jsonb, now(), now(), now());
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

select tests.member('ida@search.test') as ida_id \gset
select tests.member('max@search.test') as max_id \gset

-- Words no real book has, so the developer's own Catalogue never answers.
insert into public.books (title, authors, source, apple_id, isbn13) values
  ('Zöpfelmeer', '{"Süsanna Quorbel"}', 'apple', '990000001001', '9780000001011'),
  ('Zöpfelmeer: Die Zeichnungen', '{"Maria Quorbel-Ost"}', 'apple', '990000001002', null),
  ('Das Haus der Zöpfelmeer-Bücher', '{"Edwin Vantroo"}', 'apple', '990000001003', null);
insert into public.books (title, authors, source, openlibrary_edition_key) values
  ('Straße der Quorbelnacht', '{"Jean-Paul Vantroo"}', 'openlibrary', 'OL990000001M');

insert into public.books (title, authors, source, owner_id) values
  ('Zöpfelmeer, mein Notizbuch', '{Ida}', 'manual', :'ida_id'),
  ('Zöpfelmeer, sein Notizbuch', '{Max}', 'manual', :'max_id');

grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

select tests.act_as(:'ida_id');

-- ----------------------------------------------------------------- matching

select set_eq(
  $$ select title from public.search_books('zopfel') $$,
  $$ values ('Zöpfelmeer'), ('Zöpfelmeer: Die Zeichnungen'), ('Das Haus der Zöpfelmeer-Bücher'),
            ('Zöpfelmeer, mein Notizbuch') $$,
  'a word''s beginning finds every title with a word that starts so, accents ignored');

select is(
  (select title from public.search_books('Zöpfelmeer') limit 1),
  'Zöpfelmeer',
  'the Book whose title is the query comes first');

select set_eq(
  $$ select title from public.search_books('ZOPFELMEER QUORB') $$,
  $$ values ('Zöpfelmeer'), ('Zöpfelmeer: Die Zeichnungen') $$,
  'every word must match, across title and authors, in any case');

select set_eq(
  $$ select title from public.search_books('susanna quor') $$,
  $$ values ('Zöpfelmeer') $$,
  'an author''s name finds her Books');

select set_eq(
  $$ select title from public.search_books('strasse quorbel') $$,
  $$ values ('Straße der Quorbelnacht') $$,
  'ß is searched as ss');

select set_eq(
  $$ select title from public.search_books('jean-paul vantr') $$,
  $$ values ('Straße der Quorbelnacht') $$,
  'hyphens separate words in the query as they do in the Book');

select is_empty(
  $$ select 1 from public.search_books('meer') $$,
  'only beginnings of words count, not their middles');

select is_empty(
  $$ select 1 from public.search_books(' -- ') $$,
  'a query without any word finds nothing');

select is(
  (select count(*)::integer from public.search_books('zopfel', 2)),
  2,
  'no more Books than asked for');

-- --------------------------------------------------------------------- ISBN

select results_eq(
  $$ select title from public.search_books('978-0-000-00101-1') $$,
  $$ values ('Zöpfelmeer') $$,
  'an ISBN-13 is looked up by ISBN, hyphens and all');

-- ------------------------------------------------------------ Manual books

select ok(
  exists (select 1 from public.search_books('notizbuch') where title = 'Zöpfelmeer, mein Notizbuch'),
  'a member finds her own Manual books');

select ok(
  not exists (select 1 from public.search_books('notizbuch') where title = 'Zöpfelmeer, sein Notizbuch'),
  'but never another member''s');

select tests.act_as(:'max_id');

select set_eq(
  $$ select title from public.search_books('notizbuch zopf') $$,
  $$ values ('Zöpfelmeer, sein Notizbuch') $$,
  'and he finds his, not hers');

-- ------------------------------------------------------------------ visitors

set local role anon;

select throws_ok(
  $$ select public.search_books('zopfel') $$,
  '42501', null, 'a visitor cannot search the Catalogue');

reset role;

create or replace function tests.plan(p_query text)
returns text language plpgsql as $$
declare v_line record; v_plan text := '';
begin
  for v_line in execute 'explain ' || p_query loop v_plan := v_plan || v_line."QUERY PLAN" || ' '; end loop;
  return v_plan;
end;
$$;

set local enable_seqscan = off;
select ok(
  tests.plan($q$ select 1 from public.books
                  where to_tsvector('simple'::regconfig, public.book_search_text(title, authors))
                        @@ public.book_search_query('zopfel') $q$) ~ 'books_search',
  'the search''s words can be found through the books_search index');

select * from finish();
rollback;
