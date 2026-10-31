CREATE OR REPLACE FUNCTION private.profile_link_clean(p_platform link_platform, p_raw text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v text := btrim(coalesce(p_raw, ''), E' \t\r\n');
begin
  if v = '' then
    return v;
  end if;
  if p_platform = 'youtube' then
    -- A channel id is kept as it is; anything else is a handle, with its @.
    if v ~ '^UC[A-Za-z0-9_-]{22}$' then
      return v;
    end if;
    if v !~ '^@?[A-Za-z0-9._-]*$' then
      return v;
    end if;
    return '@' || lower(regexp_replace(v, '^@', ''));
  end if;
  if p_platform = 'goodreads' then
    return v;
  end if;
  v := regexp_replace(v, '^@', '');
  if v !~ '^[A-Za-z0-9._]*$' then
    return v;
  end if;
  return case p_platform when 'reado' then v else lower(v) end;
end;
$function$
;
