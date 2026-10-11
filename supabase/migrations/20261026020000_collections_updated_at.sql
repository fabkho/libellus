-- Collections are listed by last edited, most recently edited first.
--
-- A Collection is "edited" when its own row changes (a rename) or when what is
-- on it changes: a Book put on it, taken off it, or its Books put in a new
-- order. `collections.updated_at` holds the time of the latest of these; the
-- app sorts its lists by it (name breaks a tie). The cover is not stored (it
-- is the first Book on the Collection), so a new cover is a reorder or an add.
--
-- Kept by triggers, so every path that writes (the collection functions, the
-- imports, a Library entry removed, which takes its memberships along) bumps
-- it without each of them remembering to.
--
-- Existing Collections: `updated_at` starts at the latest time a Book was put
-- on them (`collection_entries.added_at`), or the Collection's `created_at`
-- when that is later or when it is empty. Removals and renames left no
-- timestamp, so they cannot be recovered; nothing else is touched.
--
-- Idempotent: safe to run again.

alter table public.collections add column if not exists updated_at timestamptz;

update public.collections c
   set updated_at = greatest(
     c.created_at,
     coalesce((select max(e.added_at) from public.collection_entries e where e.collection_id = c.id), c.created_at)
   )
 where c.updated_at is null;

alter table public.collections alter column updated_at set default now();
alter table public.collections alter column updated_at set not null;

comment on column public.collections.updated_at is
  'When the Collection was last edited: renamed, or a Book put on it, taken off it or moved within it. '
  'The Collections list is sorted by it, latest first.';

create index if not exists collections_by_edited on public.collections (member_id, updated_at desc);

-- A rename (the only change to the row itself) is an edit.
create or replace function public.collections_touch()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.name is distinct from old.name then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists collections_touch on public.collections;
create trigger collections_touch
  before update on public.collections
  for each row execute function public.collections_touch();

-- A Book put on a Collection, taken off it, or moved within it is an edit of
-- the Collection. A reorder updates many rows in one statement: after the
-- first the row already has this transaction's time and is left alone.
create or replace function public.collection_entries_touch()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.collections
     set updated_at = now()
   where id = coalesce(new.collection_id, old.collection_id)
     and updated_at < now();
  return null;
end;
$$;

drop trigger if exists collection_entries_touch on public.collection_entries;
create trigger collection_entries_touch
  after insert or delete or update of position on public.collection_entries
  for each row execute function public.collection_entries_touch();

revoke all on function public.collections_touch() from public, anon, authenticated;
revoke all on function public.collection_entries_touch() from public, anon, authenticated;
