CREATE OR REPLACE FUNCTION private.cover_gc_entry_added()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  update private.cover_objects o
     set orphaned_at = null
    from public.books b
   where b.id = new.book_id
     and o.key = b.cover_key
     and o.orphaned_at is not null
     and o.deleting_at is null;
  return null;
end
$function$
;
