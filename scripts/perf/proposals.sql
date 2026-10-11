-- SKETCHES, NOT MIGRATIONS: the fixes docs/perf/backend.md proposes, as SQL one can run against the
-- seeded throwaway stack (scripts/perf/seed.sh) inside a transaction to measure them. Nothing here is
-- applied by `supabase db reset`; each block rolls back. Run:
--   docker exec -i <db> psql -U postgres -v member=2 < scripts/perf/proposals.sql
\set ON_ERROR_STOP on
\if :{?member}
\else
  \set member 2
\endif
select md5('member' || :member)::uuid as mid \gset
\timing off

-- ============================================================================================
-- 1. search_books: RLS makes the GIN index unusable (ts_match_vq is not leakproof), so every search
--    is a sequential scan that recomputes unaccent + to_tsvector for each book.
-- ============================================================================================
begin;
create schema perf;
-- 1a. The same visibility rule as books_readable, written in the function (SECURITY DEFINER reads
--     `books` without RLS; the predicate below is the policy's, word for word, so nothing opens up).
create function perf.search_books_definer(p_query text, p_limit integer default 20)
returns setof public.books
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare
  v_limit  integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_isbn13 text := regexp_replace(coalesce(p_query, ''), '[\s-]', '', 'g');
  v_words  tsquery;
  v_text   text;
  v_me     uuid := (select auth.uid());
begin
  if v_isbn13 ~ '^97[89][0-9]{10}$' then
    return query select b.* from public.books b
     where b.isbn13 = v_isbn13 and (b.owner_id is null or b.owner_id = v_me)
     order by b.owner_id is null, b.created_at desc, b.id limit v_limit;
    return;
  end if;
  v_words := public.book_search_query(p_query);
  if v_words is null then return; end if;
  v_text := btrim(public.book_search_text(p_query, '{}'));
  return query
    select b.* from public.books b
     where to_tsvector('simple'::regconfig, public.book_search_text(b.title, b.authors)) @@ v_words
       and (b.owner_id is null or b.owner_id = v_me)
     order by btrim(public.book_search_text(b.title, '{}')) = v_text desc,
              ts_rank(to_tsvector('simple'::regconfig, public.book_search_text(b.title, b.authors)), v_words) desc,
              b.created_at desc, b.id
     limit v_limit;
end;
$$;
grant usage on schema perf to authenticated;
grant execute on function perf.search_books_definer(text, integer) to authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'mid', 'role', 'authenticated')::text, true);
set local role authenticated;
\echo '-- 1a: current search_books vs definer, three queries (ms: see "Execution Time")'
explain (analyze, timing off, summary on) select count(*) from public.search_books('author 7 lastname', 20);
explain (analyze, timing off, summary on) select count(*) from perf.search_books_definer('author 7 lastname', 20);
explain (analyze, timing off, summary on) select count(*) from public.search_books('book title 12345', 20);
explain (analyze, timing off, summary on) select count(*) from perf.search_books_definer('book title 12345', 20);
explain (analyze, timing off, summary on) select count(*) from public.search_books('bo', 20);
explain (analyze, timing off, summary on) select count(*) from perf.search_books_definer('bo', 20);
rollback;

-- 1b. + a stored tsvector, so ranking a thousand matches no longer re-runs unaccent for each.
begin;
alter table public.books add column search_tsv tsvector
  generated always as (to_tsvector('simple'::regconfig, public.book_search_text(title, authors))) stored;
create index books_search_tsv on public.books using gin (search_tsv);
create schema perf;
create function perf.search_books_stored(p_query text, p_limit integer default 20)
returns setof public.books
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_words tsquery := public.book_search_query(p_query);
  v_text  text := btrim(public.book_search_text(p_query, '{}'));
  v_me    uuid := (select auth.uid());
begin
  if v_words is null then return; end if;
  return query
    select b.* from public.books b
     where b.search_tsv @@ v_words and (b.owner_id is null or b.owner_id = v_me)
     order by btrim(public.book_search_text(b.title, '{}')) = v_text desc,
              ts_rank(b.search_tsv, v_words) desc, b.created_at desc, b.id
     limit v_limit;
end;
$$;
grant usage on schema perf to authenticated;
grant execute on function perf.search_books_stored(text, integer) to authenticated;
analyze public.books;
select set_config('request.jwt.claims', json_build_object('sub', :'mid', 'role', 'authenticated')::text, true);
set local role authenticated;
\echo '-- 1b: definer + stored tsvector'
explain (analyze, timing off, summary on) select count(*) from perf.search_books_stored('author 7 lastname', 20);
explain (analyze, timing off, summary on) select count(*) from perf.search_books_stored('book title 12345', 20);
explain (analyze, timing off, summary on) select count(*) from perf.search_books_stored('bo', 20);
rollback;

-- ============================================================================================
-- 2. reading_sessions / reading_progress_days policies: a query without an entry_id filter is a
--    scan of the whole table, every row tested against "my entries" (hashed SubPlan).
--    Drive from her entries instead (RLS stays as it is; the function is SECURITY INVOKER).
-- ============================================================================================
begin;
create schema perf;
create function perf.read_in_year(p_year int) returns bigint
language sql stable set search_path = pg_catalog, public as $$
  select count(*) from public.library_entries e
    join public.reading_sessions s on s.entry_id = e.id
   where e.member_id = (select auth.uid())
     and s.outcome = 'finished' and s.ended_on >= make_date(p_year, 1, 1) and s.ended_on <= make_date(p_year, 12, 31)
$$;
create function perf.first_progress_day() returns date
language sql stable set search_path = pg_catalog, public as $$
  select min(d.day) from public.library_entries e
    join public.reading_sessions s on s.entry_id = e.id
    join public.reading_progress_days d on d.session_id = s.id
   where e.member_id = (select auth.uid())
$$;
grant usage on schema perf to authenticated;
grant execute on all functions in schema perf to authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'mid', 'role', 'authenticated')::text, true);
set local role authenticated;
\echo '-- 2: readInYear as PostgREST asks (direct table) vs invoker function through her entries'
explain (analyze, buffers, summary on) select count(*) from public.reading_sessions where outcome = 'finished' and ended_on >= date_trunc('year', current_date) and ended_on <= current_date;
explain (analyze, buffers, summary on) select perf.read_in_year(extract(year from current_date)::int);
explain (analyze, buffers, summary on) select day from public.reading_progress_days order by day limit 1;
explain (analyze, buffers, summary on) select perf.first_progress_day();
rollback;

-- ============================================================================================
-- 3. import_books: work_title_key(b.title) is computed for every book she has, for every row of the
--    file (quadratic). An expression index makes the title match a lookup.
-- ============================================================================================
-- Measured with scripts/perf/import.sql before and after
--   create index books_work_title_key on public.books (public.work_title_key(title));
