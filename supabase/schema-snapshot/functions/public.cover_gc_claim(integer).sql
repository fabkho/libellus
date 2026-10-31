CREATE OR REPLACE FUNCTION public.cover_gc_claim(p_limit integer DEFAULT 100)
 RETURNS TABLE(key text, widths smallint[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
begin
  if not private.cover_gc_enabled() then return; end if;

  return query
    with picked as (
      select o.key
        from private.cover_objects o
       where o.orphaned_at < now() - interval '30 days'
         and (o.deleting_at is null or o.deleting_at < now() - interval '15 minutes')
         and (o.gc_retry_at is null or o.gc_retry_at <= now())
         and not exists (select 1 from public.books b
                          where b.cover_key = o.key
                            and exists (select 1 from public.library_entries e where e.book_id = b.id))
       order by o.orphaned_at, o.key
       limit least(greatest(coalesce(p_limit, 100), 1), 200)
         for update of o skip locked
    ), claimed as (
      update private.cover_objects o
         set deleting_at = now()
        from picked p
       where o.key = p.key
         and o.orphaned_at < now() - interval '30 days'
         and (o.deleting_at is null or o.deleting_at < now() - interval '15 minutes')
      returning o.key, o.widths
    ), cleared as (
      update public.books b
         set cover_key = null, cover_widths = null
        from claimed c
       where b.cover_key = c.key
      returning b.id
    )
    select c.key, c.widths from claimed c;
end
$function$
;
