create table public.edge_pace (
  bucket text not null,
  next_at timestamp with time zone not null
);

-- constraints
alter table public.edge_pace add constraint edge_pace_bucket_format CHECK ((bucket ~ '^[a-z][a-z-]{0,39}$'::text));
alter table public.edge_pace add constraint edge_pace_pkey PRIMARY KEY (bucket);

-- row level security
alter table public.edge_pace enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.edge_pace to service_role;
grant insert on table public.edge_pace to service_role;
grant maintain on table public.edge_pace to service_role;
grant references on table public.edge_pace to service_role;
grant select on table public.edge_pace to service_role;
grant trigger on table public.edge_pace to service_role;
grant truncate on table public.edge_pace to service_role;
grant update on table public.edge_pace to service_role;
