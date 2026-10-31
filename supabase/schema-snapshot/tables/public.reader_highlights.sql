create table public.reader_highlights (
  id uuid not null,
  member_id uuid default auth.uid() not null,
  entry_id uuid not null,
  file_hash text not null,
  cfi text not null,
  section_index integer not null,
  color text not null,
  excerpt text default ''::text not null,
  note text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  deleted_at timestamp with time zone
);

-- constraints
alter table public.reader_highlights add constraint reader_highlights_cfi_present CHECK (((char_length(cfi) >= 1) AND (char_length(cfi) <= 2000)));
alter table public.reader_highlights add constraint reader_highlights_color CHECK ((color = ANY (ARRAY['lamp'::text, 'sage'::text, 'sky'::text, 'rose'::text])));
alter table public.reader_highlights add constraint reader_highlights_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES library_entries(id) ON DELETE CASCADE;
alter table public.reader_highlights add constraint reader_highlights_excerpt_cap CHECK ((char_length(excerpt) <= 1000));
alter table public.reader_highlights add constraint reader_highlights_file_hash_sha256 CHECK ((file_hash ~ '^[0-9a-f]{64}$'::text));
alter table public.reader_highlights add constraint reader_highlights_member_id_fkey FOREIGN KEY (member_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.reader_highlights add constraint reader_highlights_note_cap CHECK (((note IS NULL) OR (char_length(note) <= 2000)));
alter table public.reader_highlights add constraint reader_highlights_pkey PRIMARY KEY (id);
alter table public.reader_highlights add constraint reader_highlights_section_index CHECK ((section_index >= 0));
alter table public.reader_highlights add constraint reader_highlights_tombstone_empty CHECK (((deleted_at IS NULL) OR ((excerpt = ''::text) AND (note IS NULL))));

-- indexes
CREATE INDEX reader_highlights_entry ON public.reader_highlights USING btree (entry_id);
CREATE INDEX reader_highlights_member ON public.reader_highlights USING btree (member_id);

-- row level security
alter table public.reader_highlights enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.reader_highlights to service_role;
grant insert on table public.reader_highlights to authenticated;
grant insert on table public.reader_highlights to service_role;
grant maintain on table public.reader_highlights to service_role;
grant references on table public.reader_highlights to service_role;
grant select on table public.reader_highlights to authenticated;
grant select on table public.reader_highlights to service_role;
grant trigger on table public.reader_highlights to service_role;
grant truncate on table public.reader_highlights to service_role;
grant update on table public.reader_highlights to authenticated;
grant update on table public.reader_highlights to service_role;
