CREATE OR REPLACE FUNCTION public.isbn_valid(p_isbn text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_sum integer := 0;
begin
  if p_isbn ~ '^97[89][0-9]{10}$' then
    for i in 1..13 loop
      v_sum := v_sum + substr(p_isbn, i, 1)::integer * case when i % 2 = 1 then 1 else 3 end;
    end loop;
    return v_sum % 10 = 0;
  elsif p_isbn ~ '^[0-9]{9}[0-9X]$' then
    for i in 1..10 loop
      v_sum := v_sum + (case when substr(p_isbn, i, 1) = 'X' then 10 else substr(p_isbn, i, 1)::integer end) * (11 - i);
    end loop;
    return v_sum % 11 = 0;
  end if;
  return false;
end;
$function$
;
