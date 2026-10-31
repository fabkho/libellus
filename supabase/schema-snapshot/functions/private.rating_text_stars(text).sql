CREATE OR REPLACE FUNCTION private.rating_text_stars(p_text text)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select case when s.n is null or (s.denominator = '10' and s.n > 5 and s.n / 2 > 5) or (s.denominator is distinct from '10' and s.n > 5)
              then null
              when s.denominator = '10' and s.n > 5 then s.n / 2
              else s.n end
    from (
      select replace(m[1], ',', '.')::numeric as n, m[2] as denominator
        from (select regexp_match(p_text, '^\s*([0-9]+(?:[.,][0-9]+)?)(?:\s*/\s*(5|10))?(?:\s*(?:★|stars?))?\s*$', 'i') as m
               where char_length(p_text) <= 40) a
       where m is not null
    ) s
$function$
;
