CREATE OR REPLACE FUNCTION public.enrich_claim(p_limit integer DEFAULT 8, p_lease interval DEFAULT '00:05:00'::interval, p_book uuid DEFAULT NULL::uuid)
 RETURNS SETOF books
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  return query
  with due as (
    select q.book_id
      from private.enrich_queue q
     where q.not_before <= now()
       and (q.claimed_until is null or q.claimed_until < now())
       and (p_book is null or q.book_id = p_book)
     order by case q.reason when 'member' then 0 when 'new' then 1 when 'backfill' then 2 else 3 end,
              q.enqueued_at
     limit greatest(1, least(coalesce(p_limit, 8), 100))
     for update skip locked
  ),
  claimed as (
    update private.enrich_queue q
       set claimed_until = now() + p_lease, attempts = q.attempts + 1
      from due
     where q.book_id = due.book_id
    returning q.book_id
  )
  select b.* from public.books b join claimed c on c.book_id = b.id;
end;
$function$
;
