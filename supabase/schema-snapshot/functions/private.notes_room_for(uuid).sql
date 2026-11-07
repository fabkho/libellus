CREATE OR REPLACE FUNCTION private.notes_room_for(p_book uuid)
 RETURNS rooms
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select r.*
    from public.rooms r
   where r.kind = 'notes'
     and r.work_key in (private.book_work_key(p_book), 'b:' || p_book::text)
   order by (r.work_key = private.book_work_key(p_book)) desc
   limit 1
$function$
;
