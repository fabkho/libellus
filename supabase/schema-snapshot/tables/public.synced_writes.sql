create table public.synced_writes (
  action text not null,
  member_id uuid not null,
  request_id uuid not null,
  result jsonb default '{}'::jsonb not null,
  synced_at timestamp with time zone default now() not null
);

-- constraints
alter table public.synced_writes add constraint synced_writes_member_id_fkey FOREIGN KEY (member_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.synced_writes add constraint synced_writes_pkey PRIMARY KEY (request_id);

-- indexes
CREATE INDEX synced_writes_member_synced_at ON public.synced_writes USING btree (member_id, synced_at);

-- row level security
alter table public.synced_writes enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.synced_writes to service_role;
grant insert on table public.synced_writes to service_role;
grant maintain on table public.synced_writes to service_role;
grant references on table public.synced_writes to service_role;
grant select on table public.synced_writes to service_role;
grant trigger on table public.synced_writes to service_role;
grant truncate on table public.synced_writes to service_role;
grant update on table public.synced_writes to service_role;
