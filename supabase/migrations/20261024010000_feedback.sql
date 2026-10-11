-- Contact: a member reports a bug or asks for a feature from the Profile, without e-mail.
--
--   public.feedback               one row a message: who, what kind, what she wrote, what the app attached
--   private.feedback_rate_limit() BEFORE INSERT: at most 5 an hour and 20 a day per member (PT429 rate_limited)
--   feedback_list(limit, before)  the owner's inbox, newest first, with who wrote it
--   feedback_mark_handled(id, handled)  the owner's Mark handled
--
-- A member may INSERT her own row and nothing else: no select, update or delete, not even of her own
-- rows (the sheet needs no list, and the owner's note and handled state are not hers to read). The
-- owner reads and marks through two SECURITY DEFINER functions guarded exactly like the waitlist's
-- (private.is_instance_owner(), `not_owner` 42501, a pinned search_path, not granted to anon).
-- Members write `kind`, `body` and `context` (and `member_id`, which must be her own); `handled_at`,
-- `owner_note`, `id` and `created_at` are the database's and the owner's.
--
-- `context` is what the app attached without being asked (the sheet says so): app build, route
-- pattern, display mode, platform, a short browser string, locale, online state, screen size.
-- Never the Library, never a token. It is client-made, so the database only bounds it (a JSON
-- object, at most 4000 bytes); the owner's screen shows it as text in a collapsed block.

create table public.feedback (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind        text not null,
  body        text not null,
  context     jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  handled_at  timestamptz,
  owner_note  text,
  constraint feedback_kind check (kind in ('bug', 'feature', 'other')),
  constraint feedback_body_length check (char_length(body) between 10 and 2000),
  -- Ten blanks are not a message: what is left after trimming has to be a message too.
  constraint feedback_body_trimmed check (char_length(btrim(body)) >= 10),
  constraint feedback_context_object check (jsonb_typeof(context) = 'object'),
  constraint feedback_context_size check (octet_length(context::text) <= 4000),
  constraint feedback_owner_note_length check (owner_note is null or char_length(owner_note) <= 2000)
);

comment on table public.feedback is
  'Messages members send from Profile > Contact (a bug, a feature request, something else). Members insert their own '
  'row and read nothing back; the instance owner reads and marks them through feedback_list and feedback_mark_handled.';
comment on column public.feedback.context is
  'What the app attached: build, route pattern, display mode, platform, short browser string, locale, online, screen. '
  'Client-made, so only its shape and size are checked (an object, 4000 bytes at most). Shown as text, never as markup.';
comment on column public.feedback.owner_note is 'The owner''s own note on a message; never shown to the member.';

-- The cascade from auth.users and the rate limit's count both go by member and time.
create index feedback_member_created on public.feedback (member_id, created_at desc);
-- The owner's list, newest first.
create index feedback_created on public.feedback (created_at desc);

alter table public.feedback enable row level security;

revoke all on public.feedback from public, anon, authenticated;
grant insert (member_id, kind, body, context) on public.feedback to authenticated;
grant select, insert, update, delete on public.feedback to service_role;

create policy feedback_insert_own on public.feedback
  for insert to authenticated
  with check (member_id = (select auth.uid()));

-- --------------------------------------------------------------- the rate limit

-- The trigger counts the member's rows, which she cannot read herself: security definer, and in
-- `private` so no API role can call it (it also keeps the list of public trigger functions as it was).
create function private.feedback_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

comment on function private.feedback_rate_limit() is
  'BEFORE INSERT on public.feedback: at most 5 messages an hour and 20 a day per member; the next one is refused '
  'with rate_limited (SQLSTATE PT429, which PostgREST answers as HTTP 429).';

revoke all on function private.feedback_rate_limit() from public, anon, authenticated;

create trigger feedback_rate_limit
  before insert on public.feedback
  for each row execute function private.feedback_rate_limit();

-- --------------------------------------------------------------- the owner's side

create function public.feedback_list(p_limit integer default 30, p_before timestamptz default null)
returns table (
  id            uuid,
  kind          text,
  body          text,
  context       jsonb,
  created_at    timestamptz,
  handled_at    timestamptz,
  member_name   text,
  member_email  text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not private.is_instance_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  return query
    select f.id, f.kind, f.body, f.context, f.created_at, f.handled_at,
           private.reading_page_name(f.member_id),
           (select u.email::text from auth.users u where u.id = f.member_id)
      from public.feedback f
     where p_before is null or f.created_at < p_before
     order by f.created_at desc, f.id
     limit least(greatest(coalesce(p_limit, 30), 1), 100);
end;
$$;

comment on function public.feedback_list(integer, timestamptz) is
  'The instance owner''s inbox, newest first, a page of at most 100 (default 30) older than p_before: kind, text, '
  'context, when, when handled, and who wrote it (first name and address). Raises not_owner for anyone else.';

revoke all on function public.feedback_list(integer, timestamptz) from public, anon;
grant execute on function public.feedback_list(integer, timestamptz) to authenticated;

create function public.feedback_mark_handled(p_id uuid, p_handled boolean default true)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_changed integer;
begin
  if not private.is_instance_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  update public.feedback f
     set handled_at = case when coalesce(p_handled, true) then coalesce(f.handled_at, now()) end
   where f.id = p_id;
  get diagnostics v_changed = row_count;
  return v_changed > 0;
end;
$$;

comment on function public.feedback_mark_handled(uuid, boolean) is
  'Marks one message handled (now, kept when already set) or, with false, open again. Answers whether it found the '
  'message. Raises not_owner for anyone but the instance owner.';

revoke all on function public.feedback_mark_handled(uuid, boolean) from public, anon;
grant execute on function public.feedback_mark_handled(uuid, boolean) to authenticated;
