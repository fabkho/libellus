CREATE OR REPLACE FUNCTION public.google_books_budget_take(p_limit integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_day  date := (now() at time zone 'America/Los_Angeles')::date;
  v_used integer;
begin
  if p_limit is null or p_limit not between 1 and 100000 then
    raise exception 'budget_invalid' using errcode = '22023';
  end if;
  insert into public.google_books_budget as b (day, used) values (v_day, 1)
  on conflict (day) do update set used = b.used + 1 where b.used < p_limit
  returning b.used into v_used;
  return v_used is not null;
end
$function$
;
