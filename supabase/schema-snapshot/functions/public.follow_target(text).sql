CREATE OR REPLACE FUNCTION public.follow_target(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_caller  uuid := auth.uid();
  v_owner   uuid;
  v_follow  public.follows;
  v_state   text;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{22}$' then
    return null;
  end if;

  select s.member_id into v_owner from public.social_settings s where s.follow_token = p_token;
  if v_owner is null or private.blocked_either(v_caller, v_owner) then
    return null;
  end if;

  if v_owner = v_caller then
    v_state := 'self';
  else
    perform pg_advisory_xact_lock(hashtextextended(
      'pair:' || least(v_caller, v_owner)::text || greatest(v_caller, v_owner)::text, 0));

    -- The look above ran before this lock: a block committed while we waited for it is only
    -- visible now. Ask again, before the view is written, and answer as for a blocked visitor.
    if private.blocked_either(v_caller, v_owner) then
      return null;
    end if;

    insert into public.follow_link_views (visitor_id, member_id)
    values (v_caller, v_owner)
    on conflict do nothing;

    select * into v_follow from public.follows
     where follower_id = v_caller and followee_id = v_owner;
    v_state := case
      when not found then 'none'
      when v_follow.accepted_at is not null then 'following'
      else 'requested'            -- asked, or declined: the asker cannot tell
    end;
  end if;

  return jsonb_build_object(
    'member', private.member_card(v_caller, v_owner),
    'private', (private.social_of(v_owner)).private,
    'state', v_state
  );
end;
$function$
;
