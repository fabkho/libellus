-- Share with friends (issue #171, part of #166): a member's public reading page
-- and her Book cards.
--
-- One reading page per member, off until she turns it on (Profile → Share).
-- Turning it on gives it an unguessable address, `/r/<token>` (128 random bits,
-- 22 characters of base64url); turning it off forgets the token, and a new link
-- replaces it, so every address handed out before is dead (the page answers
-- 404). She chooses the sections it shows:
--
--   reading      Currently reading                      (the newest 6)
--   year         This year: the figures and the month row (counts only)
--   favourites   Her best rated Books, 4 stars and up    (the best 12)
--   finished     Recently finished, with her Ratings     (the newest 12)
--   shelf        Her shelf: the owner's is Regal's 3D row (the published library
--                file; nothing of it comes from here), anyone else's a row of
--                the covers she finished                (the newest 60)
--
-- A Book card (`/r/<token>/book/<book id>`) shows one Book with her Rating and,
-- when she chose so, her review. A card exists for a Book she shared from its
-- page (`reading_page_books`) and for every Book her page shows anyway; for any
-- other Book, or a dead token, it is "not found" (null), never "forbidden", so a
-- link cannot be used to probe her Library.
--
-- Reviews are hers until she shares one: `reading_page_books.review` is the
-- opt-in, per Book (the review of her latest finished read of it). Without it a
-- review never leaves the database, on the page or on the card.
--
-- What leaves the database for a visitor is built here, by two security-definer
-- functions anyone may call with a token (signed out included):
--
--   public_reading_page(token)          the page: only the sections she turned on
--   public_book_card(token, book)       one card
--
-- They return Books (title, authors, cover, year), her first name (the one the
-- greeting uses), Ratings, finish days, counts and the reviews she opted into.
-- Never her address, her id, notes, highlights, progress, reasons for
-- abandoning, collections or anything not listed. The Open Graph image
-- (supabase/functions/reading-page-og) and the address' link preview
-- (web/functions/r/[[path]].js) read these same functions.
--
-- Writing, all for the signed-in member herself:
--   set_reading_page(on)              on: a token if there is none; off: none
--   renew_reading_page_link()         a new token; the old address 404s
--   set_reading_page_sections(json)   { "reading": true, "shelf": false, … }
--   share_book_card(book, review)     the Book's card, with or without her review
--   unshare_book_card(book)           the card is gone (unless the page shows the Book anyway)
--
-- Refusals: not_signed_in (42501), reading_page_off (22023: a link or a card
-- while the page is off), reading_page_sections_invalid (22023), entry_not_found
-- (P0002: a Book that is not in her Library).
--
-- Deleted with the member (auth.users cascades); a Book's card with the entry.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- --------------------------------------------------------------------- tables

create table public.reading_pages (
  member_id        uuid primary key references auth.users on delete cascade,
  -- The address' secret; null = the page is off.
  token            text unique,
  show_reading     boolean not null default true,
  show_year        boolean not null default true,
  show_favourites  boolean not null default true,
  show_finished    boolean not null default true,
  show_shelf       boolean not null default true,
  updated_at       timestamptz not null default now(),
  constraint reading_pages_token_format check (token ~ '^[A-Za-z0-9_-]{22}$')
);

comment on table public.reading_pages is
  'Issue #171: a member''s public reading page. token null = off; the sections she shows. '
  'Read by its member; written only through the functions in 20261011030000_reading_pages.sql.';

create table public.reading_page_books (
  member_id  uuid not null references auth.users on delete cascade,
  book_id    uuid not null references public.books on delete cascade,
  -- Her review of the Book (the latest finished read's) is shown on her page and card.
  review     boolean not null default false,
  shared_at  timestamptz not null default now(),
  primary key (member_id, book_id)
);

create index reading_page_books_book on public.reading_page_books (book_id);

comment on table public.reading_page_books is
  'Issue #171: the Books a member shared as a card, and whether her review goes with it.';

alter table public.reading_pages enable row level security;
alter table public.reading_page_books enable row level security;

revoke all on public.reading_pages from anon, authenticated;
revoke all on public.reading_page_books from anon, authenticated;
grant select on public.reading_pages to authenticated;
grant select on public.reading_page_books to authenticated;

create policy reading_pages_select_own on public.reading_pages
  for select to authenticated using (member_id = (select auth.uid()));
create policy reading_page_books_select_own on public.reading_page_books
  for select to authenticated using (member_id = (select auth.uid()));

-- ------------------------------------------------------------------- helpers

-- A fresh token: 16 random bytes as base64url, 22 characters.
create or replace function private.reading_page_token()
returns text
language sql
volatile
set search_path = pg_catalog
as $$
  select translate(rtrim(encode(extensions.gen_random_bytes(16), 'base64'), '='), '+/', '-_')
$$;

-- What a visitor sees of a Book.
create or replace function private.reading_page_book_json(p_book public.books)
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'id', p_book.id,
    'title', p_book.title,
    'authors', to_jsonb(p_book.authors),
    'published_year', p_book.published_year,
    'cover_url', p_book.cover_url,
    'cover_thumbhash', p_book.cover_thumbhash,
    'cover_dominant', p_book.cover_dominant,
    'cover_secondary', p_book.cover_secondary
  )
$$;

-- Her finished reads, each with its place among the entry's finished reads (1 = first).
create or replace function private.reading_page_reads(p_member uuid)
returns table (entry_id uuid, book_id uuid, session_id uuid, started_on date, ended_on date,
               rating smallint, review text, pages integer, created_at timestamptz, nth bigint)
language sql
stable
set search_path = pg_catalog, public
as $$
  select e.id, e.book_id, s.id, s.started_on, s.ended_on, s.rating, s.review,
         coalesce(e.page_count_override, b.page_count), s.created_at,
         row_number() over (partition by e.id order by s.ended_on nulls first, s.created_at)
    from public.library_entries e
    join public.reading_sessions s on s.entry_id = e.id
    join public.books b on b.id = e.book_id
   where e.member_id = p_member and s.outcome = 'finished'
$$;

-- Currently reading: the newest started first.
create or replace function private.reading_page_reading(p_member uuid)
returns table (book_id uuid, started_on date)
language sql
stable
set search_path = pg_catalog, public
as $$
  select e.book_id, s.started_on
    from public.library_entries e
    join public.reading_sessions s on s.entry_id = e.id and s.outcome is null
   where e.member_id = p_member
   order by s.started_on desc nulls last, s.created_at desc
   limit 6
$$;

-- Favourites: each Book's best Rating, 4 stars (16 quarters) and up; the best, then the latest finished, first.
create or replace function private.reading_page_favourites(p_member uuid)
returns table (book_id uuid, rating smallint, ended_on date)
language sql
stable
set search_path = pg_catalog, public
as $$
  select book_id, rating, ended_on from (
    select distinct on (r.book_id) r.book_id, r.rating, r.ended_on, r.created_at
      from private.reading_page_reads(p_member) r
     where r.rating >= 16
     order by r.book_id, r.rating desc, r.ended_on desc nulls last, r.created_at desc
  ) best
  order by rating desc, ended_on desc nulls last, created_at desc
  limit 12
$$;

-- Recently finished: each Book's latest finished read, the newest first.
create or replace function private.reading_page_finished(p_member uuid, p_limit integer)
returns table (book_id uuid, ended_on date, rating smallint, review text)
language sql
stable
set search_path = pg_catalog, public
as $$
  select book_id, ended_on, rating, review from (
    select distinct on (r.book_id) r.book_id, r.ended_on, r.rating, r.review, r.created_at
      from private.reading_page_reads(p_member) r
     order by r.book_id, r.ended_on desc nulls last, r.created_at desc
  ) latest
  order by ended_on desc nulls last, created_at desc
  limit p_limit
$$;

-- Whether this member's shelf is Regal's: the owner whose Library the published library file is (#110).
create or replace function private.reading_page_has_regal(p_member uuid)
returns boolean
language sql
stable
set search_path = pg_catalog, private
as $$
  select exists (select 1 from private.shelf_publish where owner_id = p_member)
$$;

-- The Books the page shows, whichever section shows them.
create or replace function private.reading_page_shown_books(p_page public.reading_pages)
returns setof uuid
language sql
stable
set search_path = pg_catalog, public, private
as $$
  select book_id from private.reading_page_reading(p_page.member_id) where p_page.show_reading
  union
  select book_id from private.reading_page_favourites(p_page.member_id) where p_page.show_favourites
  union
  select book_id from private.reading_page_finished(p_page.member_id, 12) where p_page.show_finished
  union
  select book_id from private.reading_page_finished(p_page.member_id, 60)
   where p_page.show_shelf and not private.reading_page_has_regal(p_page.member_id)
$$;

-- Her first name, as the greeting keeps it (user_metadata.name), or null.
create or replace function private.reading_page_name(p_member uuid)
returns text
language sql
stable
set search_path = pg_catalog, auth
as $$
  select nullif(btrim(raw_user_meta_data ->> 'name'), '') from auth.users where id = p_member
$$;

-- Her review of a Book, when she shared it.
create or replace function private.reading_page_review(p_member uuid, p_book uuid, p_review text)
returns text
language sql
stable
set search_path = pg_catalog, public
as $$
  select case when exists (
    select 1 from public.reading_page_books where member_id = p_member and book_id = p_book and review
  ) then p_review end
$$;

-- This year (UTC): the figures and the month row, counts only.
create or replace function private.reading_page_year(p_member uuid)
returns jsonb
language sql
stable
set search_path = pg_catalog, public, private
as $$
  with year as (select extract(year from now() at time zone 'utc')::int as y),
  reads as (
    select r.* from private.reading_page_reads(p_member) r, year
     where extract(year from r.ended_on)::int = year.y
  )
  select jsonb_build_object(
    'year', (select y from year),
    'books', (select count(*) from reads),
    'pages', (select coalesce(sum(pages), 0) from reads),
    'pages_missing', (select count(*) from reads where pages is null),
    'rated', (select count(*) from reads where rating is not null),
    'unrated', (select count(*) from reads where rating is null),
    'average', (select avg(rating)::float8 from reads),
    'median_days', (select round(percentile_cont(0.5) within group (order by ended_on - started_on + 1))::int
                      from reads where started_on is not null),
    'rereads', (select count(*) from reads where nth > 1),
    'months', (select jsonb_agg((select count(*) from reads where extract(month from ended_on)::int = m) order by m)
                 from generate_series(1, 12) m)
  )
$$;

revoke all on function private.reading_page_token() from public, anon, authenticated;
revoke all on function private.reading_page_book_json(public.books) from public, anon, authenticated;
revoke all on function private.reading_page_reads(uuid) from public, anon, authenticated;
revoke all on function private.reading_page_reading(uuid) from public, anon, authenticated;
revoke all on function private.reading_page_favourites(uuid) from public, anon, authenticated;
revoke all on function private.reading_page_finished(uuid, integer) from public, anon, authenticated;
revoke all on function private.reading_page_has_regal(uuid) from public, anon, authenticated;
revoke all on function private.reading_page_shown_books(public.reading_pages) from public, anon, authenticated;
revoke all on function private.reading_page_name(uuid) from public, anon, authenticated;
revoke all on function private.reading_page_review(uuid, uuid, text) from public, anon, authenticated;
revoke all on function private.reading_page_year(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------------ her side

-- Turns the page on (a token if there is none, so it keeps its address while on) or off (none).
create or replace function public.set_reading_page(p_on boolean)
returns public.reading_pages
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_member uuid := auth.uid();
  v_row    public.reading_pages;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  insert into public.reading_pages as p (member_id, token)
  values (v_member, case when p_on then private.reading_page_token() end)
  on conflict (member_id) do update
    set token = case when p_on then coalesce(p.token, excluded.token) end,
        updated_at = now()
  returning p.* into v_row;
  return v_row;
end;
$$;

-- A new address for the page; the old one is dead from now on.
create or replace function public.renew_reading_page_link()
returns public.reading_pages
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_member uuid := auth.uid();
  v_row    public.reading_pages;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  update public.reading_pages
     set token = private.reading_page_token(), updated_at = now()
   where member_id = v_member and token is not null
  returning * into v_row;
  if not found then
    raise exception 'reading_page_off' using errcode = '22023';
  end if;
  return v_row;
end;
$$;

-- The sections, by name; the ones not named keep what they were.
create or replace function public.set_reading_page_sections(p_sections jsonb)
returns public.reading_pages
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member uuid := auth.uid();
  v_key    text;
  v_row    public.reading_pages;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_sections is null or jsonb_typeof(p_sections) <> 'object' then
    raise exception 'reading_page_sections_invalid' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_sections) loop
    if v_key not in ('reading', 'year', 'favourites', 'finished', 'shelf')
       or jsonb_typeof(p_sections -> v_key) <> 'boolean' then
      raise exception 'reading_page_sections_invalid' using errcode = '22023';
    end if;
  end loop;

  insert into public.reading_pages (member_id) values (v_member) on conflict (member_id) do nothing;
  update public.reading_pages
     set show_reading    = coalesce((p_sections ->> 'reading')::boolean, show_reading),
         show_year       = coalesce((p_sections ->> 'year')::boolean, show_year),
         show_favourites = coalesce((p_sections ->> 'favourites')::boolean, show_favourites),
         show_finished   = coalesce((p_sections ->> 'finished')::boolean, show_finished),
         show_shelf      = coalesce((p_sections ->> 'shelf')::boolean, show_shelf),
         updated_at      = now()
   where member_id = v_member
  returning * into v_row;
  return v_row;
end;
$$;

-- A Book's card, with or without her review; again: changes only whether the review goes with it.
create or replace function public.share_book_card(p_book uuid, p_review boolean)
returns public.reading_page_books
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member uuid := auth.uid();
  v_row    public.reading_page_books;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if not exists (select 1 from public.reading_pages where member_id = v_member and token is not null) then
    raise exception 'reading_page_off' using errcode = '22023';
  end if;
  if not exists (select 1 from public.library_entries where member_id = v_member and book_id = p_book) then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;
  insert into public.reading_page_books as c (member_id, book_id, review)
  values (v_member, p_book, coalesce(p_review, false))
  on conflict (member_id, book_id) do update set review = excluded.review
  returning c.* into v_row;
  return v_row;
end;
$$;

create or replace function public.unshare_book_card(p_book uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  delete from public.reading_page_books where member_id = auth.uid() and book_id = p_book;
end;
$$;

-- A Book leaves her Library: its card goes with it.
create or replace function private.reading_page_books_entry_gone()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  delete from public.reading_page_books where member_id = old.member_id and book_id = old.book_id;
  return old;
end;
$$;

revoke all on function private.reading_page_books_entry_gone() from public, anon, authenticated;

create trigger reading_page_books_entry_gone
  after delete on public.library_entries
  for each row execute function private.reading_page_books_entry_gone();

-- An edition change (change_edition) moves the entry to another Book: the card follows.
create or replace function private.reading_page_books_entry_moved()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.book_id is distinct from old.book_id then
    update public.reading_page_books set book_id = new.book_id
     where member_id = new.member_id and book_id = old.book_id
       and not exists (select 1 from public.reading_page_books where member_id = new.member_id and book_id = new.book_id);
    delete from public.reading_page_books where member_id = new.member_id and book_id = old.book_id;
  end if;
  return new;
end;
$$;

revoke all on function private.reading_page_books_entry_moved() from public, anon, authenticated;

create trigger reading_page_books_entry_moved
  after update of book_id on public.library_entries
  for each row execute function private.reading_page_books_entry_moved();

revoke all on function public.set_reading_page(boolean) from public, anon;
revoke all on function public.renew_reading_page_link() from public, anon;
revoke all on function public.set_reading_page_sections(jsonb) from public, anon;
revoke all on function public.share_book_card(uuid, boolean) from public, anon;
revoke all on function public.unshare_book_card(uuid) from public, anon;
grant execute on function public.set_reading_page(boolean) to authenticated;
grant execute on function public.renew_reading_page_link() to authenticated;
grant execute on function public.set_reading_page_sections(jsonb) to authenticated;
grant execute on function public.share_book_card(uuid, boolean) to authenticated;
grant execute on function public.unshare_book_card(uuid) to authenticated;

-- ------------------------------------------------------------ the visitor's side

-- The page behind a token, or null (no such token: off, renewed, never was).
create or replace function public.public_reading_page(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_page   public.reading_pages;
  v_result jsonb;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{22}$' then
    return null;
  end if;
  select * into v_page from public.reading_pages where token = p_token;
  if not found then
    return null;
  end if;

  v_result := jsonb_build_object(
    'name', private.reading_page_name(v_page.member_id),
    'sections', jsonb_build_object(
      'reading', v_page.show_reading, 'year', v_page.show_year, 'favourites', v_page.show_favourites,
      'finished', v_page.show_finished, 'shelf', v_page.show_shelf));

  if v_page.show_reading then
    v_result := v_result || jsonb_build_object('reading', (
      select coalesce(jsonb_agg(jsonb_build_object('book', private.reading_page_book_json(b), 'started_on', r.started_on)
                                order by r.started_on desc nulls last), '[]'::jsonb)
        from private.reading_page_reading(v_page.member_id) r join public.books b on b.id = r.book_id));
  end if;

  if v_page.show_year then
    v_result := v_result || jsonb_build_object('year', private.reading_page_year(v_page.member_id));
  end if;

  if v_page.show_favourites then
    v_result := v_result || jsonb_build_object('favourites', (
      select coalesce(jsonb_agg(jsonb_build_object('book', private.reading_page_book_json(b), 'rating', f.rating)
                                order by f.rating desc, f.ended_on desc nulls last), '[]'::jsonb)
        from private.reading_page_favourites(v_page.member_id) f join public.books b on b.id = f.book_id));
  end if;

  if v_page.show_finished then
    v_result := v_result || jsonb_build_object('finished', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'book', private.reading_page_book_json(b), 'ended_on', f.ended_on, 'rating', f.rating,
               'review', private.reading_page_review(v_page.member_id, f.book_id, f.review))
             order by f.ended_on desc nulls last), '[]'::jsonb)
        from private.reading_page_finished(v_page.member_id, 12) f join public.books b on b.id = f.book_id));
  end if;

  if v_page.show_shelf then
    if private.reading_page_has_regal(v_page.member_id) then
      v_result := v_result || jsonb_build_object('shelf', jsonb_build_object('kind', 'regal'));
    else
      v_result := v_result || jsonb_build_object('shelf', jsonb_build_object('kind', 'covers', 'books', (
        select coalesce(jsonb_agg(private.reading_page_book_json(b) order by f.ended_on desc nulls last), '[]'::jsonb)
          from private.reading_page_finished(v_page.member_id, 60) f join public.books b on b.id = f.book_id)));
    end if;
  end if;

  return v_result;
