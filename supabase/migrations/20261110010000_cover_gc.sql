-- Own covers, part 6: deletion (docs/plans/owned-covers.md §6). A stored image is kept while ANY Book that a
-- `library_entries` row points at has its key; once none does it is marked, and 30 days later the cover-store function
-- deletes it from R2 (`{"action":"gc"}`). Removing a Book from a Library deletes nothing at once.
--
--   private.cover_objects.gc_retry_at   a failed delete is not tried again before this (a week's run, not the same run's loop)
--   public.cover_gc_mark()              weekly: orphaned_at = now() on objects no catalogued Book uses; cleared on objects used again
--   public.cover_gc_claim(limit)        ONE statement: the objects orphaned > 30 days and still unused get deleting_at (the lease),
--                                       and every Book still pointing at one loses cover_key/cover_widths; answers key and widths
--   public.cover_gc_done(keys)          every width is deleted from R2: the rows go
--   public.cover_gc_failed(keys)        a delete failed: the rows stay, released, and are tried again next week
--   private.cover_gc_weekly()           pg_cron `cover-store-gc`, Sunday night: mark, then kick the function
--   private.cover_gc_kick()             posts `{"action":"gc"}` (pg_net, the Vault secret `cover_store_token`), as the tick does
--
-- GC DELETION IS IRREVERSIBLE: a deleted object comes back only by storing the cover again from its source. So nothing
-- here acts while the feature is off: the weekly job, the mark, the kick AND the claim all answer "nothing" while
-- `private.cover_store_settings.enabled` is false, whoever calls them, so even a hand-posted `gc` deletes nothing.
--
-- **What protects a key:** a Book that a `library_entries` row points at. A Book outside every Library does NOT (the spec's
-- rule: the copy is for Books members hold): its key stays while the object is merely marked, so a Book removed and added
-- back within the grace finds its copy, and the claim clears it once the grace has run out.
--
-- **The grace restarts when a Library holds the key again.** The weekly mark clears a mark it finds used, but a Book can be
-- added to a Library and removed again between two marks, and the claim would then trust a stale `orphaned_at`. So a trigger
-- on `library_entries` clears the mark of the Book's key the moment an entry is added (`cover_gc_entry_added`); the next
-- mark orphans it afresh and the 30 days start over. The other way a key becomes used, `cover_store_done`, clears it itself.
--
-- Store against delete, reserve first (cover_store_reserve, 20261108010000): the reservation and the claim lock the same
-- `cover_objects` row. A reservation that comes first clears `orphaned_at`, and the claim, which re-checks it on the locked
-- row (`for update` re-reads it under READ COMMITTED), no longer takes it; one that comes after sees `deleting_at` and
-- refuses (the Book's row retries in 10 minutes, after cover_gc_done, and uploads afresh). `cover_store_done` writes the
-- object row first and clears `orphaned_at` in the same transaction as the Book's key, so a Book never gets a key whose
-- object a claim can take. A Library entry added in a transaction the claim cannot see yet may point at a Book whose key
-- the claim then clears: the Book now has no key, the next reconcile queues it, the store waits out `deleting_at` and
-- uploads again. A device that read the key in between shows the source for that cover until then.
--
-- Refusals: none; the functions answer empty or zero. Service role only (as the store's functions).

alter table private.cover_objects add column gc_retry_at timestamptz;

comment on column private.cover_objects.orphaned_at is
  'Set by cover_gc_mark when no Book in a Library uses the key; the object is deleted 30 days later. Cleared when used again.';
comment on column private.cover_objects.deleting_at is
  'GC holds this object (cover_gc_claim): a store of the key is refused meanwhile. Released by cover_gc_failed; a run that '
  'died leaves it, and the claim takes the row again after 15 minutes.';
comment on column private.cover_objects.gc_retry_at is
  'After a failed delete (cover_gc_failed): not claimed again before this.';

-- Whether the feature is on: GC does nothing at all while it is off.
create function private.cover_gc_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select enabled from private.cover_store_settings where id), false)
$$;

-- ------------------------------------------------- a Library holds the key

