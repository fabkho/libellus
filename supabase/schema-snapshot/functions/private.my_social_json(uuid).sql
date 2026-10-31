CREATE OR REPLACE FUNCTION private.my_social_json(p_member uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  select jsonb_build_object(
    'private', s.private,
    'sections', jsonb_build_object(
      'reading', s.show_reading, 'want', s.show_want, 'finished', s.show_finished,
      'ratings', s.show_ratings, 'reviews', s.show_reviews, 'abandoned', s.show_abandoned,
      'year', s.show_year),
    'link', s.follow_token,
    'requests', (select count(*) from public.follows f
                  where f.followee_id = p_member and f.accepted_at is null and f.declined_at is null)
  )
  from (select (private.social_of(p_member)).*) s
$function$
;
