-- One canonical genre list, the Books' computed genres and the member's own
-- (issues #166, #168).
--
-- `genres` is the short, stable list every source is mapped onto: Apple Books'
-- genre names, Wikidata's genre items (P136) and Open Library's subjects. The
-- mapping itself lives in code, shared by the `enrich` edge function and the
-- app (web/app/data/enrich/genres.ts, GENRE_MAP_VERSION), and is applied by the
-- function, which stores up to three genres a Catalogue Book in `book_genres`.
-- The list here and GENRES there are one list: a pgTAP test and a Vitest test
-- hold them together.
--
-- A member may correct a Book's genres for herself: `entry_genres` holds her
-- choice for one Library entry (keyed by the entry, so it follows the entry
-- through Change edition). Her choice replaces the computed genres for her,
-- never for anyone else; an empty choice means "no genre". Removing it
-- (`reset_entry_genres`) brings the computed ones back.
--
--   book_genres(p_book)               the Book's genres for her: hers, else the computed ones
--   library_genres()                  the same for every entry of her Library, in one call
--   set_entry_genres(p_entry, p_genres)   her choice for one entry (0–3 genres)
--   reset_entry_genres(p_entry)       back to the computed genres
--
-- Catalogue facts (`genres`, `book_genres`) are readable by every member and
-- written only by the service role (the edge function). `entry_genres` is the
-- member's alone, readable through RLS, written only through the functions.
--
-- Refusals, as `raise` messages with stable SQLSTATEs:
--   not_signed_in    42501  no member behind the call
--   entry_not_found  P0002  no such entry in this member's Library
--   genres_invalid   22023  an unknown genre id, or more than three

-- --------------------------------------------------------------------- genres

create table public.genres (
  id        text primary key,
  -- The order the app lists them in.
  position  smallint not null unique,
  -- English, for people reading SQL; the app's labels are i18n keys `genre.<id>`.
  label     text not null,
  fiction   boolean not null,

  constraint genres_id_format check (id ~ '^[a-z][a-z-]{1,30}$')
);

comment on table public.genres is
  'Issue #168: the canonical genre list (stable ids) every source is mapped onto '
  '(web/app/data/enrich/genres.ts). Readable by every member; changed only by a migration.';

insert into public.genres (id, position, label, fiction) values
  ('sci-fi',         1, 'Science fiction',         true),
  ('fantasy',        2, 'Fantasy',                 true),
  ('horror',         3, 'Horror',                  true),
  ('crime',          4, 'Crime & mystery',         true),
  ('thriller',       5, 'Thriller',                true),
  ('romance',        6, 'Romance',                 true),
  ('literary',       7, 'Literary fiction',        true),
  ('historical',     8, 'Historical fiction',      true),
  ('classics',       9, 'Classics',                true),
  ('ya',            10, 'Young adult',             true),
  ('graphic',       11, 'Graphic novels & comics', true),
  ('poetry',        12, 'Poetry',                  true),
  ('short-stories', 13, 'Short stories',           true),
  ('nonfiction',    14, 'Non-fiction',             false),
  ('biography',     15, 'Biography & memoir',      false),
  ('history',       16, 'History',                 false),
  ('science',       17, 'Science',                 false),
  ('philosophy',    18, 'Philosophy',              false),
  ('self-help',     19, 'Self-help',               false),
  ('essays',        20, 'Essays',                  false);

-- ---------------------------------------------------------------- book_genres

create table public.book_genres (
  book_id      uuid not null references public.books on delete cascade,
  genre_id     text not null references public.genres on update cascade,
  -- 1 = the Book's main genre. Unique per Book, so a Book has three at most.
  rank         smallint not null,
  -- The source that said it loudest (the mapping's `RankedGenre.source`).
  source       text not null,
  confidence   real not null,
  -- GENRE_MAP_VERSION of the mapping that computed it.
  map_version  integer not null,
  computed_at  timestamptz not null default now(),

  primary key (book_id, genre_id),
  constraint book_genres_rank_unique unique (book_id, rank),
  constraint book_genres_rank_range check (rank between 1 and 3),
  constraint book_genres_source check (source in ('wikidata', 'apple', 'openlibrary')),
  constraint book_genres_confidence_range check (confidence > 0 and confidence <= 1),
  constraint book_genres_map_version_positive check (map_version > 0)
);

comment on table public.book_genres is
  'Issue #168: a Catalogue Book''s computed genres, at most three (rank 1–3), by the enrich edge '
  'function from every source''s genres. Readable by every member, written only by the service role.';

create index book_genres_genre on public.book_genres (genre_id);

-- --------------------------------------------------------------- entry_genres

create table public.entry_genres (
  entry_id    uuid primary key references public.library_entries (id) on delete cascade,
  member_id   uuid not null references auth.users on delete cascade,
  -- In her order; empty = she says the Book has no genre.
  genre_ids   text[] not null,
  updated_at  timestamptz not null default now(),

  constraint entry_genres_at_most_three check (cardinality(genre_ids) <= 3),
  constraint entry_genres_no_nulls check (array_position(genre_ids, null) is null)
);

comment on table public.entry_genres is
  'Issue #168: the member''s own genres for one Library entry (0–3 canonical ids), replacing the '
  'computed ones for her. Hers alone; written through set_entry_genres / reset_entry_genres.';

create index entry_genres_member on public.entry_genres (member_id);

-- ------------------------------------------------------------------------ RLS

alter table public.genres enable row level security;
alter table public.book_genres enable row level security;
alter table public.entry_genres enable row level security;

revoke all on public.genres, public.book_genres, public.entry_genres from anon, authenticated;
grant select on public.genres, public.book_genres, public.entry_genres to authenticated;
grant select on public.genres to service_role;
grant select, insert, update, delete on public.book_genres, public.entry_genres to service_role;

create policy genres_readable on public.genres
  for select to authenticated using (true);

-- Every member reads a Catalogue Book's genres; a Manual book has none computed,
-- and should one ever, only its owner sees it (books' own policy decides).
create policy book_genres_readable on public.book_genres
  for select to authenticated
  using (exists (select 1 from public.books b where b.id = book_id));

create policy entry_genres_own on public.entry_genres
  for select to authenticated
  using (member_id = (select auth.uid()));

-- -------------------------------------------------------------- the readers

-- The Book's genres for the member: her own for her entry of it, if she chose
-- any, else the computed ones; in rank order. `source` is 'member' for hers.
-- Security invoker: it reads only what RLS lets her read.
create function public.book_genres(p_book uuid)
returns table (genre_id text, rank smallint, source text, overridden boolean)
language sql
stable
set search_path = pg_catalog, public
as $$
  with mine as (
    select g.genre_ids
      from public.entry_genres g
      join public.library_entries e on e.id = g.entry_id
     where e.book_id = p_book and e.member_id = (select auth.uid())
     limit 1
  )
  select t.id, t.n::smallint, 'member', true
    from mine, unnest(mine.genre_ids) with ordinality as t(id, n)
  union all
  select bg.genre_id, bg.rank, bg.source, false
    from public.book_genres bg
   where bg.book_id = p_book
     and not exists (select 1 from mine)
  order by 2
$$;

comment on function public.book_genres(uuid) is
  'Issue #168: a Book''s genres for the calling member — her own choice for her entry of it, else '
  'the computed ones (book_genres the table) — in rank order.';

-- Every entry of her Library with its genres, the same rule as book_genres(),
-- in one call: what the Library's genre filter and the Profile's figures read.
create function public.library_genres()
returns table (entry_id uuid, book_id uuid, genre_ids text[], overridden boolean)
language sql
stable
set search_path = pg_catalog, public
as $$
  select e.id,
         e.book_id,
         coalesce(g.genre_ids,
                  array(select bg.genre_id from public.book_genres bg
                         where bg.book_id = e.book_id order by bg.rank),
                  '{}'),
         g.entry_id is not null
    from public.library_entries e
    left join public.entry_genres g on g.entry_id = e.id
   where e.member_id = (select auth.uid())
$$;

comment on function public.library_genres() is
  'Issue #168: every entry of the calling member''s Library with its genres (hers, else computed).';

revoke all on function public.book_genres(uuid) from public, anon;
revoke all on function public.library_genres() from public, anon;
grant execute on function public.book_genres(uuid) to authenticated, service_role;
grant execute on function public.library_genres() to authenticated, service_role;

-- -------------------------------------------------------------- the writers

-- Her genres for one entry: 0–3 canonical ids, in her order (duplicates folded).
-- Returns what book_genres() now answers for the entry's Book.
create function public.set_entry_genres(p_entry uuid, p_genres text[])
returns setof text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member uuid := auth.uid();
  v_genres text[];
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if not exists (select 1 from public.library_entries where id = p_entry and member_id = v_member) then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;
  if p_genres is null or array_position(p_genres, null) is not null then
    raise exception 'genres_invalid' using errcode = '22023';
  end if;

  select coalesce(array_agg(id order by first_at), '{}') into v_genres
    from (select btrim(g) as id, min(n) as first_at
            from unnest(p_genres) with ordinality as t(g, n)
           group by btrim(g)) d;

  if cardinality(v_genres) > 3
     or exists (select 1 from unnest(v_genres) g where not exists (select 1 from public.genres where id = g)) then
    raise exception 'genres_invalid' using errcode = '22023';
  end if;

  insert into public.entry_genres (entry_id, member_id, genre_ids, updated_at)
  values (p_entry, v_member, v_genres, now())
  on conflict (entry_id) do update set genre_ids = excluded.genre_ids, updated_at = excluded.updated_at;

  return query select unnest(v_genres);
end;
$$;

-- Back to the computed genres for this entry. Returns them.
create function public.reset_entry_genres(p_entry uuid)
returns setof text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member uuid := auth.uid();
  v_book uuid;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  select book_id into v_book from public.library_entries where id = p_entry and member_id = v_member;
  if v_book is null then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;
  delete from public.entry_genres where entry_id = p_entry;
  return query select bg.genre_id from public.book_genres bg where bg.book_id = v_book order by bg.rank;
end;
$$;

revoke all on function public.set_entry_genres(uuid, text[]) from public, anon;
revoke all on function public.reset_entry_genres(uuid) from public, anon;
grant execute on function public.set_entry_genres(uuid, text[]) to authenticated;
grant execute on function public.reset_entry_genres(uuid) to authenticated;
