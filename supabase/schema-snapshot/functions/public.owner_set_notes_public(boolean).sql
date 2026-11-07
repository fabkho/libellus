CREATE OR REPLACE FUNCTION public.owner_set_notes_public(p_enabled boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if not private.is_instance_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'invalid_value' using errcode = '22023';
  end if;
  insert into private.notes_settings as s (id, public_enabled, updated_at) values (true, p_enabled, now())
  on conflict (id) do update set public_enabled = excluded.public_enabled, updated_at = now();
  return jsonb_build_object('publicEnabled', private.notes_public_enabled());
end;
$function$
;
