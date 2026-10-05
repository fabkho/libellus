-- Collections (issue #1, Data model; issue #14).
--
-- A Collection is a member's own shelf (Favourites, Sci-fi, Gifts…). It holds
-- Library entries, not Books, in the member's order, and it is non-exclusive:
-- an entry can sit in any number of Collections. `collections` is the shelf,
-- `collection_entries` one entry on it.
--
-- Rules, all here so every client gets them:
--   * Collections and their entries are visible only to their member (RLS),
--     and members never write either table directly: every change is one of
--     the functions below.
--   * Deleting a Collection never deletes an entry; deleting an entry (or the
--     member) takes its memberships with it.
--   * An entry on a Collection is always the Collection member's own entry.
--   * Adding a Book to a Collection puts it into the Library first, on Want to
--     read, if it is not there yet — in the same call (add_to_collection).

-- -------------------------------------------------------------- collections

create table public.collections (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references auth.users on delete cascade,
  name        text not null,
  -- The member's order of her Collections: new ones go to the end. Gaps are
  -- fine (a deleted Collection leaves one); only the order counts.
  position    integer not null,
  created_at  timestamptz not null default now(),

  constraint collections_name_present check (char_length(btrim(name)) between 1 and 80),
  constraint collections_name_trimmed check (name = btrim(name))
);

comment on table public.collections is
  'A member''s custom shelf. Private to its member. Written only through create_collection, '
  'rename_collection and delete_collection; deleting one never deletes a Library entry.';

-- One name per member, whatever its case: two "Sci-fi" shelves would be a mistake.
create unique index collections_name_once on public.collections (member_id, lower(name));
create index collections_by_position on public.collections (member_id, position);

-- -------------------------------------------------------- collection entries

create table public.collection_entries (
  collection_id  uuid not null references public.collections on delete cascade,
  entry_id       uuid not null references public.library_entries on delete cascade,
  -- The member's order inside the Collection, 1…n after a reorder; an added
  -- entry goes to the end.
  position       integer not null,
  added_at       timestamptz not null default now(),

  primary key (collection_id, entry_id),
  -- Deferred, so a reorder can move every row in one statement.
  constraint collection_entries_position_once unique (collection_id, position)
    deferrable initially deferred
);

comment on table public.collection_entries is
  'One Library entry on one Collection, in the member''s order. Private to the member. Written '
  'only through add_to_collection, remove_from_collection and reorder_collection.';

create index collection_entries_entry on public.collection_entries (entry_id);

-- The entry and the Collection belong to the same member. The functions check
-- it already; this keeps the import and anything later honest too.
create function public.collection_entries_same_member()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1 from public.collections c
      join public.library_entries e on e.member_id = c.member_id
     where c.id = new.collection_id and e.id = new.entry_id
  ) then
    raise exception 'entry_missing' using errcode = '23503';
  end if;
  return new;
end;
$$;

create trigger collection_entries_same_member
  before insert or update of collection_id, entry_id on public.collection_entries
  for each row execute function public.collection_entries_same_member();

-- ------------------------------------------------------------------------ RLS

alter table public.collections enable row level security;
alter table public.collection_entries enable row level security;

revoke all on public.collections from anon, authenticated;
revoke all on public.collection_entries from anon, authenticated;
grant select on public.collections to authenticated;
grant select on public.collection_entries to authenticated;

create policy collections_own on public.collections
  for select to authenticated
  using (member_id = (select auth.uid()));

create policy collection_entries_own on public.collection_entries
  for select to authenticated
  using (exists (
    select 1 from public.collections c
     where c.id = collection_id and c.member_id = (select auth.uid())
  ));

-- ------------------------------------------------------------------ helpers

-- The caller's Collection, locked for the rest of the call (positions are
-- handed out under it), or a clear refusal.
create function public.own_collection(p_collection uuid)
returns public.collections
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member     uuid := auth.uid();
  v_collection public.collections;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  select * into v_collection from public.collections
   where id = p_collection and member_id = v_member
   for update;
  if not found then
    raise exception 'collection_missing' using errcode = 'P0002';
  end if;
  return v_collection;
end;
$$;

revoke all on function public.own_collection(uuid) from public, anon, authenticated;

