CREATE OR REPLACE FUNCTION public.buddy_voice_sweep_batch(p_limit integer DEFAULT 100, p_grace interval DEFAULT '06:00:00'::interval, p_orphans boolean DEFAULT true)
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_paths text[];
begin
  if coalesce(p_orphans, false) then
    insert into private.buddy_voice_trash (path)
    select o.name
      from storage.objects o
     where o.bucket_id = 'buddy-voice'
       and o.created_at < now() - p_grace
       and not exists (select 1 from private.buddy_voice_trash t where t.path = o.name)
       and not private.buddy_voice_attached(o.name)
     limit v_limit
    on conflict do nothing;
  end if;

  delete from private.buddy_voice_trash t
   where private.buddy_voice_attached(t.path)
      or not exists (select 1 from storage.objects o where o.bucket_id = 'buddy-voice' and o.name = t.path);

  with picked as (
    select t.path
      from private.buddy_voice_trash t
     where t.attempts < 20
       and (t.last_attempt_at is null or t.last_attempt_at < now() - t.attempts * interval '5 minutes')
     order by t.attempts, t.queued_at
     limit v_limit
       for update skip locked
  ), marked as (
    update private.buddy_voice_trash t
       set attempts = t.attempts + 1, last_attempt_at = now()
      from picked
     where t.path = picked.path
    returning t.path, t.queued_at
  )
  select coalesce(array_agg(m.path order by m.queued_at, m.path), '{}') into v_paths from marked m;
  return v_paths;
end;
$function$
;
