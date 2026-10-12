-- The waitlist remembers the language of the page it was joined from, so the invite mail is written in it
-- (German group B of #257).
--
-- The invite goes out later, when the owner taps Invite, from a request of hers: nothing of the person's own
-- request is left by then. The page she joined from was drawn in her language (the phone's, or the one she
-- chose in the app), so the app sends that with the address and the entry keeps it: `locale`, 'de' or 'en',
-- null when it was not sent or was another language (the mail is then English). One two-letter value, no
-- more than the wording already says the address is for ("only to send you an invite"); the privacy notice
-- lists it (web/app/legal/privacy.ts).
--
--   private.waitlist.locale                          'de' | 'en' | null
--   join_waitlist(email, token, website, locale)     the new fourth argument has a default, so a build
--                                                    that does not send it still joins (the old three-argument
--                                                    function is dropped: PostgREST cannot choose between two)
--   owner_waitlist_prepare_invite(id)                answers `locale` as well; the waitlist-invite function
--                                                    chooses the mail's language from it

alter table private.waitlist
  add column locale text check (locale in ('de', 'en'));

comment on column private.waitlist.locale is
  'The language the page was in when she joined (de or en), sent by the app; null when unknown. Only chooses the language of her invite mail.';

drop function public.join_waitlist(text, text, text);

create function public.join_waitlist(p_email text, p_token text default null, p_website text default null, p_locale text default null)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
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
$$;

comment on function public.join_waitlist(text, text, text, text) is
  'A visitor of a reading page asks for an invite (private.waitlist): the address trimmed and checked (email_invalid), '
  'the page''s token only to find whose page it was (never stored), 5 new entries an hour per caller and 100 in all '
  '(rate_limited), the same address again and a filled honeypot (p_website) both answer joined and change nothing. p_locale (''de'' or ''en'', the language the page was in) is kept '
  'so the invite mail can be written in it; anything else is stored as unknown.';


revoke all on function public.join_waitlist(text, text, text, text) from public;
grant execute on function public.join_waitlist(text, text, text, text) to anon, authenticated;

drop function public.owner_waitlist_prepare_invite(uuid);

create function public.owner_waitlist_prepare_invite(p_id uuid)
returns table (
  email      text,
  code       text,
  expires_at timestamptz,
  locale     text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_email   text;
  v_locale  text;
  v_code_id uuid;
  v_code    public.invite_codes;
begin
  if not private.is_instance_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  -- Locked, so two Invites at once (two devices, a double tap) share one code.
  select w.email::text, w.invite_code_id, w.locale into v_email, v_code_id, v_locale
    from private.waitlist w where w.id = p_id
     for update;
  if not found then
    raise exception 'waitlist_entry_not_found' using errcode = 'P0002';
  end if;

  if v_code_id is not null then
    select c.* into v_code from public.invite_codes c
     where c.id = v_code_id
       and c.uses = 0
       and (c.expires_at is null or c.expires_at > now());
  end if;

  if v_code.id is null then
    -- A fresh code: one use, 14 days, no address in its label (the label is the operator's, read in plain sight).
    v_code := public.create_invite_code(1, now() + interval '14 days', 'waitlist', null);
    update private.waitlist w set invite_code_id = v_code.id where w.id = p_id;
  end if;

  return query select v_email, v_code.code::text, v_code.expires_at, v_locale;
end;
$$;

comment on function public.owner_waitlist_prepare_invite(uuid) is
  'The owner''s Invite (the waitlist-invite edge function calls it with her session): the entry''s address, a '
  'one-use invite code for it with its expiry, and the language her page was in (null: unknown). Reuses the entry''s '
  'code while it is unused and unexpired, else mints one (14 days, label waitlist) and keeps it on the entry. Does not '
  'mark the entry invited; the function does that after the mail went out. Raises not_owner for anyone but the instance '
  'owner, waitlist_entry_not_found for an unknown id.';

revoke all on function public.owner_waitlist_prepare_invite(uuid) from public, anon;
grant execute on function public.owner_waitlist_prepare_invite(uuid) to authenticated;
