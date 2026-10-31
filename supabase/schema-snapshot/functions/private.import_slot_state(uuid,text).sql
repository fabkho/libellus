CREATE OR REPLACE FUNCTION private.import_slot_state(p_member uuid, p_holder text)
 RETURNS TABLE(state text, mine boolean, ahead integer, rows_ahead integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  with me as (select * from public.import_queue where member_id = p_member),
  line as (
    select q.member_id,
           row_number() over (order by (q.started_at is null), q.joined_at, q.member_id) - 1 as ahead,
           q.rows - least(q.done, q.rows) as left_to_do
      from public.import_queue q
  )
  select case when me.member_id is null then 'none' when me.started_at is not null then 'running' else 'waiting' end,
         coalesce(me.holder = p_holder, false),
         coalesce((select l.ahead from line l where l.member_id = p_member), 0)::integer,
         coalesce((select sum(l.left_to_do) from line l where l.ahead < (select l2.ahead from line l2 where l2.member_id = p_member)), 0)::integer
    from (select 1) one left join me on true
$function$
;
