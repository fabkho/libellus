create table public.follow_link_views (
  visitor_id uuid not null,
  member_id uuid not null,
  viewed_at timestamp with time zone default now() not null
);

-- constraints
alter table public.follow_link_views add constraint follow_link_views_member_id_fkey FOREIGN KEY (member_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.follow_link_views add constraint follow_link_views_pkey PRIMARY KEY (visitor_id, member_id);
alter table public.follow_link_views add constraint follow_link_views_visitor_id_fkey FOREIGN KEY (visitor_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- indexes
CREATE INDEX follow_link_views_member_id ON public.follow_link_views USING btree (member_id);

-- row level security
alter table public.follow_link_views enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.follow_link_views to service_role;
grant insert on table public.follow_link_views to service_role;
grant maintain on table public.follow_link_views to service_role;
grant references on table public.follow_link_views to service_role;
grant select on table public.follow_link_views to service_role;
grant trigger on table public.follow_link_views to service_role;
grant truncate on table public.follow_link_views to service_role;
grant update on table public.follow_link_views to service_role;
