create table public.profile_link_settings (
  member_id uuid not null,
  updated_at timestamp with time zone default now() not null,
  visibility text default 'followers'::text not null
);

-- constraints
alter table public.profile_link_settings add constraint profile_link_settings_member_id_fkey FOREIGN KEY (member_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.profile_link_settings add constraint profile_link_settings_pkey PRIMARY KEY (member_id);
alter table public.profile_link_settings add constraint profile_link_settings_visibility_check CHECK ((visibility = ANY (ARRAY['everyone'::text, 'followers'::text, 'me'::text])));

-- row level security
alter table public.profile_link_settings enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.profile_link_settings to service_role;
grant insert on table public.profile_link_settings to service_role;
grant maintain on table public.profile_link_settings to service_role;
grant references on table public.profile_link_settings to service_role;
grant select on table public.profile_link_settings to authenticated;
grant select on table public.profile_link_settings to service_role;
grant trigger on table public.profile_link_settings to service_role;
grant truncate on table public.profile_link_settings to service_role;
grant update on table public.profile_link_settings to service_role;
