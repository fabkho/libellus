create table public.buddy_read_sections (
  buddy_read_id uuid not null,
  end_page integer,
  id uuid default gen_random_uuid() not null,
  kind text default 'part'::text not null,
  label text not null,
  "position" smallint not null,
  start_page integer,
  to_fraction numeric(5,4) not null
);

-- constraints
alter table public.buddy_read_sections add constraint buddy_read_sections_buddy_read_id_fkey FOREIGN KEY (buddy_read_id) REFERENCES buddy_reads(id) ON DELETE CASCADE;
alter table public.buddy_read_sections add constraint buddy_read_sections_buddy_read_id_position_key UNIQUE (buddy_read_id, "position") DEFERRABLE INITIALLY DEFERRED;
alter table public.buddy_read_sections add constraint buddy_read_sections_check CHECK ((((start_page IS NULL) = (end_page IS NULL)) AND ((start_page IS NULL) OR (end_page >= start_page))));
alter table public.buddy_read_sections add constraint buddy_read_sections_check1 CHECK (((kind = 'part'::text) OR (to_fraction = (1)::numeric)));
alter table public.buddy_read_sections add constraint buddy_read_sections_kind_check CHECK ((kind = ANY (ARRAY['part'::text, 'end'::text])));
alter table public.buddy_read_sections add constraint buddy_read_sections_label_check CHECK (((char_length(label) >= 1) AND (char_length(label) <= 120)));
alter table public.buddy_read_sections add constraint buddy_read_sections_pkey PRIMARY KEY (id);
alter table public.buddy_read_sections add constraint buddy_read_sections_position_check CHECK ((("position" >= 1) AND ("position" <= 101)));
alter table public.buddy_read_sections add constraint buddy_read_sections_to_fraction_check CHECK (((to_fraction > (0)::numeric) AND (to_fraction <= (1)::numeric)));

-- indexes
CREATE UNIQUE INDEX buddy_read_sections_one_end ON public.buddy_read_sections USING btree (buddy_read_id) WHERE (kind = 'end'::text);

-- row level security
alter table public.buddy_read_sections enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.buddy_read_sections to service_role;
grant insert on table public.buddy_read_sections to service_role;
grant maintain on table public.buddy_read_sections to service_role;
grant references on table public.buddy_read_sections to service_role;
grant select on table public.buddy_read_sections to service_role;
grant trigger on table public.buddy_read_sections to service_role;
grant truncate on table public.buddy_read_sections to service_role;
grant update on table public.buddy_read_sections to service_role;
