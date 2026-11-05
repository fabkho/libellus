CREATE OR REPLACE FUNCTION private.buddy_rate(p_member uuid, p_kind text, p_limit integer)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'private'
AS $function$
begin
  delete from private.buddy_calls
   where member_id = p_member and kind = p_kind and at < now() - interval '1 hour';
  if (select count(*) from private.buddy_calls
       where member_id = p_member and kind = p_kind and at > now() - interval '1 hour') >= p_limit then
    raise exception 'rate_limited' using errcode = 'PT429';
  end if;
  insert into private.buddy_calls (member_id, kind) values (p_member, p_kind);
end;
$function$
;
