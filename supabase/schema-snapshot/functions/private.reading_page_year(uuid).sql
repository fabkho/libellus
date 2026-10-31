CREATE OR REPLACE FUNCTION private.reading_page_year(p_member uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  with year as (select extract(year from now() at time zone 'utc')::int as y),
  reads as (
    select r.* from private.reading_page_reads(p_member) r, year
     where extract(year from r.ended_on)::int = year.y
  )
  select jsonb_build_object(
    'year', (select y from year),
    'books', (select count(*) from reads),
    'pages', (select coalesce(sum(pages), 0) from reads),
    'pages_missing', (select count(*) from reads where pages is null),
    'rated', (select count(*) from reads where rating is not null),
    'unrated', (select count(*) from reads where rating is null),
    'average', (select avg(rating)::float8 from reads),
    'median_days', (select round(percentile_cont(0.5) within group (order by ended_on - started_on + 1))::int
                      from reads where started_on is not null),
    'rereads', (select count(*) from reads where nth > 1),
    'months', (select jsonb_agg((select count(*) from reads where extract(month from ended_on)::int = m) order by m)
                 from generate_series(1, 12) m)
  )
$function$
;
