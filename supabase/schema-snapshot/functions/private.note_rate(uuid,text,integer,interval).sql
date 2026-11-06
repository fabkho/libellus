CREATE OR REPLACE FUNCTION private.note_rate(p_member uuid, p_kind text, p_limit integer, p_window interval)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  perform pg_advisory_xact_lock(hashtextextended('notes_rate:' || p_member::text || ':' || p_kind, 0));
  delete from private.note_calls c
   where c.member_id = p_member and c.kind = p_kind and c.at < now() - p_window;
  if (select count(*) from private.note_calls c
       where c.member_id = p_member and c.kind = p_kind and c.at > now() - p_window) >= p_limit then
    raise exception 'rate_limited' using errcode = 'PT429';
  end if;
  insert into private.note_calls (member_id, kind) values (p_member, p_kind);
end;
$function$
;
