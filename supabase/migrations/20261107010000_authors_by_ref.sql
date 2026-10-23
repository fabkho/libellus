-- The author name on a Book page always links to her page (#167 follow-up). A Book that is not in the
-- Catalogue (a search result, a work opened from an author's page that nobody has added) has no
-- book_authors rows, so book_authors_of answered nothing and the name stayed plain text. This asks
-- for the authors by what the page does know about the Book, whatever the Catalogue holds:
--
--   p_keys   Open Library author ids the source gave for the credited names (a search result has them)
--   p_work   the Open Library work key: the authors of the work row the author pages are built from
--   p_names  the credited names, matched to an author row by name as people write it (case, accents,
--            dots and spacing aside); of several rows with one name the one with the most works wins
--
-- One row per hit: `ref` is the key asked by (p_keys) or the name asked by (p_names), null for the
-- work's own authors. Translators and introducers are not asked for: the client sends only the
-- names authorParts keeps as authors. Security invoker: it reads only what RLS lets her read (every
-- member reads authors and works).

-- A name as authors are compared: unaccented, lower case, dots and runs of spaces as one space.
create function public.author_name_key(p_name text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select btrim(lower(extensions.unaccent('extensions.unaccent'::regdictionary, regexp_replace(coalesce(p_name, ''), '[.[:space:]]+', ' ', 'g'))))
$$;

comment on function public.author_name_key(text) is
  'An author''s name as authors_by_ref compares it: unaccented, lower case, dots and spacing as one space. Behind authors_name_key.';

create index authors_name_key on public.authors (public.author_name_key(name));

create function public.authors_by_ref(p_work text, p_names text[], p_keys text[])
returns table (ref text, credit_position smallint, name text, author_id uuid, author_key text)
language sql
stable
set search_path = pg_catalog, public
as $$
  select a.openlibrary_key, 1::smallint, a.name, a.id, coalesce(a.wikidata_id, a.openlibrary_key, a.id::text)
    from public.authors a
   where a.openlibrary_key = any(coalesce(p_keys[1:20], '{}'))
  union all
  select null, wa.position, a.name, a.id, coalesce(a.wikidata_id, a.openlibrary_key, a.id::text)
    from public.works w
    join public.work_authors wa on wa.work_id = w.id
    join public.authors a on a.id = wa.author_id
   where w.openlibrary_key = p_work
  union all
  select n.name, 1::smallint, a.name, a.id, coalesce(a.wikidata_id, a.openlibrary_key, a.id::text)
    from unnest(coalesce(p_names[1:20], '{}')) as n(name)
    cross join lateral (
      select x.*
        from public.authors x
       where public.author_name_key(x.name) = public.author_name_key(n.name)
       order by (select count(*) from public.work_authors w where w.author_id = x.id) desc,
                (x.wikidata_id is not null) desc, x.created_at, x.id
       limit 1
    ) a
   where public.author_name_key(n.name) <> ''
$$;

comment on function public.authors_by_ref(text, text[], text[]) is
  'The authors of a Book that may not be in the Catalogue: by Open Library author id, by the work''s authors, by credited name. ref says what a row answers.';

revoke all on function public.author_name_key(text) from public, anon;
grant execute on function public.author_name_key(text) to authenticated, service_role;
revoke all on function public.authors_by_ref(text, text[], text[]) from public, anon;
grant execute on function public.authors_by_ref(text, text[], text[]) to authenticated, service_role;
