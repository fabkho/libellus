create table public.link_templates (
  member_id uuid not null,
  templates jsonb default '[]'::jsonb not null,
  updated_at timestamp with time zone default now() not null
);

-- constraints
alter table public.link_templates add constraint link_templates_member_id_fkey FOREIGN KEY (member_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.link_templates add constraint link_templates_pkey PRIMARY KEY (member_id);
alter table public.link_templates add constraint link_templates_valid CHECK (private.link_templates_valid(templates));

-- row level security
alter table public.link_templates enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.link_templates to service_role;
grant insert on table public.link_templates to service_role;
grant maintain on table public.link_templates to service_role;
grant references on table public.link_templates to service_role;
grant select on table public.link_templates to authenticated;
grant select on table public.link_templates to service_role;
grant trigger on table public.link_templates to service_role;
grant truncate on table public.link_templates to service_role;
grant update on table public.link_templates to service_role;
