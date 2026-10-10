-- search_books as a security-definer function over private.book_search
-- (20261020020000_search_books_index.sql, perf assessment F1):
--   supabase test db
--
-- search_books no longer runs under row-level security: it reads `books` as its
-- owner and applies the `books_readable` rule itself, so the words index can be
-- used. What this test holds it to:
--   * the same rows, in the same order, with the same JSON, as the function it
--     replaced (kept below verbatim as tests.search_books_old, still security
--     invoker under RLS), for every member and for crafted input;
--   * one member never finds another member's Manual books, by words or ISBN;
--   * anon still cannot call it; the grants are the ones it had; the search path
--     is pinned; the stored words are unreachable from the API and stay in step
--     with the Books.

begin;
select plan(184);
set local client_min_messages = warning;  -- the very long words' notices

create schema if not exists tests;

-- ------------------------------------------------------------------ fixtures

insert into public.invite_codes (code, label, max_uses) values ('T-SEARCH-DEF', 'search definer test', 5);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-SEARCH-DEF"}'::jsonb, now(), now(), now());
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

select tests.member('ida@definer.test') as ida_id \gset
select tests.member('max@definer.test') as max_id \gset
select tests.member('cleo@definer.test') as cleo_id \gset

-- Made-up words, so the developer's own Catalogue never answers. Several Books
-- share words and a created_at (one statement), so ranking and the id
-- tie-break both decide the order.
insert into public.books (title, authors, source, apple_id, isbn13) values
  ('Quarvelin', '{"Odessa Quarvelin"}', 'apple', '990000002001', '9780000002018'),
  ('Quarvelin Quarvelin Quarvelin', '{"Brannoch Ilt"}', 'apple', '990000002002', null),
  ('Quarvelin: Die Brücke', '{"Brannoch Ilt"}', 'apple', '990000002003', null),
  ('Die Brücke von Quarvelin', '{"Ödön Brannoch"}', 'apple', '990000002004', null),
  ('Brannochs Garten', '{"Jean-Luc Quarvelin"}', 'apple', '990000002005', null),
  ('Æsir & Ilt | Quarvelin', '{"Ffion Brannoch-Ilt"}', 'apple', '990000002006', null),
  ('Quarvelin''s <-> Garten!', '{"Ilt"}', 'apple', '990000002007', null),
  ('Straße nach Quarvelin', '{"İlke Brannoch"}', 'apple', '990000002008', null),
  ('日本語 Quarvelin', '{"Brannoch"}', 'apple', '990000002009', null),
  ('ﬁnal Quarvelin', '{"Brannoch"}', 'apple', '990000002010', null);
insert into public.books (title, authors, source, openlibrary_edition_key) values
  ('Quarvelin', '{"Odessa Quarvelin"}', 'openlibrary', 'OL990000002M');

-- Manual books: private to their owner. Max's repeat Catalogue words and an
-- ISBN of the Catalogue (allowed for Manual books), plus an ISBN only he has.
insert into public.books (title, authors, source, owner_id, isbn13) values
  ('Quarvelin, mein Heft', '{Ida}', 'manual', :'ida_id', null),
  ('Brannoch privat', '{Ida Brannoch}', 'manual', :'ida_id', '9780000002018'),
  ('Quarvelin, sein Heft', '{Max}', 'manual', :'max_id', null),
  ('Quarvelin', '{"Odessa Quarvelin"}', 'manual', :'max_id', '9780000002018'),
  ('Geheimtitel Vorlauf', '{"Max Brannoch"}', 'manual', :'max_id', '9780000002025');

-- The function as it was before 20261020020000, verbatim but for its name:
-- security invoker, so the books_readable policy decides what it sees.
create or replace function tests.search_books_old(p_query text, p_limit integer default 20)
returns setof public.books
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_limit  integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_isbn13 text := regexp_replace(coalesce(p_query, ''), '[\s-]', '', 'g');
  v_words  tsquery;
  v_text   text;
begin
  if v_isbn13 ~ '^97[89][0-9]{10}$' then
    return query
      select b.* from public.books b
       where b.isbn13 = v_isbn13
         and not b.check_failed   -- search_books leaves a Book the check failed out (private.book_shown), whoever else's rows are in the database
       order by b.owner_id is null, b.created_at desc, b.id
       limit v_limit;
    return;
  end if;

  v_words := public.book_search_query(p_query);
  if v_words is null then
    return;
  end if;
  v_text := btrim(public.book_search_text(p_query, '{}'));
  return query
    select b.* from public.books b
     where to_tsvector('simple'::regconfig, public.book_search_text(b.title, b.authors)) @@ v_words
       and not b.check_failed
     order by btrim(public.book_search_text(b.title, '{}')) = v_text desc,
              ts_rank(to_tsvector('simple'::regconfig, public.book_search_text(b.title, b.authors)), v_words) desc,
              b.created_at desc,
              b.id
     limit v_limit;
end;
$$;

