create table public.library_entries (
  id uuid default gen_random_uuid() not null,
  member_id uuid not null,
  book_id uuid not null,
  status entry_status default 'want_to_read'::entry_status not null,
  added_at timestamp with time zone default now() not null,
  import_key text,
  edition_changed_at timestamp with time zone,
  page_count_override integer,
  read_as text,
  format_override book_format,
  hidden boolean default false not null
);

-- constraints
alter table public.library_entries add constraint library_entries_book_id_fkey FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE RESTRICT;
alter table public.library_entries add constraint library_entries_import_key_once UNIQUE (member_id, import_key);
alter table public.library_entries add constraint library_entries_import_key_present CHECK ((import_key ~ '^[a-z]+:\S+$'::text));
alter table public.library_entries add constraint library_entries_member_id_fkey FOREIGN KEY (member_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.library_entries add constraint library_entries_once_per_book UNIQUE (member_id, book_id);
alter table public.library_entries add constraint library_entries_page_count_override_range CHECK (((page_count_override >= 1) AND (page_count_override <= 99999)));
alter table public.library_entries add constraint library_entries_pkey PRIMARY KEY (id);
alter table public.library_entries add constraint library_entries_read_as_known CHECK ((read_as = ANY (ARRAY['physical'::text, 'ebook'::text, 'audiobook'::text])));

-- indexes
CREATE INDEX library_entries_book ON public.library_entries USING btree (book_id);
CREATE INDEX library_entries_by_status ON public.library_entries USING btree (member_id, status, added_at DESC);

-- row level security
alter table public.library_entries enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.library_entries to service_role;
grant insert on table public.library_entries to service_role;
grant maintain on table public.library_entries to service_role;
grant references on table public.library_entries to service_role;
grant select on table public.library_entries to authenticated;
grant select on table public.library_entries to service_role;
grant trigger on table public.library_entries to service_role;
grant truncate on table public.library_entries to service_role;
grant update on table public.library_entries to service_role;
