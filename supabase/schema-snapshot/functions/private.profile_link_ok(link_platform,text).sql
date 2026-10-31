CREATE OR REPLACE FUNCTION private.profile_link_ok(p_platform link_platform, p_handle text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select p_handle is not null and case p_platform
    when 'instagram' then
      p_handle ~ '^[a-z0-9_]([a-z0-9._]{0,28}[a-z0-9_])?$' and p_handle !~ '\.\.'
    when 'tiktok' then
      p_handle ~ '^[a-z0-9_]([a-z0-9._]{0,22}[a-z0-9_])$'
    when 'youtube' then
      p_handle ~ '^@[a-z0-9_-][a-z0-9._-]{1,28}[a-z0-9_-]$' or p_handle ~ '^UC[A-Za-z0-9_-]{22}$'
    when 'goodreads' then
      p_handle ~ '^[1-9][0-9]{0,11}$'
    when 'reado' then
      p_handle ~ '^[A-Za-z0-9_][A-Za-z0-9._]{0,28}[A-Za-z0-9_]$'
  end
$function$
;
