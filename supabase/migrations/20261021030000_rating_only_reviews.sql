-- A review that is only a rating is a rating, not a review (owner's decision, social v2a).
--
-- Goodreads has whole stars only, so some members typed the finer rating into the review box: "4.6", "5/5",
-- "4.5/5", "4.6/10" (a typo for /5: ratings are out of 5). The app's imports no longer keep such a text as a review
-- (web/app/utils/ratingReview.ts: `isRatingOnlyReview`, `ratingFromReviewText`; the rule is pinned by
-- web/tests/rating-review.test.ts). This migration applies the same rule to reads already imported:
-- a FINISHED read with no rating whose review is only a rating gets that rating, rounded DOWN to the quarter
-- steps a rating has (integer quarters 1..20: 4.6 -> 18, 4.9 -> 19, 5 -> 20, 3 -> 12). A read that already has a
-- rating keeps it. Nothing else changes: the review text stays for now (see the disabled statement at the end).
--
-- The text is: optional spaces, a number with `.` or `,`, optionally `/5` or `/10`, optionally `★` or `stars`
-- (any case), optional spaces; nothing else. The number counts as stars out of 5: `/10` with a number above 5
-- halves it ("8/10" is 4 stars), with 5 or less it changes nothing ("4.6/10" is 4.6 stars); a number above 5 with no
-- `/10` ("1984", "7") is not a rating. 0 is a rating-only text with no rating (unrated).
--
-- Re-runnable: create or replace; the statement only touches reads with no rating, so a second run changes nothing.

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
        from (select regexp_match(p_text, '^\s*([0-9]+(?:[.,][0-9]+)?)\s*(?:/\s*(5|10))?\s*(?:★|stars?)?\s*$', 'i') as m) a
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

-- The one-time fix: finished reads with no rating whose review is only a rating. Returns how many it changed.
create or replace function private.rating_only_reviews_fix()
returns integer
language plpgsql
set search_path = pg_catalog, public, private
as $$
declare
  v_changed integer;
begin
  update public.reading_sessions s
     set rating = private.rating_from_review_text(s.review)
   where s.outcome = 'finished'
     and s.rating is null
     and s.review is not null
     and private.rating_from_review_text(s.review) is not null;
  get diagnostics v_changed = row_count;
  return v_changed;
end;
$$;

revoke all on function private.rating_text_stars(text) from public, anon, authenticated;
revoke all on function private.rating_from_review_text(text) from public, anon, authenticated;
revoke all on function private.rating_only_reviews_fix() from public, anon, authenticated;

select private.rating_only_reviews_fix();

-- NOT RUN: clearing the review text of reads whose review is only a rating. The owner decides when; until then
-- the numbers stay as reviews (they are also what the member typed). Uncomment to clear them (only where the
-- read has a rating, so no number is lost):
--
-- update public.reading_sessions
--    set review = null
--  where review is not null
--    and rating is not null
--    and private.rating_text_stars(review) is not null;
