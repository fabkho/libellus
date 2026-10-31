create table public.entry_genres (
  entry_id uuid not null,
  member_id uuid not null,
  genre_ids text[] not null,
  updated_at timestamp with time zone default now() not null
);

-- constraints
alter table public.entry_genres add constraint entry_genres_at_most_three CHECK ((cardinality(genre_ids) <= 3));
alter table public.entry_genres add constraint entry_genres_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES library_entries(id) ON DELETE CASCADE;
alter table public.entry_genres add constraint entry_genres_member_id_fkey FOREIGN KEY (member_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.entry_genres add constraint entry_genres_no_nulls CHECK ((array_position(genre_ids, NULL::text) IS NULL));
alter table public.entry_genres add constraint entry_genres_pkey PRIMARY KEY (entry_id);

-- indexes
CREATE INDEX entry_genres_member ON public.entry_genres USING btree (member_id);

-- row level security
alter table public.entry_genres enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.entry_genres to service_role;
grant insert on table public.entry_genres to service_role;
grant maintain on table public.entry_genres to service_role;
grant references on table public.entry_genres to service_role;
grant select on table public.entry_genres to authenticated;
grant select on table public.entry_genres to service_role;
grant trigger on table public.entry_genres to service_role;
grant truncate on table public.entry_genres to service_role;
grant update on table public.entry_genres to service_role;
