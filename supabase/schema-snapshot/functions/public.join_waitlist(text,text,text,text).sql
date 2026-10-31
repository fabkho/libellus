CREATE OR REPLACE FUNCTION public.join_waitlist(p_email text, p_token text DEFAULT NULL::text, p_website text DEFAULT NULL::text, p_locale text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_email    text := lower(btrim(coalesce(p_email, '')));
  v_member   uuid;
  v_headers  jsonb;
  v_address  text;
  v_caller   text;
  v_recent   bigint;
  v_id       uuid;
  -- The language the visitor's page was in; anything but de or en is unknown (null), never an error.
  v_locale   text := case lower(btrim(coalesce(p_locale, ''))) when 'de' then 'de' when 'en' then 'en' end;
  -- The wording beside the button this answer is for (see the header).
  c_consent  constant text := '2026-10';
  -- New entries a caller may make in an hour, and all callers together.
  c_caller   constant integer := 5;
  c_all      constant integer := 100;
begin
  -- A bot that filled the field nobody sees: thanked, and forgotten.
  if btrim(coalesce(p_website, '')) <> '' then
    return 'joined';
  end if;

  if not private.waitlist_email_ok(v_email) then
    raise exception 'email_invalid' using errcode = '22023';
  end if;

  -- Who the caller is, as log_client_error knows a signed-out one: a salted hash of the first address.
  v_headers := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  v_address := coalesce(
    nullif(btrim(v_headers ->> 'cf-connecting-ip'), ''),
    nullif(btrim(split_part(v_headers ->> 'x-forwarded-for', ',', 1)), ''),
    nullif(btrim(v_headers ->> 'x-real-ip'), ''),
    'unknown');
  v_caller := left(encode(sha256(convert_to(
    'waitlist:' || v_address || (select salt from private.client_error_salt), 'UTF8')), 'hex'), 32);

  -- One join of a caller at a time, and one of all callers at a time, so two at once cannot both slip under a limit.
  perform pg_advisory_xact_lock(hashtext('join_waitlist:all'));
  perform pg_advisory_xact_lock(hashtext('join_waitlist:' || v_caller));

  delete from private.waitlist_joins where created_at < now() - interval '1 day';

  -- The limits come before anything is looked up in the list: a refusal never tells whether the address is there.
  select count(*) into v_recent from private.waitlist_joins j
   where j.caller_key = v_caller and j.created_at > now() - interval '1 hour';
  if v_recent >= c_caller then
    raise exception 'rate_limited' using errcode = '54000';
  end if;
  select count(*) into v_recent from private.waitlist_joins j where j.created_at > now() - interval '1 hour';
  if v_recent >= c_all then
    raise exception 'rate_limited' using errcode = '54000';
  end if;

  -- Whose page it was; the token itself goes no further than this lookup.
  if p_token is not null and p_token ~ '^[A-Za-z0-9_-]{22}$' then
    select r.member_id into v_member from public.reading_pages r where r.token = p_token;
  end if;

  insert into private.waitlist (email, source, source_member_id, consent_text_version, locale)
  values (v_email::extensions.citext, 'reading_page', v_member, c_consent, v_locale)
  on conflict (email) do nothing
  returning id into v_id;

  if v_id is not null then
    insert into private.waitlist_joins (caller_key) values (v_caller);
  end if;

  -- The same answer whether she was new or already there.
  return 'joined';
end;
$function$
;
