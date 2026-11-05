CREATE OR REPLACE FUNCTION private.buddy_sections_parse(p_sections jsonb, p_from text, p_page_count integer)
 RETURNS TABLE(s_position smallint, s_kind text, s_label text, s_start_page integer, s_end_page integer, s_to_fraction numeric)
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_n        integer;
  v_e        jsonb;
  v_kind     text;
  v_label    text;
  v_start    integer;
  v_end      integer;
  v_frac     numeric;
  v_prev     numeric := 0;
  v_prev_end integer;
begin
  if p_from is null or p_from not in ('count', 'pages', 'list')
     or (p_page_count is not null and p_page_count not between 1 and 99999)
     or (p_from = 'pages' and p_page_count is null)
     or p_sections is null or jsonb_typeof(p_sections) <> 'array' then
    raise exception 'buddy_sections_invalid' using errcode = '22023';
  end if;
  v_n := jsonb_array_length(p_sections);
  if v_n < 2 or v_n > 101 then
    raise exception 'buddy_sections_invalid' using errcode = '22023';
  end if;

  for v_i in 0 .. v_n - 1 loop
    v_e := p_sections -> v_i;
    if jsonb_typeof(v_e) <> 'object'
       or jsonb_typeof(v_e -> 'kind') is distinct from 'string'
       or jsonb_typeof(v_e -> 'label') is distinct from 'string'
       or jsonb_typeof(v_e -> 'to_fraction') is distinct from 'number'
       or coalesce(jsonb_typeof(v_e -> 'start_page'), 'null') not in ('null', 'number')
       or coalesce(jsonb_typeof(v_e -> 'end_page'), 'null') not in ('null', 'number') then
      raise exception 'buddy_sections_invalid' using errcode = '22023';
    end if;
    v_kind := v_e ->> 'kind';
    v_label := btrim(v_e ->> 'label');
    v_frac := (v_e ->> 'to_fraction')::numeric;
    begin
      v_start := (v_e ->> 'start_page')::integer;
      v_end := (v_e ->> 'end_page')::integer;
    exception when others then
      raise exception 'buddy_sections_invalid' using errcode = '22023';
    end;
    if (v_e ->> 'start_page') is not null and (v_e ->> 'start_page')::numeric <> v_start
       or (v_e ->> 'end_page') is not null and (v_e ->> 'end_page')::numeric <> v_end then
      raise exception 'buddy_sections_invalid' using errcode = '22023';
    end if;

    -- The label, the fraction (to four places, as stored) and the pages of any Section.
    if char_length(v_label) not between 1 and 120
       or v_label ~ '[[:cntrl:]]' or v_label !~ '[^[:space:][:cntrl:]\u00a0\u200b]'
       or v_frac <> round(v_frac, 4) or v_frac <= 0 or v_frac > 1
       or (v_start is null) <> (v_end is null)
       or (v_start is not null and (v_start < 1 or v_end < v_start or v_end > 99999
                                    or (p_page_count is not null and v_end > p_page_count))) then
      raise exception 'buddy_sections_invalid' using errcode = '22023';
    end if;

    if v_i < v_n - 1 then
      -- A part: pages follow on from the part before, and every part has them when cut by pages.
      if v_kind <> 'part' or v_frac <= v_prev
         or (p_from = 'pages' and v_start is null)
         or (v_start is not null and v_prev_end is not null and v_start <> v_prev_end + 1) then
        raise exception 'buddy_sections_invalid' using errcode = '22023';
      end if;
      v_prev := v_frac;
      v_prev_end := v_end;
    elsif v_kind <> 'end' or v_frac <> 1 then
      -- The last: the one end Section, the whole Book.
      raise exception 'buddy_sections_invalid' using errcode = '22023';
    end if;

    s_position := (v_i + 1)::smallint;
    s_kind := v_kind;
    s_label := v_label;
    s_start_page := v_start;
    s_end_page := v_end;
    s_to_fraction := v_frac;
    return next;
  end loop;
end;
$function$
;
