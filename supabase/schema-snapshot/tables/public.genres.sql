create table public.genres (
  id text not null,
  "position" smallint not null,
  label text not null,
  fiction boolean not null
);

-- constraints
alter table public.genres add constraint genres_id_format CHECK ((id ~ '^[a-z][a-z-]{1,30}$'::text));
alter table public.genres add constraint genres_pkey PRIMARY KEY (id);
alter table public.genres add constraint genres_position_key UNIQUE ("position");

-- row level security
alter table public.genres enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.genres to service_role;
grant insert on table public.genres to service_role;
grant maintain on table public.genres to service_role;
grant references on table public.genres to service_role;
grant select on table public.genres to authenticated;
grant select on table public.genres to service_role;
grant trigger on table public.genres to service_role;
grant truncate on table public.genres to service_role;
grant update on table public.genres to service_role;
