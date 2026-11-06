create table public.room_sections (
  end_page integer,
  id uuid default gen_random_uuid() not null,
  kind text not null,
  label text,
  "position" smallint not null,
  room_id uuid not null,
  start_page integer,
  to_fraction numeric(5,4)
);

-- constraints
alter table public.room_sections add constraint room_sections_check CHECK ((((start_page IS NULL) = (end_page IS NULL)) AND ((start_page IS NULL) OR (end_page >= start_page))));
alter table public.room_sections add constraint room_sections_kind_check CHECK ((kind = ANY (ARRAY['part'::text, 'end'::text])));
alter table public.room_sections add constraint room_sections_label_check CHECK (((label IS NULL) OR ((char_length(label) >= 1) AND (char_length(label) <= 120))));
alter table public.room_sections add constraint room_sections_pkey PRIMARY KEY (id);
alter table public.room_sections add constraint room_sections_position_check CHECK ((("position" >= 1) AND ("position" <= 301)));
alter table public.room_sections add constraint room_sections_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE;
alter table public.room_sections add constraint room_sections_room_id_position_key UNIQUE (room_id, "position");
alter table public.room_sections add constraint room_sections_to_fraction_check CHECK (((to_fraction IS NULL) OR ((to_fraction > (0)::numeric) AND (to_fraction <= (1)::numeric))));

-- indexes
CREATE UNIQUE INDEX room_sections_one_end ON public.room_sections USING btree (room_id) WHERE (kind = 'end'::text);

-- row level security
alter table public.room_sections enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.room_sections to service_role;
grant insert on table public.room_sections to service_role;
grant maintain on table public.room_sections to service_role;
grant references on table public.room_sections to service_role;
grant select on table public.room_sections to service_role;
grant trigger on table public.room_sections to service_role;
grant truncate on table public.room_sections to service_role;
grant update on table public.room_sections to service_role;
