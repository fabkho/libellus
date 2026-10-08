-- Inviting from the waitlist (issue #171, after 20261011040000_waitlist.sql).
--
-- The waitlist's first version sent nothing: the owner minted a code with
-- scripts/create-invite-code.sh and mailed it herself. That note is superseded. Her Waitlist
-- screen now has an Invite button per waiting entry, which asks the `waitlist-invite` edge
-- function (supabase/functions/waitlist-invite) to do it: the function calls
-- `owner_waitlist_prepare_invite` with the owner's own session (so this database's owner check
-- decides; the function holds no service-role key), mails the code over SMTP and then calls
-- `owner_waitlist_set_invited`. Without SMTP configured, or when the send fails, the entry stays
-- waiting and the owner still sees the code to send it another way; the next Invite reuses it.
--
--   private.waitlist.invite_code_id     the code minted for the entry (null: none yet, or the code was
--                                       deleted); the address never goes into the code's label
--   owner_waitlist_prepare_invite(id)   the entry's address, a one-use code for it and when the code
--                                       expires: the entry's own code while it is still usable (unused,
--                                       not expired), otherwise a new one (14 days, label 'waitlist')
--
-- Owner only, like the rest of the owner's side: `not_owner` (42501) for anyone else, an unknown id
-- raises `waitlist_entry_not_found` (P0002). Members still never read `invite_codes`; the code goes
-- to the owner through this function only.

alter table private.waitlist
  add column invite_code_id uuid references public.invite_codes (id) on delete set null;

-- The foreign key's own index (a deleted code nulls these).
create index waitlist_invite_code_id on private.waitlist (invite_code_id) where invite_code_id is not null;

comment on column private.waitlist.invite_code_id is
  'The invite code owner_waitlist_prepare_invite minted for this address (one use, 14 days), reused while it is '
  'unused and unexpired; null until the first Invite, or when the code was deleted.';

comment on table private.waitlist is
  'Addresses of people who asked for an invite on a reading page (issue #171). Written only by join_waitlist; '
  'read, invited, marked invited and deleted only by the instance owner (owner_waitlist*). The invite mail itself '
  'is sent by the waitlist-invite edge function, never from the database.';

create function public.owner_waitlist_prepare_invite(p_id uuid)
returns table (
  email      text,
  code       text,
  expires_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_email   text;
  v_code_id uuid;
  v_code    public.invite_codes;
begin
  if not private.is_instance_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  -- Locked, so two Invites at once (two devices, a double tap) share one code.
  select w.email::text, w.invite_code_id into v_email, v_code_id
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

  return query select v_email, v_code.code::text, v_code.expires_at;
end;
$$;

comment on function public.owner_waitlist_prepare_invite(uuid) is
  'The owner''s Invite (the waitlist-invite edge function calls it with her session): the entry''s address and a '
  'one-use invite code for it with its expiry. Reuses the entry''s code while it is unused and unexpired, else mints '
  'one (14 days, label waitlist) and keeps it on the entry. Does not mark the entry invited; the function does that '
  'after the mail went out. Raises not_owner for anyone but the instance owner, waitlist_entry_not_found for an '
  'unknown id.';

revoke all on function public.owner_waitlist_prepare_invite(uuid) from public, anon;
grant execute on function public.owner_waitlist_prepare_invite(uuid) to authenticated;

comment on function public.owner_waitlist_set_invited(uuid[], boolean) is
  'Marks waitlist entries invited (now, kept when already set) or, with false, waiting again. Answers how many entries '
  'it found. Raises not_owner for anyone but the instance owner. Sends nothing itself: the waitlist-invite edge '
  'function calls it once its mail went out, and the owner''s Mark invited is the manual path.';
