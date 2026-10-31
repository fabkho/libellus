create table public.work_series (
  "position" numeric(6,2),
  series_id uuid not null,
  source text not null,
  work_id uuid not null
);

-- constraints
alter table public.work_series add constraint work_series_pkey PRIMARY KEY (work_id, series_id);
alter table public.work_series add constraint work_series_position_range CHECK ((("position" >= (0)::numeric) AND ("position" < (10000)::numeric)));
alter table public.work_series add constraint work_series_series_id_fkey FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE CASCADE;
alter table public.work_series add constraint work_series_source CHECK ((source = ANY (ARRAY['wikidata'::text, 'openlibrary'::text])));
alter table public.work_series add constraint work_series_work_id_fkey FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE CASCADE;

-- indexes
CREATE INDEX work_series_series ON public.work_series USING btree (series_id, "position");

-- row level security
alter table public.work_series enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.work_series to service_role;
grant insert on table public.work_series to service_role;
grant maintain on table public.work_series to service_role;
grant references on table public.work_series to service_role;
grant select on table public.work_series to authenticated;
grant select on table public.work_series to service_role;
grant trigger on table public.work_series to service_role;
grant truncate on table public.work_series to service_role;
grant update on table public.work_series to service_role;
