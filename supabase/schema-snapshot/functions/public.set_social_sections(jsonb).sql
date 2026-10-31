CREATE OR REPLACE FUNCTION public.set_social_sections(p_sections jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_member uuid := auth.uid();
  v_key    text;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_sections is null or jsonb_typeof(p_sections) <> 'object' then
    raise exception 'social_sections_invalid' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_sections) loop
    if v_key not in ('reading', 'want', 'finished', 'ratings', 'reviews', 'abandoned', 'year')
       or jsonb_typeof(p_sections -> v_key) <> 'boolean' then
      raise exception 'social_sections_invalid' using errcode = '22023';
    end if;
  end loop;

  perform private.social_ensure(v_member);
  update public.social_settings
     set show_reading   = coalesce((p_sections ->> 'reading')::boolean, show_reading),
         show_want      = coalesce((p_sections ->> 'want')::boolean, show_want),
         show_finished  = coalesce((p_sections ->> 'finished')::boolean, show_finished),
         show_ratings   = coalesce((p_sections ->> 'ratings')::boolean, show_ratings),
         show_reviews   = coalesce((p_sections ->> 'reviews')::boolean, show_reviews),
         show_abandoned = coalesce((p_sections ->> 'abandoned')::boolean, show_abandoned),
         show_year      = coalesce((p_sections ->> 'year')::boolean, show_year),
         updated_at     = now()
   where member_id = v_member;
  return private.my_social_json(v_member);
end;
$function$
;
