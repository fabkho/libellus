create table public.accounts (
  avatar_path text,
  avatar_updated_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  id uuid not null,
  invite_code_id uuid
);

-- constraints
alter table public.accounts add constraint accounts_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.accounts add constraint accounts_invite_code_id_fkey FOREIGN KEY (invite_code_id) REFERENCES invite_codes(id) ON DELETE SET NULL;
alter table public.accounts add constraint accounts_pkey PRIMARY KEY (id);

-- indexes
CREATE INDEX accounts_invite_code_id ON public.accounts USING btree (invite_code_id);

-- row level security
alter table public.accounts enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.accounts to service_role;
grant insert on table public.accounts to service_role;
grant maintain on table public.accounts to service_role;
grant references on table public.accounts to service_role;
grant select on table public.accounts to authenticated;
grant select on table public.accounts to service_role;
grant trigger on table public.accounts to service_role;
grant truncate on table public.accounts to service_role;
grant update on table public.accounts to service_role;
