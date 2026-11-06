CREATE OR REPLACE FUNCTION public.notes_config()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  return jsonb_build_object('publicEnabled', private.notes_public_enabled());
end;
$function$
;
