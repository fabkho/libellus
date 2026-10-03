-- Searching the Catalogue (issue #1, Search; issue #12).
--
-- Search asks three sources at once: the own Catalogue, Apple Books and
-- OpenLibrary. This is the first of them: the Books members have added, found
-- by the beginnings of the words of their title and authors, accents ignored
-- ("pira", "Klára", "SUSANNA CLA" all find Susanna Clarke's Piranesi), plus the
-- member's own Manual books. Other members' Manual books never appear: the
-- function runs as the member, so the `books_readable` policy decides what it
-- sees, exactly as it does for every other read of `books`.
--
-- One call, so a native client searches the Catalogue the same way.

create extension if not exists unaccent with schema extensions;

-- ------------------------------------------------------------- the words

-- What a Book is found by: its title and authors in one string, accents
-- stripped (ß → ss, é → e), lower case. Immutable, so an index can hold it;
-- the dictionary is named with its schema, so the result never depends on a
-- caller's search path.
create or replace function public.book_search_text(p_title text, p_authors text[])
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select lower(extensions.unaccent(
    'extensions.unaccent'::regdictionary,
    coalesce(p_title, '') || ' ' || coalesce(array_to_string(p_authors, ' '), '')
  ))
$$;

comment on function public.book_search_text(text, text[]) is
  'Title and authors as search matches them: unaccented, lower case. Behind the books_search index.';

-- What a member typed, as a prefix query: every word must begin a word of the
-- title or of an author. Punctuation separates words, as it does in the index
-- ("piranesi's" → piranesi, s; "Jean-Paul" → jean, paul). Null when nothing
-- searchable is left, which matches no Book.
create or replace function public.book_search_query(p_query text)
returns tsquery
language sql
immutable
parallel safe
set search_path = ''
as $$
  select pg_catalog.to_tsquery(
    'pg_catalog.simple'::regconfig,
    pg_catalog.string_agg(pg_catalog.quote_literal(word) || ':*', ' & ' order by n)
  )
  from pg_catalog.regexp_split_to_table(public.book_search_text(p_query, '{}'), '[^[:alnum:]]+')
       with ordinality as t(word, n)
  where word <> ''
$$;

comment on function public.book_search_query(text) is
  'A typed query as a tsquery of word prefixes, all required. Null when no word is left.';

create index books_search on public.books
  using gin (to_tsvector('simple'::regconfig, public.book_search_text(title, authors)));

-- ----------------------------------------------------------- search_books

-- The Books the calling member can see that match a query, best first: a title
-- that is the query itself, then by how well the words match, then the newest.
-- An ISBN-13 (hyphens and spaces allowed; the client converts an ISBN-10) is
-- looked up by ISBN instead. At most `p_limit` Books, 50 at the very most.
-- Two branches rather than one OR, so each keeps its own indexable plan.
create or replace function public.search_books(p_query text, p_limit integer default 20)
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
     order by btrim(public.book_search_text(b.title, '{}')) = v_text desc,
              ts_rank(to_tsvector('simple'::regconfig, public.book_search_text(b.title, b.authors)), v_words) desc,
              b.created_at desc,
              b.id
     limit v_limit;
end;
$$;

comment on function public.search_books(text, integer) is
  'Catalogue search: the Books the caller can see (the Catalogue and her own Manual books) whose '
  'title and authors begin with the typed words, accents ignored; an ISBN-13 by ISBN. Best first.';

revoke all on function public.search_books(text, integer) from public, anon;
grant execute on function public.search_books(text, integer) to authenticated;
