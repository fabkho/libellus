-- Goodreads' rating for a Book without an ISBN.
--
-- `goodreads_ratings` is keyed by ISBN-13, so a Book without one (14 of the 132
-- entries in the owner's Library) was never asked about and showed no rating.
-- The `goodreads-rating` edge function now looks such a Book up by its title and
-- first author alone (the title search it already uses as the fallback for an
-- unknown ISBN) and caches the answer here, keyed by what it asked with: the
-- Book's normalised title and its authors' normalised surnames, sorted
-- ("something wicked this way comes|bradbury"). Keyed by the question, not by
-- the Book, so the same title twice in the Catalogue shares one row, a Book
-- opened from search needs no id, and a caller cannot write a row about a Book
-- other than the one it names. `goodreads_ratings` and `goodreads_rating(books)`
-- are not touched.
--
-- Same shape and same rules as `goodreads_ratings`: every member reads it, only
-- the service role writes it; a found row has what the page shows, a miss
-- nothing but its time (the function asks a miss again after 7 days, a found
-- rating after 30). Only the rating, the two counts and the Goodreads id are
-- kept; never review texts, never member data: the key is catalogue data.

create table public.goodreads_title_ratings (
  title_key      text primary key,
  status         text not null,
  -- Always 'title': this table is only ever filled by the title search.
  matched_by     text,
  goodreads_id   text,
  rating         numeric(3, 2),
  ratings_count  integer,
  -- Unknown (null): the title search does not say.
  reviews_count  integer,
  checked_at     timestamptz not null default now(),

  constraint goodreads_title_ratings_key_format check (
    title_key ~ '^[^|]+[|][^|]+$' and char_length(title_key) <= 1000
  ),
  constraint goodreads_title_ratings_status check (status in ('found', 'not_found')),
  constraint goodreads_title_ratings_matched_by check (matched_by = 'title'),
  constraint goodreads_title_ratings_id_format check (goodreads_id ~ '^[0-9]{1,20}$'),
  constraint goodreads_title_ratings_rating_range check (rating between 0 and 5),
  constraint goodreads_title_ratings_ratings_count check (ratings_count >= 0),
  constraint goodreads_title_ratings_reviews_count check (reviews_count >= 0),
  constraint goodreads_title_ratings_found_complete check (
    case status
      when 'found' then goodreads_id is not null and rating is not null
                        and ratings_count is not null and matched_by is not null
      else goodreads_id is null and rating is null and ratings_count is null
           and reviews_count is null and matched_by is null
    end
  )
);

comment on table public.goodreads_title_ratings is
  'Goodreads'' rating for a Book without an ISBN, by its normalised title and author surnames, a cache '
  'the goodreads-rating edge function fills on demand (found: refreshed after 30 days; a miss: after '
  '7). Readable by every member, written only by the service role. Never review texts.';

alter table public.goodreads_title_ratings enable row level security;

revoke all on public.goodreads_title_ratings from anon, authenticated;
grant select on public.goodreads_title_ratings to authenticated;
grant select, insert, update, delete on public.goodreads_title_ratings to service_role;

create policy goodreads_title_ratings_readable on public.goodreads_title_ratings
  for select to authenticated
  using (true);
