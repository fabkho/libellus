create table public.likes (
  member_id uuid not null,
  session_id uuid not null,
  created_at timestamp with time zone default now() not null
);

-- constraints
alter table public.likes add constraint likes_member_id_fkey FOREIGN KEY (member_id) REFERENCES accounts(id) ON DELETE CASCADE;
alter table public.likes add constraint likes_pkey PRIMARY KEY (member_id, session_id);
alter table public.likes add constraint likes_session_id_fkey FOREIGN KEY (session_id) REFERENCES reading_sessions(id) ON DELETE CASCADE;

-- indexes
CREATE INDEX likes_session ON public.likes USING btree (session_id, created_at DESC);

-- row level security
alter table public.likes enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.likes to service_role;
grant insert on table public.likes to service_role;
grant maintain on table public.likes to service_role;
grant references on table public.likes to service_role;
grant select on table public.likes to service_role;
grant trigger on table public.likes to service_role;
grant truncate on table public.likes to service_role;
grant update on table public.likes to service_role;
