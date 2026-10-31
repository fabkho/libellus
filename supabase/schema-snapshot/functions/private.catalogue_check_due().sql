CREATE OR REPLACE FUNCTION private.catalogue_check_due()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
      from public.books b
      left join private.catalogue_check_state s on s.book_id = b.id
     where b.owner_id is null and b.checked_at is null
       and coalesce(s.not_before, '-infinity') <= now()
       and (s.claimed_until is null or s.claimed_until < now())
  )
$function$
;
