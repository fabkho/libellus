CREATE OR REPLACE FUNCTION private.like_allowed(p_liker uuid, p_owner uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  select private.visible(p_liker, p_owner) and (private.social_of(p_owner)).show_finished
$function$
;
