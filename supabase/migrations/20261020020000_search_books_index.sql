-- search_books: let the Catalogue search use an index (perf assessment F1,
-- docs/perf/backend.md).
--
-- Until now search_books ran as the member (security invoker), so the
-- `books_readable` policy filtered what it saw. Under row-level security the
-- planner may evaluate a non-leakproof operator only after the policy's
-- condition, and `@@` (ts_match_vq) is not leakproof: the `books_search` GIN
-- index could never be used, and every search was a sequential scan that ran
-- unaccent + to_tsvector for every Book of the Catalogue, then again for
-- ts_rank on every match. Cost grew linearly with the Catalogue (local: 4 ms at
-- 400 Books, 15 ms at 2,500, 52-114 ms at 15,000; production 69 ms at 185).
--
-- Two changes, nothing else:
--
-- 1. The searchable words of every Book are kept, already computed, in
--    `private.book_search`, with a GIN index. A side table rather than a column
--    on `books`: `search_books` returns `setof public.books` and the app selects
--    `books(*)` everywhere, so a column on `books` would change the JSON every
--    installed app receives and send a tsvector with every Library entry. The
--    table is not reachable through the API (the `private` schema grants nothing
--    to anon or authenticated). A trigger on `books` keeps it current; the words
--    are exactly what `books_search` indexed:
--    to_tsvector('simple', book_search_text(title, authors)).
--
-- 2. search_books becomes SECURITY DEFINER, so it reads `books` without row-level
--    security and the index is usable. What the member may see is decided inside
--    the function instead, by the `books_readable` predicate word for word:
--
--        owner_id is null or owner_id = (select auth.uid())
--
--    applied to `public.books` itself (never to a copy), in both branches. The
--    signature, the return type, the ordering and the limit are unchanged;
--    the search path is pinned. The grants stay as they were: authenticated
--    and service_role may execute it, anon and public may not.
--
-- The `books_search` expression index is dropped: nothing could use it under
-- RLS, and it cost a GIN insert for every new Book.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------- the stored words

create table private.book_search (
  book_id  uuid primary key references public.books on delete cascade,
  -- to_tsvector('simple', book_search_text(title, authors)): what a query's word
  -- prefixes are matched against, and what ts_rank ranks by.
  words    tsvector not null,
  -- btrim(book_search_text(title, '{}')): the title as a query would be written,
  -- for "the Book whose title is the query comes first".
  title    text not null
);

comment on table private.book_search is
  'F1 (docs/perf/backend.md): the searchable words and normalised title of every Book, kept by '
  'the books_search_words trigger. Read only by public.search_books; never exposed to the API.';

revoke all on private.book_search from public, anon, authenticated;
alter table private.book_search enable row level security;  -- no policy: nobody but the owner

create or replace function private.book_search_sync()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into private.book_search (book_id, words, title)
  values (new.id,
          to_tsvector('simple'::regconfig, public.book_search_text(new.title, new.authors)),
          btrim(public.book_search_text(new.title, '{}')))
  on conflict (book_id) do update
    set words = excluded.words, title = excluded.title;
  return null;
end;
$$;

comment on function private.book_search_sync() is
  'Trigger: keeps private.book_search in step with a Book''s title and authors.';

revoke all on function private.book_search_sync() from public, anon, authenticated;

create trigger books_search_words
  after insert or update of title, authors on public.books
  for each row execute function private.book_search_sync();

-- Every Book there already is (the trigger above already holds off concurrent
-- writes to books), then the index, built in one pass.
insert into private.book_search (book_id, words, title)
select id,
       to_tsvector('simple'::regconfig, public.book_search_text(title, authors)),
       btrim(public.book_search_text(title, '{}'))
  from public.books
on conflict (book_id) do nothing;

create index book_search_words on private.book_search using gin (words);

drop index if exists public.books_search;

-- ----------------------------------------------------------- search_books

-- The Books the calling member can see that match a query, best first: a title
-- that is the query itself, then by how well the words match, then the newest.
-- An ISBN-13 (hyphens and spaces allowed; the client converts an ISBN-10) is
-- looked up by ISBN instead. At most `p_limit` Books, 50 at the very most.
-- Two branches rather than one OR, so each keeps its own indexable plan.
--
-- SECURITY DEFINER: it reads `books` without row-level security, so the
-- `books_readable` rule is applied here, word for word, in each branch.
create or replace function public.search_books(p_query text, p_limit integer default 20)
returns setof public.books
language plpgsql
stable
security definer
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
      select books.* from public.books
       where books.isbn13 = v_isbn13
         -- books_readable, word for word
         and (owner_id is null or owner_id = (select auth.uid()))
       order by books.owner_id is null, books.created_at desc, books.id
       limit v_limit;
    return;
  end if;

  v_words := public.book_search_query(p_query);
  if v_words is null then
    return;
  end if;
  v_text := btrim(public.book_search_text(p_query, '{}'));
  return query
    select books.* from private.book_search s
      join public.books on books.id = s.book_id
     where s.words @@ v_words
       -- books_readable, word for word
       and (owner_id is null or owner_id = (select auth.uid()))
     order by s.title = v_text desc,
              ts_rank(s.words, v_words) desc,
              books.created_at desc,
              books.id
     limit v_limit;
end;
$$;

comment on function public.search_books(text, integer) is
  'Catalogue search: the Books the caller can see (the Catalogue and her own Manual books) whose '
  'title and authors begin with the typed words, accents ignored; an ISBN-13 by ISBN. Best first. '
  'Security definer: applies the books_readable rule itself, so the words index is usable.';

revoke all on function public.search_books(text, integer) from public, anon;
grant execute on function public.search_books(text, integer) to authenticated;
