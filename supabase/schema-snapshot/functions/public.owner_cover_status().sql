CREATE OR REPLACE FUNCTION public.owner_cover_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_with_cover integer;
  v_stored integer;
  v_failed integer;
  v_bytes bigint;
  v_warnings text[] := '{}';
  v_result jsonb;
begin
  if not private.is_instance_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  select count(*), count(*) filter (where b.cover_key is not null)
    into v_with_cover, v_stored
    from public.books b
   where b.cover_url is not null
     and exists (select 1 from public.library_entries e where e.book_id = b.id);

  select count(*) into v_failed from private.cover_store_queue where state = 'failed';
  select coalesce(sum(bytes), 0)::bigint into v_bytes from private.cover_objects;

  if v_bytes > 5368709120::bigint then v_warnings := array_append(v_warnings, 'stored_bytes_over_5gb'); end if;
  if v_with_cover > 0 and v_failed * 20 > v_with_cover then v_warnings := array_append(v_warnings, 'failed_over_5_percent'); end if;

  select jsonb_build_object(
    'enabled', coalesce((select enabled from private.cover_store_settings where id), false),
    'with_cover', v_with_cover,
    'stored', v_stored,
    'queued', (select count(*) from private.cover_store_queue
                where state = 'queued' and coalesce(last_error, '') not in ('throttled', 'deleting')),
    'leased', (select count(*) from private.cover_store_queue where state = 'leased'),
    'throttled', (select count(*) from private.cover_store_queue
                   where state = 'queued' and last_error in ('throttled', 'deleting')),
    'failed', v_failed,
    'failed_by_reason', coalesce((select jsonb_object_agg(reason, n)
                                    from (select coalesce(last_error, 'unknown') as reason, count(*) as n
                                            from private.cover_store_queue where state = 'failed' group by 1) f), '{}'),
    'gone', (select count(*) from private.cover_store_queue where state = 'gone'),
    'unsupported', (select count(*) from private.cover_store_queue where state = 'unsupported'),
    -- Storable and not queued yet: the next tick's reconcile takes them.
    'unqueued', (select count(*) from public.books b
                  where b.cover_key is null and b.cover_url is not null and private.cover_allowed(b.cover_url)
                    and exists (select 1 from public.library_entries e where e.book_id = b.id)
                    and not exists (select 1 from private.cover_store_queue q where q.book_id = b.id)),
    -- Other hosts: not stored in v1.
    'not_storable', (select count(*) from public.books b
                      where b.cover_url is not null and not private.cover_allowed(b.cover_url)
                        and exists (select 1 from public.library_entries e where e.book_id = b.id)),
    'objects', (select count(*) from private.cover_objects),
    'bytes', v_bytes,
    'orphaned', (select count(*) from private.cover_objects where orphaned_at is not null),
    'deleting', (select count(*) from private.cover_objects where deleting_at is not null),
    'warnings', to_jsonb(v_warnings)
  ) into v_result;
  return v_result;
end
$function$
;
