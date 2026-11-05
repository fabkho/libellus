create table public.buddy_section_cursors (
  last_read_at timestamp with time zone not null,
  member_id uuid not null,
  section_id uuid not null
);

-- constraints
alter table public.buddy_section_cursors add constraint buddy_section_cursors_member_id_fkey FOREIGN KEY (member_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.buddy_section_cursors add constraint buddy_section_cursors_pkey PRIMARY KEY (section_id, member_id);
alter table public.buddy_section_cursors add constraint buddy_section_cursors_section_id_fkey FOREIGN KEY (section_id) REFERENCES buddy_read_sections(id) ON DELETE CASCADE;

-- indexes
CREATE INDEX buddy_section_cursors_member ON public.buddy_section_cursors USING btree (member_id);

-- row level security
alter table public.buddy_section_cursors enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.buddy_section_cursors to service_role;
grant insert on table public.buddy_section_cursors to service_role;
grant maintain on table public.buddy_section_cursors to service_role;
grant references on table public.buddy_section_cursors to service_role;
grant select on table public.buddy_section_cursors to service_role;
grant trigger on table public.buddy_section_cursors to service_role;
grant truncate on table public.buddy_section_cursors to service_role;
grant update on table public.buddy_section_cursors to service_role;
