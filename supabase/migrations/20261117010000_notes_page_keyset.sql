-- Notes: no note lost at a page edge, and the right chapter range on the Book page (found by the import proof,
-- docs: ~/code/libellus-archive/niklas-poc/out/import-assessment.md, P2 and P5).
--
-- 1. public.note_messages paged on `created_at` alone (`created_at < p_before`), so notes that share an instant
--    and straddle the edge of a page were silently dropped from the next page (121 of 126 came back with ten tied
--    at the 50-note edge). The page boundary is now the keyset (created_at, id), the thread's own order both ways:
--    the new, last, defaulted parameter `p_before_id` is the id of the oldest note of the page before; with it the
--    next page is every note strictly before (created_at, id). Without it the function answers as it did
--    (`created_at < p_before`), so a client that has not been updated keeps working. A new parameter is a new
--    signature, so the old one is dropped in the same transaction and the one function keeps the name (a second
--    overload would make a call of four named arguments ambiguous). Same body otherwise: security definer,
--    search_path pinned, the same grants (authenticated only), visible_notes and can_see_note untouched, so the
--    visibility filter is applied before the page is cut and a hidden note never takes a place in it.
--
-- 2. public.notes_summary's `firstChapter` and `lastChapter` took min and max of the section position, which counts
--    *The whole book* (the `end` section, position n + 1) as a chapter: a 12-chapter book read "chapters 1-13".
--    They are now the range of the numbered chapters (`part`) only; a note on the whole book alone leaves both null
--    (the Book page then says no chapter). Same signature, `create or replace`, grants unchanged.

set local lock_timeout = '5s';

drop function public.note_messages(uuid, uuid, timestamptz, integer);

create function public.note_messages(p_room uuid, p_section uuid, p_before timestamptz default null,
                                     p_limit integer default 50, p_before_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if not exists (select 1 from public.room_sections s
                   join public.rooms r on r.id = s.room_id
                  where s.id = p_section and s.room_id = p_room and r.kind = 'notes') then
    raise exception 'not_found' using errcode = 'PT404';
  end if;

  return coalesce((
    select jsonb_agg(private.note_json(v_caller, m) order by m.created_at desc, m.id desc)
      from (select n.*
              from private.visible_notes(v_caller, p_room) n
             where n.section_id = p_section
               and (p_before is null
                    or n.created_at < p_before
                    or (p_before_id is not null and n.created_at = p_before and n.id < p_before_id))
             order by n.created_at desc, n.id desc
             limit least(greatest(coalesce(p_limit, 50), 1), 100)) m
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.note_messages(uuid, uuid, timestamptz, integer, uuid) from public, anon;
grant execute on function public.note_messages(uuid, uuid, timestamptz, integer, uuid) to authenticated;

create or replace function public.notes_summary(p_book uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
  v_owner  uuid;
  v_room   uuid;
  v_on     boolean := private.notes_public_enabled();
  v_out    jsonb;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  select b.owner_id into v_owner from public.books b where b.id = p_book;
  if found and v_owner is null then
    v_room := (private.notes_room_for(p_book)).id;
  end if;

  with v as materialized (
    select n.author_id, n.visibility, n.created_at, s.position, s.kind
      from private.visible_notes(v_caller, v_room) n
      join public.room_sections s on s.id = n.section_id
     where n.deleted_at is null and n.author_id <> v_caller
  ),
  friends as (
    select f.followee_id as id
      from public.follows f
      join public.follows b on b.follower_id = f.followee_id and b.followee_id = f.follower_id
     where f.follower_id = v_caller and f.accepted_at is not null and b.accepted_at is not null
  ),
  fr as (select v.* from v where v.author_id in (select id from friends)),
  pub as (select v.* from v where v_on and v.visibility = 'public' and v.author_id not in (select id from friends)),
  fr_authors as (
    select a.author_id, max(a.created_at) as last from fr a group by a.author_id
  )
  select jsonb_build_object(
    'friends', jsonb_build_object(
      'count', (select count(*)::integer from fr),
      'authors', coalesce((select jsonb_agg(private.member_card(v_caller, x.author_id) order by x.last desc, x.author_id)
                             from (select * from fr_authors order by last desc, author_id limit 3) x), '[]'::jsonb),
      'authorCount', (select count(*)::integer from fr_authors),
      -- The numbered chapters only: The whole book (kind 'end', position n + 1) is not chapter n + 1.
      'firstChapter', (select min(position) from fr where kind = 'part'),
      'lastChapter', (select max(position) from fr where kind = 'part')),
    'public', jsonb_build_object(
      'count', (select count(*)::integer from pub),
      'authorCount', (select count(distinct author_id)::integer from pub)))
    into v_out;
  return v_out;
end;
$$;
