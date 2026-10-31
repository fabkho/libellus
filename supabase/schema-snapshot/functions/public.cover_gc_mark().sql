CREATE OR REPLACE FUNCTION public.cover_gc_mark()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_marked integer;
  v_cleared integer;
begin
  if not private.cover_gc_enabled() then return jsonb_build_object('state', 'off', 'marked', 0, 'cleared', 0); end if;

  update private.cover_objects o
     set orphaned_at = now()
   where o.orphaned_at is null
     and o.deleting_at is null
     and not exists (select 1 from public.books b
                      where b.cover_key = o.key
                        and exists (select 1 from public.library_entries e where e.book_id = b.id));
  get diagnostics v_marked = row_count;

  update private.cover_objects o
     set orphaned_at = null
   where o.orphaned_at is not null
     and o.deleting_at is null
     and exists (select 1 from public.books b
                  where b.cover_key = o.key
                    and exists (select 1 from public.library_entries e where e.book_id = b.id));
  get diagnostics v_cleared = row_count;

  return jsonb_build_object('state', 'ran', 'marked', v_marked, 'cleared', v_cleared);
end
$function$
;
