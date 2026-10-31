create table public.collections (
  created_at timestamp with time zone default now() not null,
  id uuid default gen_random_uuid() not null,
  member_id uuid not null,
  name text not null,
  "position" integer not null,
  updated_at timestamp with time zone default now() not null
);

-- constraints
alter table public.collections add constraint collections_member_id_fkey FOREIGN KEY (member_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.collections add constraint collections_name_present CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 80)));
alter table public.collections add constraint collections_name_trimmed CHECK ((name = btrim(name)));
alter table public.collections add constraint collections_pkey PRIMARY KEY (id);

-- indexes
CREATE INDEX collections_by_edited ON public.collections USING btree (member_id, updated_at DESC);
CREATE INDEX collections_by_position ON public.collections USING btree (member_id, "position");
CREATE UNIQUE INDEX collections_name_once ON public.collections USING btree (member_id, lower(name));

-- row level security
alter table public.collections enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.collections to service_role;
grant insert on table public.collections to service_role;
grant maintain on table public.collections to service_role;
grant references on table public.collections to service_role;
grant select on table public.collections to authenticated;
grant select on table public.collections to service_role;
grant trigger on table public.collections to service_role;
grant truncate on table public.collections to service_role;
grant update on table public.collections to service_role;
