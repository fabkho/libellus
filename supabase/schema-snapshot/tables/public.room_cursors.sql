create table public.room_cursors (
  last_read_at timestamp with time zone not null,
  member_id uuid not null,
  section_id uuid not null
);

-- constraints
alter table public.room_cursors add constraint room_cursors_member_id_fkey FOREIGN KEY (member_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.room_cursors add constraint room_cursors_pkey PRIMARY KEY (section_id, member_id);
alter table public.room_cursors add constraint room_cursors_section_id_fkey FOREIGN KEY (section_id) REFERENCES room_sections(id) ON DELETE CASCADE;

-- indexes
CREATE INDEX room_cursors_member ON public.room_cursors USING btree (member_id);

-- row level security
alter table public.room_cursors enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.room_cursors to service_role;
grant insert on table public.room_cursors to service_role;
grant maintain on table public.room_cursors to service_role;
grant references on table public.room_cursors to service_role;
grant select on table public.room_cursors to service_role;
grant trigger on table public.room_cursors to service_role;
grant truncate on table public.room_cursors to service_role;
grant update on table public.room_cursors to service_role;
