CREATE OR REPLACE FUNCTION public."like"(p_session uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_caller uuid := auth.uid();
  v_owner  uuid;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;

  select e.member_id into v_owner
    from public.reading_sessions s
    join public.library_entries e on e.id = s.entry_id and not e.hidden
   where s.id = p_session and s.outcome = 'finished';
  if v_owner is null or private.like_allowed(v_caller, v_owner) is not true then
    raise exception 'not_found' using errcode = 'PT404';
  end if;

  -- The pair's lock (the one follow and block take), and the follow row held `for share` before the
  -- look below: an unfollow waits for this like and then takes it away with its trigger, and one that
  -- committed first is seen by the look. A block cannot slip in between either.
  perform pg_advisory_xact_lock(hashtextextended(
    'pair:' || least(v_caller, v_owner)::text || greatest(v_caller, v_owner)::text, 0));
  perform 1 from public.follows where follower_id = v_caller and followee_id = v_owner for share;
  if not exists (select 1 from public.reading_sessions s
                   join public.library_entries e on e.id = s.entry_id and not e.hidden
                  where s.id = p_session and s.outcome = 'finished' and e.member_id = v_owner)
     or private.like_allowed(v_caller, v_owner) is not true then
    raise exception 'not_found' using errcode = 'PT404';
  end if;

  if not exists (select 1 from public.likes where member_id = v_caller and session_id = p_session) then
    -- One call at a time per member, so that parallel calls cannot slip past the limit.
    perform pg_advisory_xact_lock(hashtextextended('like:' || v_caller::text, 0));
    if (select count(*) from private.like_calls
         where member_id = v_caller and at > now() - interval '1 hour') >= 300 then
      raise exception 'rate_limited' using errcode = 'PT429';
    end if;
    delete from private.like_calls where member_id = v_caller and at < now() - interval '1 day';
    insert into private.like_calls (member_id) values (v_caller);
    insert into public.likes (member_id, session_id) values (v_caller, p_session)
    on conflict do nothing;
  end if;

  return jsonb_build_object('likes', private.like_count(p_session), 'liked', true);
end;
$function$
;
