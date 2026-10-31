create table public.social_settings (
  follow_token text not null,
  member_id uuid not null,
  private boolean default true not null,
  show_abandoned boolean default true not null,
  show_finished boolean default true not null,
  show_ratings boolean default true not null,
  show_reading boolean default true not null,
  show_reviews boolean default true not null,
  show_want boolean default true not null,
  show_year boolean default true not null,
  updated_at timestamp with time zone default now() not null
);

-- constraints
alter table public.social_settings add constraint social_settings_follow_token_check CHECK ((follow_token ~ '^[A-Za-z0-9_-]{22}$'::text));
alter table public.social_settings add constraint social_settings_follow_token_key UNIQUE (follow_token);
alter table public.social_settings add constraint social_settings_member_id_fkey FOREIGN KEY (member_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.social_settings add constraint social_settings_pkey PRIMARY KEY (member_id);

-- row level security
alter table public.social_settings enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.social_settings to service_role;
grant insert on table public.social_settings to service_role;
grant maintain on table public.social_settings to service_role;
grant references on table public.social_settings to service_role;
grant select on table public.social_settings to authenticated;
grant select on table public.social_settings to service_role;
grant trigger on table public.social_settings to service_role;
grant truncate on table public.social_settings to service_role;
grant update on table public.social_settings to service_role;
