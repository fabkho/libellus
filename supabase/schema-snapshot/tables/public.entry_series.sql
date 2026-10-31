create table public.entry_series (
  entry_id uuid not null,
  member_id uuid not null,
  series_id uuid,
  "position" numeric(6,2),
  updated_at timestamp with time zone default now() not null
);

-- constraints
alter table public.entry_series add constraint entry_series_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES library_entries(id) ON DELETE CASCADE;
alter table public.entry_series add constraint entry_series_member_id_fkey FOREIGN KEY (member_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.entry_series add constraint entry_series_pkey PRIMARY KEY (entry_id);
alter table public.entry_series add constraint entry_series_position_needs_series CHECK (((series_id IS NOT NULL) OR ("position" IS NULL)));
alter table public.entry_series add constraint entry_series_position_range CHECK ((("position" >= (0)::numeric) AND ("position" < (10000)::numeric)));
alter table public.entry_series add constraint entry_series_series_id_fkey FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE CASCADE;

-- indexes
CREATE INDEX entry_series_member ON public.entry_series USING btree (member_id);
CREATE INDEX entry_series_series ON public.entry_series USING btree (series_id) WHERE (series_id IS NOT NULL);

-- row level security
alter table public.entry_series enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.entry_series to service_role;
grant insert on table public.entry_series to service_role;
grant maintain on table public.entry_series to service_role;
grant references on table public.entry_series to service_role;
grant select on table public.entry_series to authenticated;
grant select on table public.entry_series to service_role;
grant trigger on table public.entry_series to service_role;
grant truncate on table public.entry_series to service_role;
grant update on table public.entry_series to service_role;
