create table public.reader_places (
  member_id uuid default auth.uid() not null,
  entry_id uuid not null,
  cfi text not null,
  fraction real not null,
  file_hash text not null,
  updated_at timestamp with time zone default now() not null
);

-- constraints
alter table public.reader_places add constraint reader_places_cfi_present CHECK (((char_length(cfi) >= 1) AND (char_length(cfi) <= 2000)));
alter table public.reader_places add constraint reader_places_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES library_entries(id) ON DELETE CASCADE;
alter table public.reader_places add constraint reader_places_file_hash_sha256 CHECK ((file_hash ~ '^[0-9a-f]{64}$'::text));
alter table public.reader_places add constraint reader_places_fraction_range CHECK (((fraction >= (0)::double precision) AND (fraction <= (1)::double precision)));
alter table public.reader_places add constraint reader_places_member_id_fkey FOREIGN KEY (member_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.reader_places add constraint reader_places_pkey PRIMARY KEY (entry_id);

-- indexes
CREATE INDEX reader_places_member ON public.reader_places USING btree (member_id);

-- row level security
alter table public.reader_places enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.reader_places to service_role;
grant insert on table public.reader_places to authenticated;
grant insert on table public.reader_places to service_role;
grant maintain on table public.reader_places to service_role;
grant references on table public.reader_places to service_role;
grant select on table public.reader_places to authenticated;
grant select on table public.reader_places to service_role;
grant trigger on table public.reader_places to service_role;
grant truncate on table public.reader_places to service_role;
grant update on table public.reader_places to authenticated;
grant update on table public.reader_places to service_role;
