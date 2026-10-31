create table public.muted_series (
  member_id uuid not null,
  muted_at timestamp with time zone default now() not null,
  series_id uuid not null
);

-- constraints
alter table public.muted_series add constraint muted_series_member_id_fkey FOREIGN KEY (member_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.muted_series add constraint muted_series_pkey PRIMARY KEY (member_id, series_id);
alter table public.muted_series add constraint muted_series_series_id_fkey FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE CASCADE;

-- indexes
CREATE INDEX muted_series_series ON public.muted_series USING btree (series_id);

-- row level security
alter table public.muted_series enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.muted_series to service_role;
grant insert on table public.muted_series to service_role;
grant maintain on table public.muted_series to service_role;
grant references on table public.muted_series to service_role;
grant select on table public.muted_series to authenticated;
grant select on table public.muted_series to service_role;
grant trigger on table public.muted_series to service_role;
grant truncate on table public.muted_series to service_role;
grant update on table public.muted_series to service_role;
