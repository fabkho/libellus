-- The reader's place in a book, kept server-side (issue #131, phase 2; owner
-- decision 3 of 2026-10-06).
--
-- The built-in reader keeps where the member is in her own device's copy of an
-- EPUB; this table keeps the same place for the Library entry, so a second
-- device holding the same file opens it where she stopped. The *place* only,
-- never the content: an EPUB CFI (`epubcfi(/6/14[chap05]!/4/2/2[p17]:0)`), how
-- far through the book that is, and the fingerprint of the file it was read in
-- (SHA-256 of its first megabyte, phase 1's `hash`; web/app/data/ebooks/files.ts).
-- The other device compares that fingerprint with its own copy's: the same
-- file takes the CFI, a different edition of the same Book falls back to the
-- fraction. Nothing is uploaded, and no ebook ever leaves the device.
--
-- One place per Library entry (the entry already names its member), written by
-- the member herself through RLS: a place is a single row, so it needs no
-- multi-row function. It must never travel backwards in time, though — two
-- devices read the same book, and the one that syncs last is not the one that
-- read last — so a save carries the moment it was taken (`p_at`) and only a
-- newer place replaces a stored one:
--
--   save_reader_place(p_entry_id, p_cfi, p_fraction, p_file_hash, p_at)
--
-- which upserts under that rule and returns the stored row (the newer one,
-- which may be the one that was already there). A direct write cannot break
-- the rule either: `private.reader_places_forward_only` drops an update that is
-- not newer than the row it would replace. Reading is a plain select through
-- RLS.
--
-- A place goes with its entry (`on delete cascade`) and with its member
-- (auth.users cascades), so `delete_my_account` — which deletes the member's
-- entries and then her user — takes every place of hers with it.
--
-- Refusals, as `raise` messages with stable SQLSTATEs:
--   not_signed_in    42501  no member behind the call
--   entry_not_found  P0002  no such entry in this member's Library
--   place_invalid    22023  an empty or over-long CFI, a fraction outside 0–1,
--                           a fingerprint that is not 64 hex characters

create table public.reader_places (
  member_id  uuid not null default auth.uid() references auth.users on delete cascade,
  entry_id   uuid primary key references public.library_entries (id) on delete cascade,
  cfi        text not null,
  fraction   real not null,
  file_hash  text not null,
  updated_at timestamptz not null default now(),

  constraint reader_places_cfi_present check (char_length(cfi) between 1 and 2000),
  constraint reader_places_fraction_range check (fraction >= 0 and fraction <= 1),
  constraint reader_places_file_hash_sha256 check (file_hash ~ '^[0-9a-f]{64}$')
);

comment on table public.reader_places is
  'Issue #131: where the member is in a Library entry''s ebook — a CFI, the fraction it is through '
  'the book and the fingerprint of the file it was read in. The place only, never the content. '
  'One row per entry, hers alone; written through save_reader_place, which never goes backwards.';
comment on column public.reader_places.member_id is
  'The member the place belongs to; always the member of its entry. Her places go with her account.';
comment on column public.reader_places.entry_id is
  'The Library entry the place is in. One place per entry, and the entry names the member already.';
comment on column public.reader_places.cfi is
  'The EPUB CFI of the place, as the reader left it (at most 2000 characters). Only another copy '
  'of the same file (see file_hash) can follow it exactly.';
comment on column public.reader_places.fraction is
  'How far through the book the place is, 0–1. What a device with another copy of the Book uses.';
comment on column public.reader_places.file_hash is
  'SHA-256 (64 hex characters) of the first megabyte of the file the place was read in, phase 1''s '
  'fingerprint, so a device knows whether the CFI fits its own copy.';
comment on column public.reader_places.updated_at is
  'When the place was taken on the device that saved it. A save older than this one is ignored.';

-- The foreign key to auth.users, indexed for the cascade (the primary key
-- covers the one to library_entries).
create index reader_places_member on public.reader_places (member_id);

-- --------------------------------------------------------------- forward only

create schema if not exists private;

-- A place never travels backwards: an update that is not newer than the row it
-- would replace is dropped, whoever writes it. `save_reader_place` says the
-- same in its upsert; this keeps a direct write honest too.
create function private.reader_places_forward_only()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.updated_at <= old.updated_at then
    return null;
  end if;
  return new;
end;
$$;

revoke all on function private.reader_places_forward_only() from public, anon, authenticated;

create trigger reader_places_forward_only
  before update on public.reader_places
  for each row execute function private.reader_places_forward_only();

-- ------------------------------------------------------------------------ RLS

alter table public.reader_places enable row level security;

-- Supabase grants everything on a new public table to the API roles. A member
-- reads and writes her own places (one row at a time, under RLS); nothing else
-- touches them, and nobody deletes one by hand (it goes with its entry).
revoke all on public.reader_places from anon, authenticated;
grant select, insert, update on public.reader_places to authenticated;

-- Hers, and only on an entry of hers: the member column and the entry's must
-- both be the caller.
create policy reader_places_select_own on public.reader_places
  for select to authenticated
  using (member_id = (select auth.uid()));

create policy reader_places_insert_own on public.reader_places
  for insert to authenticated
  with check (
    member_id = (select auth.uid())
    and exists (
      select 1 from public.library_entries e
       where e.id = entry_id and e.member_id = (select auth.uid())
    )
  );

create policy reader_places_update_own on public.reader_places
  for update to authenticated
  using (member_id = (select auth.uid()))
  with check (
    member_id = (select auth.uid())
    and exists (
      select 1 from public.library_entries e
       where e.id = entry_id and e.member_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------- save_reader_place

-- Saves where the member is in her entry's ebook and returns the place that
-- stands afterwards: the one sent, or the newer one that was there already.
-- `p_at` is when the place was taken on the device; a clock that runs more than
-- a minute ahead is brought back to now, so no device can park a place in the
-- future and silence the others.
--
-- Security invoker on purpose: the member writes her own single row, and RLS
-- (plus the trigger above) is what allows it.
create function public.save_reader_place(
  p_entry_id  uuid,
  p_cfi       text,
  p_fraction  real,
  p_file_hash text,
  p_at        timestamptz default now()
)
returns public.reader_places
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_member uuid := auth.uid();
  v_at     timestamptz;
  v_row    public.reader_places;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.library_entries e where e.id = p_entry_id and e.member_id = v_member
  ) then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;
  if p_cfi is null or char_length(p_cfi) not between 1 and 2000
     or p_fraction is null or p_fraction < 0 or p_fraction > 1
     or p_file_hash is null or p_file_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'place_invalid' using errcode = '22023';
  end if;

  v_at := coalesce(p_at, now());
  if v_at > now() + interval '1 minute' then
    v_at := now();
  end if;

  insert into public.reader_places as p (member_id, entry_id, cfi, fraction, file_hash, updated_at)
  values (v_member, p_entry_id, p_cfi, p_fraction, p_file_hash, v_at)
  on conflict (entry_id) do update
    set cfi        = excluded.cfi,
        fraction   = excluded.fraction,
        file_hash  = excluded.file_hash,
        updated_at = excluded.updated_at
    where excluded.updated_at > p.updated_at
  returning p.* into v_row;

  -- Nothing was written: a newer place is already stored. That one stands.
  if v_row.entry_id is null then
    select * into v_row from public.reader_places where entry_id = p_entry_id;
  end if;
  return v_row;
end;
$$;

comment on function public.save_reader_place(uuid, text, real, text, timestamptz) is
  'Issue #131: saves the member''s place in her entry''s ebook (CFI, fraction, file fingerprint) '
  'and returns the place that stands. A save older than the stored one is ignored.';

revoke all on function public.save_reader_place(uuid, text, real, text, timestamptz) from public, anon;
grant execute on function public.save_reader_place(uuid, text, real, text, timestamptz) to authenticated;