-- An entry is added: the Book's key is used again, so its mark (if any) goes and the 30 days start over at the next mark.
-- Not while GC holds the object (`deleting_at`): the claim already cleared the Book's key, and the reconcile stores it afresh.
create function private.cover_gc_entry_added()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.cover_objects o
     set orphaned_at = null
    from public.books b
   where b.id = new.book_id
     and o.key = b.cover_key
     and o.orphaned_at is not null
     and o.deleting_at is null;
  return null;
end
$$;

create trigger library_entries_cover_gc_grace
after insert on public.library_entries
for each row
execute function private.cover_gc_entry_added();

-- --------------------------------------------------------------- mark

-- Weekly. Marks the objects no Book in a Library uses (`orphaned_at = now()`, the 30 days start) and clears the mark on
-- objects used again. Objects GC holds (`deleting_at`) are left alone. A mark that races a store (the store's done
-- commits between the scan and the write) is harmless: the claim re-checks, and the next mark clears it.
-- Answers counts: { state: 'off' | 'ran', marked, cleared }.
create function public.cover_gc_mark()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_marked integer;
  v_cleared integer;
begin
  if not private.cover_gc_enabled() then return jsonb_build_object('state', 'off', 'marked', 0, 'cleared', 0); end if;

  update private.cover_objects o
     set orphaned_at = now()
   where o.orphaned_at is null
     and o.deleting_at is null
     and not exists (select 1 from public.books b
                      where b.cover_key = o.key
                        and exists (select 1 from public.library_entries e where e.book_id = b.id));
  get diagnostics v_marked = row_count;

  update private.cover_objects o
     set orphaned_at = null
   where o.orphaned_at is not null
     and o.deleting_at is null
     and exists (select 1 from public.books b
                  where b.cover_key = o.key
                    and exists (select 1 from public.library_entries e where e.book_id = b.id));
  get diagnostics v_cleared = row_count;

  return jsonb_build_object('state', 'ran', 'marked', v_marked, 'cleared', v_cleared);
end
$$;

-- -------------------------------------------------------------- claim

-- ONE statement. For objects whose `orphaned_at` is older than 30 days as read in that statement and that no Book in a
-- Library uses: sets `deleting_at` (locking the rows, so a store of the key waits or is refused) and clears
-- `cover_key`/`cover_widths` on every Book still pointing at them. `skip locked` leaves a row a reservation holds. A row
-- GC holds since more than 15 minutes (a run that died) is claimed again; one that failed waits for `gc_retry_at`.
-- Answers the key and its widths as the database knows them (null = a reservation whose upload did not finish); the function
-- deletes those AND whatever else R2 holds under exactly `c/<key>/` (a later re-store with another width set).
create function public.cover_gc_claim(p_limit integer default 100)
returns table (key text, widths smallint[])
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not private.cover_gc_enabled() then return; end if;

  return query
    with picked as (
      select o.key
        from private.cover_objects o
       where o.orphaned_at < now() - interval '30 days'
         and (o.deleting_at is null or o.deleting_at < now() - interval '15 minutes')
         and (o.gc_retry_at is null or o.gc_retry_at <= now())
         and not exists (select 1 from public.books b
                          where b.cover_key = o.key
                            and exists (select 1 from public.library_entries e where e.book_id = b.id))
       order by o.orphaned_at, o.key
       limit least(greatest(coalesce(p_limit, 100), 1), 200)
         for update of o skip locked
    ), claimed as (
      update private.cover_objects o
         set deleting_at = now()
        from picked p
       where o.key = p.key
         and o.orphaned_at < now() - interval '30 days'
         and (o.deleting_at is null or o.deleting_at < now() - interval '15 minutes')
      returning o.key, o.widths
    ), cleared as (
      update public.books b
         set cover_key = null, cover_widths = null
        from claimed c
       where b.cover_key = c.key
      returning b.id
    )
    select c.key, c.widths from claimed c;
end
$$;

-- ---------------------------------------------------- done and failed

-- Every width of these keys is deleted from R2 (a missing object counts as deleted): the rows go. Only rows GC holds.
create function public.cover_gc_done(p_keys text[])
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from private.cover_objects o
   where o.key = any (coalesce(p_keys, '{}'))
     and o.deleting_at is not null;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

