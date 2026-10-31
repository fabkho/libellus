CREATE OR REPLACE FUNCTION private.cover_store_due()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from private.cover_store_queue q
     where (q.state = 'queued' and q.due_at <= now())
        or (q.state = 'leased' and q.leased_until < now())
  )
$function$
;
