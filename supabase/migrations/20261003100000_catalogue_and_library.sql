-- The Catalogue and the Library (issue #1, Data model; issue #6).
--
-- `books` holds one row per edition. Books found on Apple Books or OpenLibrary
-- enter the shared Catalogue (no owner) the first time a member adds one, and
-- are readable by every member from then on. Manual books (#13) live in the
-- same table with an owner and are private to them. `library_entries` is one
-- Book in one member's Library.
--
-- Members never write either table directly: everything goes through
-- `add_to_library`, one call that puts the Book into the Catalogue (or finds
-- it there) and creates the entry, so a native client gets the same rules.

-- ---------------------------------------------------------------------- types

create type public.book_source as enum ('apple', 'openlibrary', 'manual', 'import');

-- The exclusive state of an entry. Today every entry is `want_to_read`; once
-- reading sessions land (#7) a trigger derives it from them (no session → want
-- to read, latest open → reading, latest closed → finished) and clients still
-- never write it.
create type public.entry_status as enum ('want_to_read', 'reading', 'finished');

-- ---------------------------------------------------------------------- books

create table public.books (
  id                        uuid primary key default gen_random_uuid(),
  title                     text not null,
  -- In the order the edition credits them.
  authors                   text[] not null default '{}',
  isbn13                    text,
  isbn10                    text,
  page_count                integer,
  published_year            smallint,
  language                  text,
  publisher                 text,
  description               text,
  -- Resolved once, when the Book enters the Catalogue: a large image URL, its
  -- thumbhash (base64) to show while it loads, and its two dominant colours for
  -- the light it throws (components/ui/Cover.vue, Ambient.vue).
  cover_url                 text,
  cover_thumbhash           text,
  cover_dominant            text,
  cover_secondary           text,
  source                    public.book_source not null,
  -- Where the snapshot came from. Apple's track id, OpenLibrary's edition and
  -- work keys (the work key is shared by many editions, so it is not unique).
  apple_id                  text,
  openlibrary_edition_key   text,
  openlibrary_work_key      text,
  -- Set for Manual books only: their member. Catalogue Books have none.
  owner_id                  uuid references auth.users on delete cascade,
  created_at                timestamptz not null default now(),

  constraint books_title_present check (char_length(btrim(title)) between 1 and 500),
  constraint books_authors_present check (array_position(authors, null) is null),
  constraint books_isbn13_format check (isbn13 ~ '^97[89][0-9]{10}$'),
  constraint books_isbn10_format check (isbn10 ~ '^[0-9]{9}[0-9X]$'),
  constraint books_page_count_positive check (page_count > 0),
  constraint books_year_plausible check (published_year between 1 and 2100),
  constraint books_cover_dominant_hex check (cover_dominant ~ '^#[0-9a-f]{6}$'),
  constraint books_cover_secondary_hex check (cover_secondary ~ '^#[0-9a-f]{6}$'),
  constraint books_apple_id_format check (apple_id ~ '^[0-9]+$'),
  -- Manual books, and only they, belong to a member.
  constraint books_owner_iff_manual check ((source = 'manual') = (owner_id is not null)),
  -- A Catalogue Book is always findable again by one of its keys.
  constraint books_catalogue_key check (
    source = 'manual' or coalesce(isbn13, apple_id, openlibrary_edition_key) is not null
  )
);

comment on table public.books is
  'One edition. Catalogue Books (no owner) are shared and readable by every member; Manual '
  'books belong to their owner. Written only through add_to_library (and later the manual-book '
  'and import paths), never directly by a member.';

-- One Catalogue Book per edition: by ISBN-13, and by each source identifier.
-- Manual books may repeat an ISBN (two members typing in the same book).
create unique index books_catalogue_isbn13 on public.books (isbn13)
  where owner_id is null and isbn13 is not null;
create unique index books_apple_id on public.books (apple_id)
  where apple_id is not null;
create unique index books_openlibrary_edition_key on public.books (openlibrary_edition_key)
  where openlibrary_edition_key is not null;
create index books_owner on public.books (owner_id) where owner_id is not null;

-- ------------------------------------------------------------ library entries

create table public.library_entries (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references auth.users on delete cascade,
  book_id     uuid not null references public.books on delete restrict,
  status      public.entry_status not null default 'want_to_read',
  added_at    timestamptz not null default now(),
  constraint library_entries_once_per_book unique (member_id, book_id)
);

comment on table public.library_entries is
  'One Book in one member''s Library. Private to its member. Created by add_to_library; the '
  'status follows from the reading sessions (#7) and is never written by a client.';

create index library_entries_by_status on public.library_entries (member_id, status, added_at desc);
create index library_entries_book on public.library_entries (book_id);

-- ------------------------------------------------------------------------ RLS

alter table public.books enable row level security;
alter table public.library_entries enable row level security;

-- Supabase grants everything on a new public table to the API roles; these
-- tables want the opposite. Members read; every write is a function below.
revoke all on public.books from anon, authenticated;
revoke all on public.library_entries from anon, authenticated;
grant select on public.books to authenticated;
grant select on public.library_entries to authenticated;

create policy books_readable on public.books
  for select to authenticated
  using (owner_id is null or owner_id = (select auth.uid()));

create policy library_entries_own on public.library_entries
  for select to authenticated
  using (member_id = (select auth.uid()));

-- ------------------------------------------------------------- add_to_library

-- Puts a Book into the member's Library in one call: finds the Catalogue Book
-- by ISBN-13 or a source identifier, or adds the given snapshot to the
-- Catalogue (the first snapshot is kept; a later add never rewrites it), then
-- creates the entry. Returns the entry.
--
-- `p_book` carries the columns of `books` by name (title, authors, isbn13,
-- apple_id, cover_url, …); id, owner and created at are the database's.
-- `p_status` is `want_to_read` for now; #9 lets the sheet add straight to
-- Currently reading or Finished, with the session that implies.
--
-- Refusals, as `raise` messages with stable SQLSTATEs:
--   not_signed_in        42501  no member behind the call
--   status_unsupported   22023  a status this version cannot add with yet
--   book_invalid         22023  no title, a manual source, or no key to find it by
--   already_in_library   23505  the member already has this Book
create or replace function public.add_to_library(
  p_book jsonb,
  p_status public.entry_status default 'want_to_read'
)
returns public.library_entries
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_member uuid := auth.uid();
  v_book   public.books;
  v_id     uuid;
  v_entry  public.library_entries;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_status is distinct from 'want_to_read' then
    raise exception 'status_unsupported' using errcode = '22023';
  end if;
  if p_book is null or jsonb_typeof(p_book) <> 'object' then
    raise exception 'book_invalid' using errcode = '22023';
  end if;

  v_book := jsonb_populate_record(null::public.books, p_book);
  -- Normalised here too, so every client finds the same row.
  v_book.title   := nullif(btrim(v_book.title), '');
  v_book.isbn13  := nullif(upper(regexp_replace(v_book.isbn13, '[^0-9Xx]', '', 'g')), '');
  v_book.isbn10  := nullif(upper(regexp_replace(v_book.isbn10, '[^0-9Xx]', '', 'g')), '');
  v_book.authors := coalesce(
    (select array_agg(btrim(a) order by n) from unnest(v_book.authors) with ordinality as t(a, n)
      where nullif(btrim(a), '') is not null),
    '{}'
  );

  if v_book.title is null
     or v_book.source is null
     or v_book.source = 'manual'
     or coalesce(v_book.isbn13, v_book.apple_id, v_book.openlibrary_edition_key) is null then
    raise exception 'book_invalid' using errcode = '22023';
  end if;

  -- An ISBN match wins over a source match: the same edition found through
  -- another source is still the same Book.
  select id into v_id from public.books
   where owner_id is null and v_book.isbn13 is not null and isbn13 = v_book.isbn13;
  if v_id is null then
    select id into v_id from public.books
     where owner_id is null
       and ((v_book.apple_id is not null and apple_id = v_book.apple_id)
         or (v_book.openlibrary_edition_key is not null
             and openlibrary_edition_key = v_book.openlibrary_edition_key))
     limit 1;
  end if;

  if v_id is null then
    -- Two members adding the same new Book at once: the loser's insert does
    -- nothing and it finds the winner's row instead.
    insert into public.books (
      title, authors, isbn13, isbn10, page_count, published_year, language, publisher,
      description, cover_url, cover_thumbhash, cover_dominant, cover_secondary, source,
      apple_id, openlibrary_edition_key, openlibrary_work_key
    ) values (
      v_book.title, v_book.authors, v_book.isbn13, v_book.isbn10, v_book.page_count,
      v_book.published_year, v_book.language, v_book.publisher, v_book.description,
      v_book.cover_url, v_book.cover_thumbhash, lower(v_book.cover_dominant),
      lower(v_book.cover_secondary), v_book.source, v_book.apple_id,
      v_book.openlibrary_edition_key, v_book.openlibrary_work_key
    )
    on conflict do nothing
    returning id into v_id;

    if v_id is null then
      select id into v_id from public.books
       where owner_id is null
         and ((v_book.isbn13 is not null and isbn13 = v_book.isbn13)
           or (v_book.apple_id is not null and apple_id = v_book.apple_id)
           or (v_book.openlibrary_edition_key is not null
               and openlibrary_edition_key = v_book.openlibrary_edition_key))
       limit 1;
    end if;
  end if;

  begin
    insert into public.library_entries (member_id, book_id, status)
    values (v_member, v_id, p_status)
    returning * into v_entry;
  exception when unique_violation then
    raise exception 'already_in_library' using errcode = '23505';
  end;

  return v_entry;
end;
$$;

revoke all on function public.add_to_library(jsonb, public.entry_status) from public, anon;
grant execute on function public.add_to_library(jsonb, public.entry_status) to authenticated;
