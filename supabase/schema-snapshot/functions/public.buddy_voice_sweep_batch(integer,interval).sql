CREATE OR REPLACE FUNCTION public.buddy_voice_sweep_batch(p_limit integer DEFAULT 100, p_grace interval DEFAULT '1 day'::interval)
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_paths text[];
begin
  delete from private.buddy_voice_trash t
   where private.buddy_voice_attached(t.path)
      or not exists (select 1 from storage.objects o where o.bucket_id = 'buddy-voice' and o.name = t.path);

  select coalesce(array_agg(x.path order by x.since), '{}') into v_paths
    from (
      select t.path, t.queued_at as since
        from private.buddy_voice_trash t
      union
      select o.name, o.created_at
        from storage.objects o
       where o.bucket_id = 'buddy-voice'
         and o.created_at < now() - p_grace
         and not private.buddy_voice_attached(o.name)
       order by 2
       limit greatest(coalesce(p_limit, 100), 1)
    ) x;
  return v_paths;
end;
$function$
;
