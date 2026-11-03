CREATE OR REPLACE FUNCTION private.buddy_send(p_event text, p_payload jsonb, p_members uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_member uuid;
begin
  begin
    foreach v_member in array coalesce(p_members, '{}') loop
      perform realtime.send(p_payload, p_event, private.member_topic(v_member), true);
    end loop;
  exception when others then
    raise warning 'buddy_send % failed: % (%)', p_event, sqlerrm, sqlstate;
  end;
end;
$function$
;
