CREATE OR REPLACE FUNCTION private.activity_on_entry()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  begin
    -- 1. Quiet.
    if private.activity_quiet() then
      return null;
    end if;

    insert into public.activity (member_id, entry_id, kind, on_day, created_at, visible_at)
    values (new.member_id, new.id, 'want', new.added_at::date, statement_timestamp(),
            now() + (select c.settle_window from private.social_config c));
  exception when others then
    raise warning 'activity not written for entry %: %', new.id, sqlerrm;
  end;
  return null;
end;
$function$
;
