CREATE OR REPLACE FUNCTION private.feedback_rate_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- One message of a member at a time, so two at once cannot both slip under a limit.
  perform pg_advisory_xact_lock(hashtextextended('feedback:' || new.member_id::text, 0));

  if (select count(*) from public.feedback f
       where f.member_id = new.member_id and f.created_at > now() - interval '1 hour') >= 5
     or (select count(*) from public.feedback f
          where f.member_id = new.member_id and f.created_at > now() - interval '1 day') >= 20 then
    raise exception 'rate_limited' using errcode = 'PT429';
  end if;
  return new;
end;
$function$
;
