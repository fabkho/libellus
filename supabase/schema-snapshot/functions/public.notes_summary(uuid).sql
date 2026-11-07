CREATE OR REPLACE FUNCTION public.notes_summary(p_book uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
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
$function$
;
