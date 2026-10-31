CREATE OR REPLACE FUNCTION private.drop_split_volumes()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_links integer;
  v_works integer;
begin
  create temporary table split_links on commit drop as
    select ws.work_id, ws.series_id
      from public.work_series ws
      join public.works w on w.id = ws.work_id
     where ws.position is not null
       and ws.position <> trunc(ws.position)
       and exists (
         select 1
           from public.work_series p
           join public.works pw on pw.id = p.work_id
          where p.series_id = ws.series_id
            and p.work_id <> ws.work_id
            and p.position = trunc(ws.position)
            and exists (
              select 1
                from (select w.title as t union select value from jsonb_each_text(w.titles)) own
                cross join (select pw.title as t union select value from jsonb_each_text(pw.titles)) parent
               where parent.t <> ''
                 and starts_with(lower(btrim(own.t)), lower(btrim(parent.t)) || ', part ')
                 and substr(lower(btrim(own.t)), length(btrim(parent.t)) + 8) ~ '^[0-9]+$'
            )
       );

  delete from public.work_series ws
   using split_links l
   where ws.work_id = l.work_id and ws.series_id = l.series_id;
  get diagnostics v_links = row_count;

  delete from public.works w
   where w.id in (select work_id from split_links)
     and not exists (select 1 from public.book_works bw where bw.work_id = w.id)
     and not exists (select 1 from public.work_series ws where ws.work_id = w.id);
  get diagnostics v_works = row_count;

  drop table split_links;
  return jsonb_build_object('links', v_links, 'works', v_works);
end;
$function$
;
