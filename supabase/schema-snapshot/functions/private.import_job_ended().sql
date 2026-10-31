CREATE OR REPLACE FUNCTION private.import_job_ended()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  begin
    perform private.import_push_kick(new.id);
  exception when others then
    raise warning 'import_job_ended: the push for % was not kicked: %', new.id, sqlerrm;
  end;
  return null;
end
$function$
;
