CREATE OR REPLACE FUNCTION private.import_slot_ttl()
 RETURNS interval
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$ select interval '75 seconds' $function$
;
