-- Issue #167, phase 2: the linked authors of many Books at once, so a list
-- (her Library's rows, a page of search results) can open an author's page
-- from the author line without asking once per row. The same answer as
-- book_authors_of, per Book: the Book's real authors in credit order (a
-- translator or an introducer the edition credits is not linked), with the
-- key their page is opened by (Wikidata item, else Open Library id, else the
-- row's uuid). Security invoker: it reads only what RLS lets her read.

create function public.book_authors_for(p_books uuid[])
returns table (book_id uuid, credit_position smallint, name text, author_id uuid, author_key text)
language sql
stable
set search_path = pg_catalog, public
as $$
  select ba.book_id, ba.position, a.name, a.id, coalesce(a.wikidata_id, a.openlibrary_key, a.id::text)
    from public.book_authors ba
    join public.authors a on a.id = ba.author_id
   where ba.book_id = any(p_books)
   order by ba.book_id, ba.position
$$;

comment on function public.book_authors_for(uuid[]) is
  'Issue #167: the linked authors of many Books (a list''s rows), per Book in credit order, with the key their page is opened by.';

revoke all on function public.book_authors_for(uuid[]) from public, anon;
grant execute on function public.book_authors_for(uuid[]) to authenticated, service_role;
