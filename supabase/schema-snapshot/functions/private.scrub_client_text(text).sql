CREATE OR REPLACE FUNCTION private.scrub_client_text(p_text text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select regexp_replace(
           regexp_replace(p_text, '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}', '[email]', 'g'),
           '([a-z][a-z0-9+.-]*://[^[:space:]?#"''<>()]*)[?#][^[:space:]"''<>()]*?((:[0-9]+){0,2})(?=[[:space:]"''<>()]|$)',
           '\1\2', 'gi')
$function$
;
