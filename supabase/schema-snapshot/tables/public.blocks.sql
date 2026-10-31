create table public.blocks (
  blocker_id uuid not null,
  blocked_id uuid not null,
  created_at timestamp with time zone default now() not null
);

-- constraints
alter table public.blocks add constraint blocks_blocked_id_fkey FOREIGN KEY (blocked_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.blocks add constraint blocks_blocker_id_fkey FOREIGN KEY (blocker_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.blocks add constraint blocks_check CHECK ((blocker_id <> blocked_id));
alter table public.blocks add constraint blocks_pkey PRIMARY KEY (blocker_id, blocked_id);

-- indexes
CREATE INDEX blocks_blocked_id ON public.blocks USING btree (blocked_id);

-- row level security
alter table public.blocks enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.blocks to service_role;
grant insert on table public.blocks to service_role;
grant maintain on table public.blocks to service_role;
grant references on table public.blocks to service_role;
grant select on table public.blocks to service_role;
grant trigger on table public.blocks to service_role;
grant truncate on table public.blocks to service_role;
grant update on table public.blocks to service_role;
