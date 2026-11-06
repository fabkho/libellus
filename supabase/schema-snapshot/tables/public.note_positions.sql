create table public.note_positions (
  hand_chapter smallint,
  hand_finished boolean default false not null,
  member_id uuid not null,
  room_id uuid not null,
  updated_at timestamp with time zone default now() not null
);

-- constraints
alter table public.note_positions add constraint note_positions_check CHECK (((hand_chapter IS NOT NULL) OR hand_finished));
alter table public.note_positions add constraint note_positions_hand_chapter_check CHECK ((hand_chapter >= 1));
alter table public.note_positions add constraint note_positions_member_id_fkey FOREIGN KEY (member_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.note_positions add constraint note_positions_pkey PRIMARY KEY (room_id, member_id);
alter table public.note_positions add constraint note_positions_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE;

-- indexes
CREATE INDEX note_positions_member ON public.note_positions USING btree (member_id);

-- row level security
alter table public.note_positions enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.note_positions to service_role;
grant insert on table public.note_positions to service_role;
grant maintain on table public.note_positions to service_role;
grant references on table public.note_positions to service_role;
grant select on table public.note_positions to service_role;
grant trigger on table public.note_positions to service_role;
grant truncate on table public.note_positions to service_role;
grant update on table public.note_positions to service_role;
