CREATE OR REPLACE FUNCTION private.activity_quiet()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_context text;
begin
  if auth.uid() is null or coalesce(current_setting('libellus.quiet', true), '') = 'on' then
    return true;
  end if;
  get diagnostics v_context = pg_context;
  return v_context ~ 'function (public\.)?import_books\(';
end;
$function$
;
