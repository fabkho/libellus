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
--             - the stored rating came from an import and not from the app: `reading_sessions.import_key` is set
--               (the key an import writes, `goodreads:<id>`, `hardcover:<id>`, ...), and, for Goodreads, which can
--               only store whole stars, the rating is a whole star (a multiple of 4: a quarter or half rating on a
--               Goodreads read was set in the app afterwards, and stays). A read with no import_key (added in the
--               app) keeps the rating it has.
--   review  null: it was never a review. Only where nothing is lost: the read is imported, or its rating is now
--           the text's number, or the text says no rating (0). A read added in the app whose own rating differs
--           from the number keeps the text.
--
-- The text is: optional spaces, a number with `.` or `,`, optionally `/5` or `/10`, optionally `★` or `stars`
-- (any case), optional spaces; nothing else. The number counts as stars out of 5: `/10` with a number above 5
-- halves it ("8/10" is 4 stars), with 5 or less it changes nothing ("4.6/10" is 4.6 stars); a number above 5 with no
-- `/10` ("1984", "7") is not a rating. 0 is a rating-only text with no rating (unrated).
--
-- Re-runnable: create or replace; once a read has the number as its rating and no text, it is not touched again, so a
-- second run changes nothing.

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

-- The one-time fix, as above. Returns how many reads it changed. A second run changes none: a changed read has the
-- number as its rating (or no text any more), and a read that keeps its own rating and its text is a no-op.
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
    select c.id, c.q, c.rating, c.import_key,
           case when c.q is null then c.rating
                when c.rating is null then c.q
                when c.import_key is not null and (c.import_key not like 'goodreads:%' or c.rating % 4 = 0) then c.q
                else c.rating end as new_rating
      from c
  ), e as (
    select d.*, (d.q is null or d.import_key is not null or d.new_rating = d.q) as clear_text
      from d
  )
  update public.reading_sessions s
     set rating = e.new_rating,
         review = case when e.clear_text then null else s.review end
    from e
   where s.id = e.id
     and (e.new_rating is distinct from e.rating or e.clear_text);
  get diagnostics v_changed = row_count;
  return v_changed;
end;
$$;

revoke all on function private.rating_text_stars(text) from public, anon, authenticated;
revoke all on function private.rating_from_review_text(text) from public, anon, authenticated;
revoke all on function private.rating_only_reviews_fix() from public, anon, authenticated;

select private.rating_only_reviews_fix();
