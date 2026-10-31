CREATE OR REPLACE FUNCTION public.cover_store_done(p_book uuid, p_source_url text, p_key text, p_widths integer[], p_bytes bigint, p_content_type text DEFAULT NULL::text, p_thumbhash text DEFAULT NULL::text, p_dominant text DEFAULT NULL::text, p_secondary text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_widths smallint[] := array(select distinct w::smallint from unnest(p_widths) w order by 1);
  v_written uuid;
begin
  -- The object first (its row exists since the reservation), so a Book never points at a row that knows nothing.
  update private.cover_objects
     set widths = v_widths, bytes = p_bytes, content_type = p_content_type, stored_at = now(), orphaned_at = null
   where key = p_key and deleting_at is null;
  if not found then return false; end if;

  update public.books b
     set cover_key = p_key,
         cover_widths = v_widths,
         cover_thumbhash = coalesce(b.cover_thumbhash, nullif(btrim(p_thumbhash), '')),
         cover_dominant = case when b.cover_dominant is null and b.cover_secondary is null
                               then lower(nullif(btrim(p_dominant), '')) else b.cover_dominant end,
         cover_secondary = case when b.cover_dominant is null and b.cover_secondary is null
                                then lower(nullif(btrim(p_secondary), '')) else b.cover_secondary end
   where b.id = p_book
     and private.cover_artwork(b.cover_url) = private.cover_artwork(p_source_url)
     and b.cover_key is distinct from p_key
  returning b.id into v_written;

  if v_written is not null then
    delete from private.cover_store_queue where book_id = p_book;
    return true;
  end if;
  -- Nothing written: done before (the same key is there already), or the cover changed meanwhile. A queue row the
  -- reconcile made after the first done committed goes now, so it never leases, expires and fails.
  if exists (select 1 from public.books b where b.id = p_book and b.cover_key = p_key
                and private.cover_artwork(b.cover_url) = private.cover_artwork(p_source_url)) then
    delete from private.cover_store_queue where book_id = p_book;
    return true;
  end if;
  return false;
end
$function$
;