end;
$$;

-- One Book's card behind a token, or null (no such token, or a Book the page neither shows nor shares).
create or replace function public.public_book_card(p_token text, p_book uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_page   public.reading_pages;
  v_entry  public.library_entries;
  v_book   public.books;
  v_ended  date;
  v_rating smallint;
  v_review text;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{22}$' or p_book is null then
    return null;
  end if;
  select * into v_page from public.reading_pages where token = p_token;
  if not found then
    return null;
  end if;
  select * into v_entry from public.library_entries where member_id = v_page.member_id and book_id = p_book;
  if not found then
    return null;
  end if;
  if not exists (select 1 from public.reading_page_books where member_id = v_page.member_id and book_id = p_book)
     and p_book not in (select private.reading_page_shown_books(v_page)) then
    return null;
  end if;

  select * into v_book from public.books where id = p_book;
  select r.ended_on, r.rating, r.review into v_ended, v_rating, v_review
    from private.reading_page_reads(v_page.member_id) r
   where r.book_id = p_book
   order by r.ended_on desc nulls last, r.created_at desc
   limit 1;

  return jsonb_build_object(
    'name', private.reading_page_name(v_page.member_id),
    'book', private.reading_page_book_json(v_book),
    'status', v_entry.status,
    'ended_on', v_ended,
    'rating', v_rating,
    'review', private.reading_page_review(v_page.member_id, p_book, v_review));
end;
$$;

revoke all on function public.public_reading_page(text) from public;
revoke all on function public.public_book_card(text, uuid) from public;
grant execute on function public.public_reading_page(text) to anon, authenticated;
grant execute on function public.public_book_card(text, uuid) to anon, authenticated;

comment on function public.public_reading_page(text) is
  'Issue #171: a member''s reading page for anyone with its link: only the sections she turned on, '
  'never her address, id, notes or highlights. Null when the token is unknown (off, renewed).';
comment on function public.public_book_card(text, uuid) is
  'Issue #171: one Book''s card under a reading page''s link: a Book she shared, or one her page shows. '
  'Her review only when she shared it. Null otherwise.';
