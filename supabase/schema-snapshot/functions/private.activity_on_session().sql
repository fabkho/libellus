CREATE OR REPLACE FUNCTION private.activity_on_session()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_kind    text;
  v_day     date;
  v_member  uuid;
  v_visible timestamptz;
begin
  begin
    -- 0. The entry's `want`, written by the statement that is writing this session.
    delete from public.activity
     where entry_id = new.entry_id
       and kind = 'want'
       and created_at = statement_timestamp();

    -- 1. Quiet.
    if private.activity_quiet() then
      return null;
    end if;

    -- What this write is.
    if tg_op = 'INSERT' then
      if new.outcome is null then
        v_kind := 'started';
        v_day := new.started_on;
      else
        v_kind := new.outcome::text;
        v_day := new.ended_on;
      end if;
    elsif old.outcome is null and new.outcome is not null then
      v_kind := new.outcome::text;
      v_day := new.ended_on;
    elsif old.review is null and new.review is not null and old.outcome = 'finished' then
      v_kind := 'reviewed';
      v_day := new.ended_on;
    else
      return null;
    end if;

    -- 2. Old news.
    if v_kind in ('finished', 'abandoned')
       and (new.ended_on is null or new.ended_on < (now() at time zone 'utc')::date - 14) then
      return null;
    end if;

    -- A review counts once the finish it follows is visible.
    if v_kind = 'reviewed' and not exists (
      select 1 from public.activity a
       where a.session_id = new.id and a.kind = 'finished' and a.visible_at <= now()
    ) then
      return null;
    end if;

    select e.member_id into v_member from public.library_entries e where e.id = new.entry_id;
    if v_member is null then
      return null;
    end if;

    -- 3. Settle. A correction inside the window replaces what was written; `reviewed`
    -- replaces nothing.
    v_visible := now() + (select c.settle_window from private.social_config c);
    if v_kind <> 'reviewed' then
      delete from public.activity
       where visible_at > now()
         and (session_id = new.id or (entry_id = new.entry_id and kind = 'want'));
    end if;

    -- 4. Once.
    insert into public.activity (member_id, entry_id, session_id, kind, on_day, visible_at)
    values (v_member, new.entry_id, new.id, v_kind, v_day, v_visible)
    on conflict (session_id, kind) do nothing;
  exception when others then
    raise warning 'activity not written for session %: %', new.id, sqlerrm;
  end;
  return null;
end;
$function$
;
