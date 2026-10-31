CREATE OR REPLACE FUNCTION private.likes_on_follow_end()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
begin
  delete from public.likes l
   using public.reading_sessions s, public.library_entries e
   where l.member_id = old.follower_id
     and s.id = l.session_id
     and e.id = s.entry_id
     and e.member_id = old.followee_id;
  return old;
end;
$function$
;
