CREATE OR REPLACE FUNCTION public.mute_series(p_series uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_member uuid := auth.uid();
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if not exists (select 1 from public.series s
                  where s.id = p_series and (s.created_by is null or s.created_by = v_member)) then
    raise exception 'series_not_found' using errcode = 'P0002';
  end if;
  insert into public.muted_series (member_id, series_id)
  values (v_member, p_series)
  on conflict do nothing;
end;
$function$
;
