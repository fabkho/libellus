-- Series pages bloated with split volumes.
--
-- Wikidata files the paperback halves of a long novel as items of the novel's series at a decimal
-- ordinal ("The Dragonbone Chair, part 1" = 1.1, "To Green Angel Tower, Part 4" = 3.4: Memory,
-- Sorrow, and Thorn lost three novels among eleven "books"). The enrich function no longer stores them
-- (supabase/functions/enrich/wikidata.ts, isSplitVolume); this removes the ones it stored.
--
-- A split volume is a work_series link at a decimal position x.y (not a whole number) of a series in
-- which another work sits at position x and the link's work is titled "<that work's title>, part N"
-- (any case of "part", N a number; the title in any language the parent has). Decimals alone are
-- novellas between two novels (Ender's Saga 1.5, The Murderbot Diaries 7.5, The Last King of Osten
-- Ard 0.5) and stay, and so does any title that merely looks like a part with no parent in its series.
--
-- The link goes. The work goes with it only when nothing needs it: no Book of the Catalogue belongs
-- to it (a member's Library entry reaches a work through its Book) and it sits in no other series. A
-- work somebody holds stays, without the series link (the author page lists it with her other novels).
-- Her own corrections (entry_series) and her Library are never touched.
--
-- private.drop_split_volumes() does it and says what it did; idempotent, so it may be run again.

create function private.drop_split_volumes()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
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
$$;

comment on function private.drop_split_volumes() is
  'Removes the work_series links of split volumes ("<novel>, part N" at a decimal position x.y of the series whose '
  'novel sits at x), and the works nothing else needs. Answers {"links": n, "works": n}. Idempotent.';

revoke all on function private.drop_split_volumes() from public, anon, authenticated;

select private.drop_split_volumes();
