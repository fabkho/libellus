CREATE OR REPLACE FUNCTION public.set_profile_links(p_links jsonb, p_visibility text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_member   uuid := auth.uid();
  v_item     jsonb;
  v_platform public.link_platform;
  v_handle   text;
  v_seen     public.link_platform[] := '{}';
  v_rows     jsonb := '[]'::jsonb;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_links is null or jsonb_typeof(p_links) <> 'array'
     or jsonb_array_length(p_links) > cardinality(enum_range(null::public.link_platform)) then
    raise exception 'links_invalid' using errcode = '22023';
  end if;
  if p_visibility is not null and p_visibility not in ('everyone', 'followers', 'me') then
    raise exception 'visibility_invalid' using errcode = '22023';
  end if;

  -- Every item first, so a refusal leaves her list as it was.
  for v_item in select * from jsonb_array_elements(p_links) loop
    if jsonb_typeof(v_item) <> 'object'
       or jsonb_typeof(v_item -> 'platform') is distinct from 'string'
       or jsonb_typeof(v_item -> 'handle') is distinct from 'string'
       or v_item ->> 'platform' not in (select e::text from unnest(enum_range(null::public.link_platform)) e) then
      raise exception 'links_invalid' using errcode = '22023';
    end if;
    v_platform := (v_item ->> 'platform')::public.link_platform;
    if v_platform = any (v_seen) then
      raise exception 'links_invalid' using errcode = '22023';
    end if;
    v_seen := v_seen || v_platform;
    v_handle := private.profile_link_clean(v_platform, v_item ->> 'handle');
    if not private.profile_link_ok(v_platform, v_handle) then
      raise exception 'link_invalid:%', v_platform using errcode = '22023';
    end if;
    v_rows := v_rows || jsonb_build_object('platform', v_platform, 'handle', v_handle);
  end loop;

  -- One call at a time per member, so that parallel calls cannot slip past the limit.
  perform pg_advisory_xact_lock(hashtextextended('profile_links:' || v_member::text, 0));
  if (select count(*) from private.profile_link_calls
       where member_id = v_member and at > now() - interval '1 hour') >= 10 then
    raise exception 'rate_limited' using errcode = 'PT429';
  end if;
  delete from private.profile_link_calls where member_id = v_member and at < now() - interval '1 day';
  insert into private.profile_link_calls (member_id) values (v_member);

  delete from public.profile_links
   where member_id = v_member
     and platform::text not in (select r ->> 'platform' from jsonb_array_elements(v_rows) r);
  insert into public.profile_links (member_id, platform, handle)
  select v_member, (r ->> 'platform')::public.link_platform, r ->> 'handle'
    from jsonb_array_elements(v_rows) r
  on conflict (member_id, platform) do update set handle = excluded.handle;

  if p_visibility is not null then
    insert into public.profile_link_settings (member_id, visibility)
    values (v_member, p_visibility)
    on conflict (member_id) do update set visibility = excluded.visibility, updated_at = now();
  end if;

  return private.my_profile_links_json(v_member);
end;
$function$
;