-- A delete failed: the rows stay, released (a store of the key is accepted again and uploads afresh, which is idempotent),
-- and are not claimed again for six days: the next weekly run tries them. Nothing is lost by a half-deleted object: no
-- Book points at it (the claim cleared them) and a store puts every width again.
create function public.cover_gc_failed(p_keys text[])
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update private.cover_objects o
     set deleting_at = null, gc_retry_at = now() + interval '6 days'
   where o.key = any (coalesce(p_keys, '{}'))
     and o.deleting_at is not null;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

-- ---------------------------------------------------- the weekly job

-- Whether the claim has anything to take (the kick's idle check; the claim itself re-checks everything).
create function private.cover_gc_due()
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from private.cover_objects o
     where o.orphaned_at < now() - interval '30 days'
       and (o.deleting_at is null or o.deleting_at < now() - interval '15 minutes')
       and (o.gc_retry_at is null or o.gc_retry_at <= now())
  )
$$;

-- Posts `{"action":"gc"}` to the function, as cover_store_kick posts `run`. Answers 'off', 'idle', 'unavailable' or 'sent'.
create function private.cover_gc_kick()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings private.cover_store_settings;
  v_token text;
  v_request bigint;
begin
  select * into v_settings from private.cover_store_settings where id;
  if not coalesce(v_settings.enabled, false) or v_settings.function_url is null then return 'off'; end if;
  if not private.cover_gc_due() then return 'idle'; end if;
  if to_regprocedure('net.http_post(text, jsonb, jsonb, jsonb, integer)') is null
     or to_regclass('vault.decrypted_secrets') is null then
    return 'unavailable';
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1'
    into v_token using 'cover_store_token';
  if nullif(btrim(v_token), '') is null then return 'unavailable'; end if;

  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 150000)'
    into v_request
    using v_settings.function_url,
          jsonb_build_object('action', 'gc'),
          jsonb_build_object('Authorization', 'Bearer ' || btrim(v_token), 'Content-Type', 'application/json');
  return 'sent';
end
$$;

-- pg_cron, Sunday night: does nothing while the feature is off. Marks, then asks the function to delete what has been
-- orphaned for 30 days. Answers 'off' or what the kick answered.
create function private.cover_gc_weekly()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not private.cover_gc_enabled() then return 'off'; end if;
  perform public.cover_gc_mark();
  -- A kick that fails (pg_net, the Vault) must not roll the mark back: the claim finds the rows next week anyway.
  begin
    return private.cover_gc_kick();
  exception when others then
    return 'unavailable';
  end;
end
$$;

-- -------------------------------------------------------------- grants

revoke all on function private.cover_gc_enabled() from public, anon, authenticated;
revoke all on function private.cover_gc_entry_added() from public, anon, authenticated;
revoke all on function private.cover_gc_due() from public, anon, authenticated;
revoke all on function private.cover_gc_kick() from public, anon, authenticated;
revoke all on function private.cover_gc_weekly() from public, anon, authenticated;
revoke all on function public.cover_gc_mark() from public, anon, authenticated;
revoke all on function public.cover_gc_claim(integer) from public, anon, authenticated;
revoke all on function public.cover_gc_done(text[]) from public, anon, authenticated;
revoke all on function public.cover_gc_failed(text[]) from public, anon, authenticated;
grant execute on function public.cover_gc_mark() to service_role;
grant execute on function public.cover_gc_claim(integer) to service_role;
grant execute on function public.cover_gc_done(text[]) to service_role;
grant execute on function public.cover_gc_failed(text[]) to service_role;

-- ------------------------------------------------------------- pg_cron

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.schedule('cover-store-gc', '30 2 * * 0', 'select private.cover_gc_weekly()');
    exception when others then
      raise warning 'cover-store-gc could not be scheduled (%): stored covers are never deleted until it is (it does nothing while private.cover_store_settings.enabled is false)', sqlerrm;
    end;
  else
    raise warning 'pg_cron is not here: stored covers are never deleted (enable pg_cron, then schedule cover-store-gc: select cron.schedule(''cover-store-gc'', ''30 2 * * 0'', ''select private.cover_gc_weekly()''))';
  end if;
end;
$$;
