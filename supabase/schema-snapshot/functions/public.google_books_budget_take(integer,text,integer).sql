CREATE OR REPLACE FUNCTION public.google_books_budget_take(p_limit integer, p_scope text DEFAULT 'all'::text, p_scope_limit integer DEFAULT NULL::integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_day   date := (now() at time zone 'America/Los_Angeles')::date;
  v_used  integer;
  v_slice boolean := p_scope is not null and p_scope <> 'all';
begin
  if p_limit is null or p_limit not between 1 and 100000
     or (v_slice and (p_scope !~ '^[a-z]{1,20}$' or p_scope_limit is null or p_scope_limit not between 1 and 100000)) then
    raise exception 'budget_invalid' using errcode = '22023';
  end if;
  if v_slice then
    insert into public.google_books_budget as b (day, scope, used) values (v_day, p_scope, 1)
    on conflict (day, scope) do update set used = b.used + 1 where b.used < p_scope_limit
    returning b.used into v_used;
    if v_used is null then return false; end if;
    v_used := null;
  end if;
  insert into public.google_books_budget as b (day, scope, used) values (v_day, 'all', 1)
  on conflict (day, scope) do update set used = b.used + 1 where b.used < p_limit
  returning b.used into v_used;
  if v_used is null then
    if v_slice then
      update public.google_books_budget set used = used - 1 where day = v_day and scope = p_scope;
    end if;
    return false;
  end if;
  return true;
end
$function$
;