-- A name as it is stored: trimmed, inner runs of whitespace collapsed. Null
-- when nothing is left or it is too long.
create function public.collection_name(p_name text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when char_length(v) between 1 and 80 then v
  end
  from (select btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')) as v) t
$$;

revoke all on function public.collection_name(text) from public, anon, authenticated;

-- ------------------------------------------------------------ create, rename

-- Makes an empty Collection at the end of the member's list. Returns it.
--
-- Refusals, as `raise` messages with stable SQLSTATEs:
--   not_signed_in   42501  no member behind the call
--   name_invalid    22023  nothing but whitespace, or longer than 80 characters
--   name_taken      23505  the member already has a Collection by that name (any case)
create function public.create_collection(p_name text)
returns public.collections
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member     uuid := auth.uid();
  v_name       text := public.collection_name(p_name);
  v_collection public.collections;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if v_name is null then
    raise exception 'name_invalid' using errcode = '22023';
  end if;
  -- One member's creates queue up, so two never get the same position.
  perform pg_advisory_xact_lock(hashtext('collections:' || v_member::text));
  begin
    insert into public.collections (member_id, name, position)
    values (
      v_member, v_name,
      coalesce((select max(position) from public.collections where member_id = v_member), 0) + 1
    )
    returning * into v_collection;
  exception when unique_violation then
    raise exception 'name_taken' using errcode = '23505';
  end;
  return v_collection;
end;
$$;

-- Gives a Collection a new name. Returns it.
--
-- Refusals: not_signed_in, name_invalid, name_taken (as create_collection), and
--   collection_missing  P0002  not one of the member's Collections
create function public.rename_collection(p_collection uuid, p_name text)
returns public.collections
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_collection public.collections := public.own_collection(p_collection);
  v_name       text := public.collection_name(p_name);
begin
  if v_name is null then
    raise exception 'name_invalid' using errcode = '22023';
  end if;
  begin
    update public.collections set name = v_name where id = v_collection.id
    returning * into v_collection;
  exception when unique_violation then
    raise exception 'name_taken' using errcode = '23505';
  end;
  return v_collection;
end;
$$;

-- ------------------------------------------------------------------- delete

-- Deletes a Collection. Its memberships go with it; the Books stay in the
-- Library exactly as they were.
--
-- Refusals: not_signed_in, collection_missing
create function public.delete_collection(p_collection uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_collection public.collections := public.own_collection(p_collection);
begin
  delete from public.collections where id = v_collection.id;
end;
$$;

-- --------------------------------------------------------- add_to_collection

-- Puts a Book on a Collection, at its end, in one call. A Book that is not in
-- the member's Library yet goes in first, on Want to read. Returns the
-- member's Library entry for the Book (new or not).
--
-- `p_book` is either `{"id": <uuid>}` — a Book the member can see: a Catalogue
-- Book or her own Manual book — or a snapshot from search exactly as
-- `add_to_library` takes it, which finds the Catalogue Book (or adds the
-- snapshot to the Catalogue) the same way.
--
-- Refusals, as `raise` messages with stable SQLSTATEs:
--   not_signed_in          42501  no member behind the call
--   collection_missing     P0002  not one of the member's Collections
--   book_invalid           22023  no such Book for this member, or a snapshot add_to_library refuses
--   already_in_collection  23505  the Book is on this Collection already
create function public.add_to_collection(p_collection uuid, p_book jsonb)
returns public.library_entries
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_collection public.collections := public.own_collection(p_collection);
  v_member     uuid := v_collection.member_id;
  v_book_id    uuid;
  v_isbn13     text;
  v_apple_id   text;
  v_ol_key     text;
  v_entry      public.library_entries;
begin
  if p_book is null or jsonb_typeof(p_book) <> 'object' then
    raise exception 'book_invalid' using errcode = '22023';
  end if;

  if p_book ? 'id' then
    -- A Book by its id: only one this member may see.
    begin
      v_book_id := (p_book ->> 'id')::uuid;
    exception when invalid_text_representation then
      raise exception 'book_invalid' using errcode = '22023';
    end;
    perform 1 from public.books
     where id = v_book_id and (owner_id is null or owner_id = v_member);
    if not found then
      raise exception 'book_invalid' using errcode = '22023';
    end if;
  else
    -- A snapshot: the Catalogue Book add_to_library would find, in its order
    -- (an ISBN-13 first, then a source id), normalised the same way.
    v_isbn13   := nullif(upper(regexp_replace(p_book ->> 'isbn13', '[^0-9Xx]', '', 'g')), '');
    v_apple_id := nullif(p_book ->> 'apple_id', '');
    v_ol_key   := nullif(p_book ->> 'openlibrary_edition_key', '');
    select id into v_book_id from public.books
     where owner_id is null and v_isbn13 is not null and isbn13 = v_isbn13;
    if v_book_id is null then
      select id into v_book_id from public.books
       where owner_id is null
         and ((v_apple_id is not null and apple_id = v_apple_id)
           or (v_ol_key is not null and openlibrary_edition_key = v_ol_key))
       limit 1;
    end if;
  end if;

  if v_book_id is not null then
    select * into v_entry from public.library_entries
     where member_id = v_member and book_id = v_book_id;
  end if;

  if v_entry.id is null then
    if v_book_id is not null then
      -- In the Catalogue (or hers), not in her Library: Want to read.
      insert into public.library_entries (member_id, book_id, status)
      values (v_member, v_book_id, 'want_to_read')
      on conflict (member_id, book_id) do nothing
      returning * into v_entry;
      if v_entry.id is null then
        -- A concurrent add of the same Book won; use its entry.
        select * into v_entry from public.library_entries
         where member_id = v_member and book_id = v_book_id;
      end if;
    else
      -- New to the Catalogue: add_to_library takes the snapshot in, with all its checks.
      begin
        v_entry := public.add_to_library(p_book => p_book);
      exception when sqlstate '23505' then
        -- Added under another key in between; its entry is there now.
        select e.* into v_entry from public.library_entries e
          join public.books b on b.id = e.book_id
         where e.member_id = v_member and b.owner_id is null
           and ((v_isbn13 is not null and b.isbn13 = v_isbn13)
             or (v_apple_id is not null and b.apple_id = v_apple_id)
             or (v_ol_key is not null and b.openlibrary_edition_key = v_ol_key))
         limit 1;
        if v_entry.id is null then
          raise;
        end if;
      end;
    end if;
  end if;

  begin
    insert into public.collection_entries (collection_id, entry_id, position)
    values (
      v_collection.id, v_entry.id,
      coalesce((select max(position) from public.collection_entries where collection_id = v_collection.id), 0) + 1
    );
  exception when unique_violation then
    raise exception 'already_in_collection' using errcode = '23505';
  end;

  return v_entry;
end;
$$;

-- ---------------------------------------------------- remove_from_collection

-- Takes an entry off a Collection. The entry stays in the Library; the others
-- keep their order.
--
-- Refusals: not_signed_in, collection_missing, and
--   not_in_collection  P0002  the entry is not on this Collection
create function public.remove_from_collection(p_collection uuid, p_entry uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_collection public.collections := public.own_collection(p_collection);
begin
  delete from public.collection_entries
   where collection_id = v_collection.id and entry_id = p_entry;
  if not found then
    raise exception 'not_in_collection' using errcode = 'P0002';
  end if;
end;
$$;

-- -------------------------------------------------------- reorder_collection

-- Puts a Collection's entries into the given order: `p_entries` lists every
-- entry on it exactly once, first to last.
--
-- Refusals: not_signed_in, collection_missing, and
--   order_mismatch  22023  the list is not exactly the Collection's entries (it
--                          changed since the client read it: read it again)
create function public.reorder_collection(p_collection uuid, p_entries uuid[])
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_collection public.collections := public.own_collection(p_collection);
begin
  if p_entries is null
     or array_position(p_entries, null) is not null
     or cardinality(p_entries) <> (select count(distinct x) from unnest(p_entries) x)
     or cardinality(p_entries) <> (select count(*) from public.collection_entries
                                    where collection_id = v_collection.id)
     or exists (select 1 from unnest(p_entries) x
                 where not exists (select 1 from public.collection_entries
                                    where collection_id = v_collection.id and entry_id = x)) then
    raise exception 'order_mismatch' using errcode = '22023';
  end if;

  update public.collection_entries ce
     set position = o.n
    from unnest(p_entries) with ordinality as o(entry_id, n)
   where ce.collection_id = v_collection.id and ce.entry_id = o.entry_id;
end;
$$;

-- ------------------------------------------------------------------- grants

revoke all on function public.create_collection(text) from public, anon;
revoke all on function public.rename_collection(uuid, text) from public, anon;
revoke all on function public.delete_collection(uuid) from public, anon;
revoke all on function public.add_to_collection(uuid, jsonb) from public, anon;
revoke all on function public.remove_from_collection(uuid, uuid) from public, anon;
revoke all on function public.reorder_collection(uuid, uuid[]) from public, anon;
grant execute on function public.create_collection(text) to authenticated;
grant execute on function public.rename_collection(uuid, text) to authenticated;
grant execute on function public.delete_collection(uuid) to authenticated;
grant execute on function public.add_to_collection(uuid, jsonb) to authenticated;
grant execute on function public.remove_from_collection(uuid, uuid) to authenticated;
grant execute on function public.reorder_collection(uuid, uuid[]) to authenticated;
