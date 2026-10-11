-- A review that is only a rating is the rating, not a review (owner's decisions, social v2a).
--
-- Goodreads has whole stars only, so some members typed the finer rating into the review box: "4.6", "5/5",
-- "4.5/5", "4.6/10" (a typo for /5: ratings are out of 5). The number they wrote is their real rating. The app's
-- imports no longer keep such a text as a review and let its number win over the row's whole-star rating
-- (web/app/utils/ratingReview.ts: `isRatingOnlyReview`, `ratingFromReviewText`, `splitRatingReview` in
-- data/import/rows.ts; pinned by web/tests/rating-review.test.ts). This migration applies the same rule to reads
-- already imported. For a FINISHED read whose review is only a rating (abandoned reads are left as they are: they
-- have no rating to give it to):
--
--   rating  the text's number, rounded DOWN to the quarter steps a rating has (integer quarters 1..20: 4.6 -> 18,
--           4.3 -> 17, 4.9 -> 19, 5 -> 20, 3 -> 12), when
--             - the read has no rating, or
--             - `reading_sessions.import_key` is set (an import wrote the read) AND the rating is a whole star
--               (a multiple of 4), for every source: the exporting apps' whole-star ratings give way to the number
--               the reader wrote. A quarter or half rating is not a whole star, so it was set after the import
--               (Hardcover's half stars too) and stays. import_key is not proof the stored rating is the import's
--               (the app never clears it on an edit), so a rating she set in the app that happens to be a whole
--               star on an imported read is overwritten as well: accepted, the rule is "the text is the real rating".
--             A read with no import_key keeps the rating it has.
--   review  null, with review_spoilers false, ONLY where the read's rating now equals the text's number, or the
--           text says no rating (0): nothing is lost. Otherwise the text stays.
--
-- Before the update the rows it changes are copied to private.rating_only_reviews_backup (id, rating, review,
-- review_spoilers, at; no grants): the change is one-shot and cannot be undone otherwise. A LATER RELEASE DROPS THAT
-- TABLE once the owner has looked at it. A second run copies and changes nothing.
--
-- The text is: optional spaces, a number with `.` or `,`, optionally `/5` or `/10`, optionally `★` or `stars`
-- (any case), optional spaces; nothing else, and at most 40 characters (as the TypeScript rule). The number counts as stars out of 5: `/10` with a number above 5
-- halves it ("8/10" is 4 stars), with 5 or less it changes nothing ("4.6/10" is 4.6 stars); a number above 5 with no
-- `/10` ("1984", "7") is not a rating. 0 is a rating-only text with no rating (unrated).
--
-- Re-runnable: create or replace / create table if not exists; once a read has the number as its rating and no text,
-- it is not touched again, so a second run changes nothing and copies nothing.

-- The stars a review text says (0 to 5, exact), or null when it is not a rating-only text. Private: no API role runs it.
create or replace function private.rating_text_stars(p_text text)
returns numeric
language sql
immutable
set search_path = pg_catalog
as $$
  select case when s.n is null or (s.denominator = '10' and s.n > 5 and s.n / 2 > 5) or (s.denominator is distinct from '10' and s.n > 5)
              then null
              when s.denominator = '10' and s.n > 5 then s.n / 2
              else s.n end
    from (
      select replace(m[1], ',', '.')::numeric as n, m[2] as denominator
        from (select regexp_match(p_text, '^\s*([0-9]+(?:[.,][0-9]+)?)(?:\s*/\s*(5|10))?(?:\s*(?:★|stars?))?\s*$', 'i') as m
               where char_length(p_text) <= 40) a
       where m is not null
    ) s
$$;

-- The rating in integer quarters (1..20) such a text says, rounded down; null when it says none.
create or replace function private.rating_from_review_text(p_text text)
returns integer
language sql
immutable
set search_path = pg_catalog, private
as $$
  select case when floor(private.rating_text_stars(p_text) * 4) >= 1 then floor(private.rating_text_stars(p_text) * 4)::integer end
$$;

-- Where the rows the fix changes are kept (their values before). Private, RLS on, no grants. A later release drops it.
create table if not exists private.rating_only_reviews_backup (
  id              uuid primary key,
  rating          smallint,
  review          text,
  review_spoilers boolean,
  at              timestamptz not null default now()
);
alter table private.rating_only_reviews_backup enable row level security;
revoke all on table private.rating_only_reviews_backup from public, anon, authenticated;
comment on table private.rating_only_reviews_backup is
  'The reading_sessions rows private.rating_only_reviews_fix() changed, as they were (social v2a). A later release drops this table.';

-- The one-time fix, as above. Returns how many reads it changed. A second run changes none: a changed read has the
-- number as its rating (and no text, or a text it keeps because its rating differs: those are no-ops).
create or replace function private.rating_only_reviews_fix()
returns integer
language plpgsql
set search_path = pg_catalog, public, private
as $$
declare
  v_changed integer;
begin
  with c as (
    select s.id, s.rating, s.import_key, private.rating_from_review_text(s.review) as q
      from public.reading_sessions s
     where s.outcome = 'finished' and s.review is not null and private.rating_text_stars(s.review) is not null
  ), d as (
    select c.id, c.q, c.rating,
           case when c.q is null then c.rating
                when c.rating is null then c.q
                when c.import_key is not null and c.rating % 4 = 0 then c.q
                else c.rating end as new_rating
      from c
  ), e as (
    select d.*, (d.q is null or d.new_rating = d.q) as clear_text
      from d
     where d.new_rating is distinct from d.rating or d.q is null or d.new_rating = d.q
  ), saved as (
    insert into private.rating_only_reviews_backup (id, rating, review, review_spoilers)
    select s.id, s.rating, s.review, s.review_spoilers
      from public.reading_sessions s
      join e on e.id = s.id
    on conflict (id) do nothing
    returning id
  )
  update public.reading_sessions s
     set rating = e.new_rating,
         review = case when e.clear_text then null else s.review end,
         review_spoilers = case when e.clear_text then false else s.review_spoilers end
    from e
   where s.id = e.id;
  get diagnostics v_changed = row_count;
  return v_changed;
end;
$$;

revoke all on function private.rating_text_stars(text) from public, anon, authenticated;
revoke all on function private.rating_from_review_text(text) from public, anon, authenticated;
revoke all on function private.rating_only_reviews_fix() from public, anon, authenticated;

select private.rating_only_reviews_fix();
