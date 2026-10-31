create table public.edge_rate_limits (
  member_id uuid not null,
  bucket text not null,
  window_start timestamp with time zone default now() not null,
  hits integer default 0 not null
);

-- constraints
alter table public.edge_rate_limits add constraint edge_rate_limits_bucket_format CHECK ((bucket ~ '^[a-z][a-z-]{0,39}$'::text));
alter table public.edge_rate_limits add constraint edge_rate_limits_member_id_fkey FOREIGN KEY (member_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.edge_rate_limits add constraint edge_rate_limits_pkey PRIMARY KEY (member_id, bucket);

-- row level security
alter table public.edge_rate_limits enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.edge_rate_limits to service_role;
grant insert on table public.edge_rate_limits to service_role;
grant maintain on table public.edge_rate_limits to service_role;
grant references on table public.edge_rate_limits to service_role;
grant select on table public.edge_rate_limits to service_role;
grant trigger on table public.edge_rate_limits to service_role;
grant truncate on table public.edge_rate_limits to service_role;
grant update on table public.edge_rate_limits to service_role;
