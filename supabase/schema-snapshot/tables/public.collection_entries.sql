create table public.collection_entries (
  collection_id uuid not null,
  entry_id uuid not null,
  "position" integer not null,
  added_at timestamp with time zone default now() not null
);

-- constraints
alter table public.collection_entries add constraint collection_entries_collection_id_fkey FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE;
alter table public.collection_entries add constraint collection_entries_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES library_entries(id) ON DELETE CASCADE;
alter table public.collection_entries add constraint collection_entries_pkey PRIMARY KEY (collection_id, entry_id);
alter table public.collection_entries add constraint collection_entries_position_once UNIQUE (collection_id, "position") DEFERRABLE INITIALLY DEFERRED;

-- indexes
CREATE INDEX collection_entries_entry ON public.collection_entries USING btree (entry_id);

-- row level security
alter table public.collection_entries enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.collection_entries to service_role;
grant insert on table public.collection_entries to service_role;
grant maintain on table public.collection_entries to service_role;
grant references on table public.collection_entries to service_role;
grant select on table public.collection_entries to authenticated;
grant select on table public.collection_entries to service_role;
grant trigger on table public.collection_entries to service_role;
grant truncate on table public.collection_entries to service_role;
grant update on table public.collection_entries to service_role;
