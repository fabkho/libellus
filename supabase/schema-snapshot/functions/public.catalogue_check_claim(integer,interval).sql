CREATE OR REPLACE FUNCTION public.catalogue_check_claim(p_limit integer DEFAULT 8, p_lease interval DEFAULT '00:03:00'::interval)
 RETURNS SETOF books
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
begin
  return query
  with due as (
    select b.id
      from public.books b
      left join private.catalogue_check_state s on s.book_id = b.id
     where b.owner_id is null and b.checked_at is null
       and coalesce(s.not_before, '-infinity') <= now()
       and (s.claimed_until is null or s.claimed_until < now())
     order by coalesce(s.attempts, 0), b.created_at, b.id
     limit greatest(1, least(coalesce(p_limit, 8), 50))
     for update of b skip locked
  ),
  claimed as (
    insert into private.catalogue_check_state as st (book_id, attempts, claimed_until)
    select due.id, 1, now() + p_lease from due
    on conflict (book_id) do update
       set attempts = st.attempts + 1, claimed_until = excluded.claimed_until
    returning st.book_id
  )
  select b.* from public.books b join claimed c on c.book_id = b.id;
end;
$function$
;
