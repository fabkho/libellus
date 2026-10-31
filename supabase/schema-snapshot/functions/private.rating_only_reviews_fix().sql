CREATE OR REPLACE FUNCTION private.rating_only_reviews_fix()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
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
$function$
;
