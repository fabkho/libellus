-- Goodreads' community rating on the book page (issue #69).
--
-- The book page asks the `goodreads-rating` edge function for a Book's rating
-- by its ISBN-13 (supabase/functions/goodreads-rating). The function answers
-- from this table when the ISBN was checked within the last 30 days, and
-- otherwise asks Goodreads once (by ISBN, then by title and author), stores
-- what it learned here and answers with it. A miss is stored too, so an ISBN
-- Goodreads does not know is not asked about again for 30 days. A failed call
-- (Goodreads down, slow, refusing) is never stored: the next page view tries
-- again.
--
-- Keyed by ISBN-13, not by Book: a Book opened from search is not in the
-- Catalogue, and the same edition in the Catalogue finds its row by its ISBN
-- (`goodreads_rating(books)`, below). Only the rating, the two counts and the
-- Goodreads id for the link are kept; never review texts.
--
-- Shared like the Catalogue: every member reads it, only the service role
-- (the edge function) writes it.

create table public.goodreads_ratings (
  isbn13         text primary key,
  -- 'found': Goodreads knows the edition; 'not_found': neither the ISBN nor
  -- the title and author matched anything.
  status         text not null,
  -- How it was found: by the ISBN, or by title and author (the ISBN was
  -- unknown to Goodreads, a title search found the book).
  matched_by     text,
  -- Goodreads' book id: the link is https://www.goodreads.com/book/show/<id>.
  goodreads_id   text,
  -- The average over all editions of the work, 0–5, two decimals.
  rating         numeric(3, 2),
  ratings_count  integer,
  -- Ratings with a written review. Unknown (null) when found by title: the
  -- title search does not say.
  reviews_count  integer,
  checked_at     timestamptz not null default now(),

  constraint goodreads_ratings_isbn13_format check (isbn13 ~ '^97[89][0-9]{10}$'),
  constraint goodreads_ratings_status check (status in ('found', 'not_found')),
  constraint goodreads_ratings_matched_by check (matched_by in ('isbn', 'title')),
  constraint goodreads_ratings_id_format check (goodreads_id ~ '^[0-9]{1,20}$'),
  constraint goodreads_ratings_rating_range check (rating between 0 and 5),
  constraint goodreads_ratings_ratings_count check (ratings_count >= 0),
  constraint goodreads_ratings_reviews_count check (reviews_count >= 0),
  -- A found row has what the page shows; a miss has nothing but its time.
  constraint goodreads_ratings_found_complete check (
    case status
      when 'found' then goodreads_id is not null and rating is not null
                        and ratings_count is not null and matched_by is not null
      else goodreads_id is null and rating is null and ratings_count is null
           and reviews_count is null and matched_by is null
    end
  )
);

comment on table public.goodreads_ratings is
  'Goodreads'' rating and counts by ISBN-13 (issue #69), a cache the goodreads-rating edge function '
  'fills on demand and refreshes after 30 days. Misses are stored too. Readable by every member, '
  'written only by the service role. Never review texts.';

-- Several ISBNs (editions) can share one Goodreads book: found by its id too.
create index goodreads_ratings_goodreads_id on public.goodreads_ratings (goodreads_id)
  where goodreads_id is not null;

-- ------------------------------------------------------------------------ RLS

alter table public.goodreads_ratings enable row level security;

revoke all on public.goodreads_ratings from anon, authenticated;
grant select on public.goodreads_ratings to authenticated;
grant select, insert, update, delete on public.goodreads_ratings to service_role;

create policy goodreads_ratings_readable on public.goodreads_ratings
  for select to authenticated
  using (true);

-- ----------------------------------------------------- the Book's rating

-- A Book's found rating, by its ISBN-13. Exposed to PostgREST as a to-one
-- computed relationship (`books?select=*,goodreads:goodreads_rating(*)`), so
-- the Library loads every Book's rating with it and the device keeps it for
-- offline (web/app/data/library.ts, ENTRY_COLUMNS). A miss is not a rating.
create function public.goodreads_rating(public.books)
returns setof public.goodreads_ratings
language sql
stable
rows 1
set search_path = pg_catalog, public
as $$
  select g.*
    from public.goodreads_ratings g
   where g.isbn13 = $1.isbn13
     and g.status = 'found'
$$;

revoke all on function public.goodreads_rating(public.books) from public, anon;
grant execute on function public.goodreads_rating(public.books) to authenticated, service_role;
