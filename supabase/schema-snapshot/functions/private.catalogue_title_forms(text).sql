CREATE OR REPLACE FUNCTION private.catalogue_title_forms(p_title text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select coalesce(array_agg(distinct f) filter (where f <> ''), '{}')
    from (
      select k as f
        from unnest(array[
          public.work_title_key(p_title), public.match_text(p_title),
          public.work_title_key(split_part(p_title, ' - ', 1)), public.match_text(split_part(p_title, ' - ', 1))
        ]) as k
      union
      select regexp_replace(k, '^(the|a|an|der|die|das|ein|eine|le|la|les|l|un|une|el|los|las|il|lo|gli|het|een) ', '')
        from unnest(array[
          public.work_title_key(p_title), public.match_text(p_title),
          public.work_title_key(split_part(p_title, ' - ', 1)), public.match_text(split_part(p_title, ' - ', 1))
        ]) as k
    ) x
$function$
;
