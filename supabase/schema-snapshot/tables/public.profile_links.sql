create table public.profile_links (
  created_at timestamp with time zone default now() not null,
  handle text not null,
  member_id uuid not null,
  platform link_platform not null
);

-- constraints
alter table public.profile_links add constraint profile_links_handle_ok CHECK (private.profile_link_ok(platform, handle));
alter table public.profile_links add constraint profile_links_member_id_fkey FOREIGN KEY (member_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.profile_links add constraint profile_links_pkey PRIMARY KEY (member_id, platform);

-- row level security
alter table public.profile_links enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.profile_links to service_role;
grant insert on table public.profile_links to service_role;
grant maintain on table public.profile_links to service_role;
grant references on table public.profile_links to service_role;
grant select on table public.profile_links to authenticated;
grant select on table public.profile_links to service_role;
grant trigger on table public.profile_links to service_role;
grant truncate on table public.profile_links to service_role;
grant update on table public.profile_links to service_role;
