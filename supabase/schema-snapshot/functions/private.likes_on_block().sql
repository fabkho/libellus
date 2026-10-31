CREATE OR REPLACE FUNCTION private.likes_on_block()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
begin
  delete from public.likes l
   using public.reading_sessions s, public.library_entries e
   where s.id = l.session_id
     and e.id = s.entry_id
     and ((l.member_id = new.blocker_id and e.member_id = new.blocked_id)
       or (l.member_id = new.blocked_id and e.member_id = new.blocker_id));
  return new;
end;
$function$
;