-- What members type, and what an attacker would: tsquery operators, quotes,
-- backslashes, prefix and weight syntax, unicode, emoji, combining marks, the
-- empty string, NULL, very long input; and limits out of range.
create table tests.queries (n serial, q text, lim integer);
insert into tests.queries (q, lim) values
  ('quarv', 20), ('Quarvelin', 20), ('QUARVELIN', 50), ('quarvelin brannoch', 20),
  ('brannoch', 50), ('ilt', 50), ('heft', 50), ('max', 50), ('ida', 50), ('geheim', 50),
  ('vorlauf geheimtitel', 50), ('q', 50), ('b', 3), ('die brucke', 20), ('straße', 20),
  ('strasse quarv', 20), ('jean-luc', 20), ('odon', 20), ('aesir', 20), ('ilke', 20),
  ('日本', 20), ('fin', 20), ('Quarvelin''s', 20), ('''', 20), ('''quarv''', 20),
  ('quarv & brannoch', 20), ('quarv | geheim', 50), ('!quarv', 50), ('quarv <-> garten', 20),
  ('quarv:*', 20), ('quarv:A', 20), ('(quarv | geheim) & !ilt', 50), ('\', 20), ('\quarv', 20),
  (E'quarv\\ geheim', 20), ('🙂 quarv', 20), (E'Qua\u0308rv', 20), ('', 20), (' ', 20), (null, 20),
  ('quarv', 0), ('quarv', -5), ('quarv', 1000), ('quarv', null), (null, null),
  ('978-0-000-00201-8', 20), ('9780000002018', 50), ('978 0000 002025', 20), ('9780000002025', 20),
  (repeat('quarv ', 2000), 20), (repeat('x', 5000), 20), (repeat('quarvelin', 300), 20);

grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;
grant select on all tables in schema tests to authenticated;

-- ------------------------------------------- the same results as before, per member

-- Same rows, same order, same JSON (every column of books, as installed apps get it).
select tests.act_as(:'ida_id');
select results_eq(
  format('select to_jsonb(b) from public.search_books(%L, %s) b', q, coalesce(lim::text, 'null')),
  format('select to_jsonb(b) from tests.search_books_old(%L, %s) b', q, coalesce(lim::text, 'null')),
  format('Ida, query #%s: same rows, order and JSON as before', n))
from tests.queries order by n;

select tests.act_as(:'max_id');
select results_eq(
  format('select to_jsonb(b) from public.search_books(%L, %s) b', q, coalesce(lim::text, 'null')),
  format('select to_jsonb(b) from tests.search_books_old(%L, %s) b', q, coalesce(lim::text, 'null')),
  format('Max, query #%s: same rows, order and JSON as before', n))
from tests.queries order by n;

select tests.act_as(:'cleo_id');
select results_eq(
  format('select to_jsonb(b) from public.search_books(%L, %s) b', q, coalesce(lim::text, 'null')),
  format('select to_jsonb(b) from tests.search_books_old(%L, %s) b', q, coalesce(lim::text, 'null')),
  format('Cleo (no Manual books), query #%s: same rows, order and JSON as before', n))
from tests.queries order by n;

-- ------------------------------------------------- member A cannot see member B's row

select tests.act_as(:'ida_id');

select is_empty(
  $$ select 1 from tests.queries q, public.search_books(q.q, 50) b
      where b.owner_id is not null and b.owner_id <> auth.uid() $$,
  'whatever she types, Ida never gets another member''s Manual book');

select set_eq(
  $$ select title from public.search_books('heft', 50) $$,
  $$ values ('Quarvelin, mein Heft') $$,
  'Ida finds her own Manual book, not Max''s with the same word');

select is_empty(
  $$ select 1 from public.search_books('geheimtitel vorlauf', 50) $$,
  'Ida cannot find Max''s Manual book by its title');

select is_empty(
  $$ select 1 from public.search_books('max brannoch', 50) $$,
  'nor by its author');

select is_empty(
  $$ select 1 from public.search_books('9780000002025', 50) $$,
  'nor by an ISBN only his Manual book has');

select set_eq(
  $$ select coalesce(owner_id::text, 'catalogue') from public.search_books('978-0-000-00201-8', 50) $$,
  format($$ values ('catalogue'), (%L) $$, :'ida_id'),
  'an ISBN shared with Max''s Manual book gives the Catalogue Book and hers, never his');

select tests.act_as(:'max_id');

select is_empty(
  $$ select 1 from tests.queries q, public.search_books(q.q, 50) b
      where b.owner_id is not null and b.owner_id <> auth.uid() $$,
  'whatever he types, Max never gets another member''s Manual book');

select set_eq(
  $$ select title from public.search_books('vorlauf', 50) $$,
  $$ values ('Geheimtitel Vorlauf') $$,
  'Max finds his own Manual book');

-- A signed-in role with no member behind it (no sub): the Catalogue only.
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);

select is_empty(
  $$ select 1 from tests.queries q, public.search_books(q.q, 50) b where b.owner_id is not null $$,
  'without a member id, no Manual book at all');

select results_eq(
  $$ select to_jsonb(b) from public.search_books('quarv', 50) b $$,
  $$ select to_jsonb(b) from tests.search_books_old('quarv', 50) b $$,
  'without a member id, the same Catalogue Books as before');

-- ------------------------------------------------------------------- the stored words

select throws_ok(
  $$ select * from private.book_search $$,
  '42501', null, 'a member cannot read the stored words');

reset role;

select ok(
  not has_function_privilege('authenticated', 'private.book_search_sync()', 'execute')
  and not has_function_privilege('anon', 'private.book_search_sync()', 'execute'),
  'nobody but the owner may run the trigger function');

select ok(
  not has_table_privilege('authenticated', 'private.book_search', 'select')
  and not has_table_privilege('anon', 'private.book_search', 'select')
  and not has_schema_privilege('authenticated', 'private', 'usage'),
  'the stored words are behind a schema the API roles cannot use');

select is_empty(
  $$ select 1 from public.books b
       left join private.book_search s on s.book_id = b.id
      where s.book_id is null
         or s.words <> to_tsvector('simple'::regconfig, public.book_search_text(b.title, b.authors))
         or s.title <> btrim(public.book_search_text(b.title, '{}')) $$,
  'every Book has its words, exactly as the old expression computed them');

-- The trigger keeps them current.
insert into public.books (title, authors, source, apple_id)
values ('Neuling Vexmor', '{"Pell Vexmor"}', 'apple', '990000002099')
returning id as new_id \gset

select tests.act_as(:'cleo_id');
select results_eq(
  $$ select title from public.search_books('vexmor neul') $$,
  $$ values ('Neuling Vexmor') $$,
  'a new Book is found at once');
reset role;

update public.books set title = 'Umbenannt Vexmor', authors = '{"Pell Ostrin"}' where id = :'new_id';

select tests.act_as(:'cleo_id');
select results_eq(
  $$ select title from public.search_books('vexmor umbenannt ostrin') $$,
  $$ values ('Umbenannt Vexmor') $$,
  'a renamed Book is found by its new title and authors');
select is_empty(
  $$ select 1 from public.search_books('neuling') $$,
  'and no longer by its old title');
reset role;

delete from public.books where id = :'new_id';
select is_empty(
  format('select 1 from private.book_search where book_id = %L', :'new_id'),
  'a deleted Book takes its words with it');

-- The words index serves the match.
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
  tests.plan($q$ select book_id from private.book_search
                  where words @@ public.book_search_query('quarv') $q$) ~ 'book_search_words',
  'the search''s words are found through the book_search_words index');
reset enable_seqscan;

-- ------------------------------------------------------ definer, search path, grants

select ok(
  (select prosecdef from pg_proc where oid = 'public.search_books(text, integer)'::regprocedure),
  'search_books is security definer');

select is(
  (select proconfig from pg_proc where oid = 'public.search_books(text, integer)'::regprocedure),
  array['search_path=pg_catalog, public'],
  'its search path is pinned to pg_catalog, public');

select is(
  (select proconfig from pg_proc where oid = 'private.book_search_sync()'::regprocedure),
  array['search_path=pg_catalog, public'],
  'so is the trigger function''s');

select is(
  (select pg_get_function_result(oid) from pg_proc where oid = 'public.search_books(text, integer)'::regprocedure),
  'SETOF books',
  'it still returns setof books');

-- The grants it had before 20261020020000: execute for its owner, authenticated
-- and service_role; nothing for anon or public.
select set_eq(
  $$ select coalesce(r.rolname, 'PUBLIC'), a.privilege_type
       from pg_proc p, aclexplode(p.proacl) a left join pg_roles r on r.oid = a.grantee
      where p.oid = 'public.search_books(text, integer)'::regprocedure $$,
  $$ values ('postgres', 'EXECUTE'), ('authenticated', 'EXECUTE'), ('service_role', 'EXECUTE') $$,
  'the grants are unchanged: postgres, authenticated, service_role');

-- A caller's search path cannot reach inside: a shadowing regexp_replace that
-- would turn every query into an ISBN lookup changes nothing.
create or replace function tests.regexp_replace(text, text, text, text)
returns text language sql as $$ select '9780000002025'::text $$;
grant execute on function tests.regexp_replace(text, text, text, text) to authenticated;

select tests.act_as(:'ida_id');
select jsonb_agg(b.title) as shadow_expected from public.search_books('quarvelin brannoch', 50) b \gset
set local search_path = tests, pg_catalog, public;
select regexp_replace('quarvelin', '[\s-]', '', 'g') as shadow_live \gset
select pg_catalog.jsonb_agg(b.title) as shadow_got from public.search_books('quarvelin brannoch', 50) b \gset
reset search_path;
reset role;

select is(:'shadow_live'::text, '9780000002025'::text, 'the shadowing function is live in the caller''s search path');
select is(:'shadow_got'::jsonb, :'shadow_expected'::jsonb,
  'yet search_books does not pick it up: the same Books, in the same order');

-- ------------------------------------------------------------------- visitors

set local role anon;
select throws_ok(
  $$ select public.search_books('quarv') $$,
  '42501', null, 'a visitor still cannot search');
select throws_ok(
  $$ select * from private.book_search $$,
  '42501', null, 'nor read the stored words');
reset role;

select * from finish();
rollback;
