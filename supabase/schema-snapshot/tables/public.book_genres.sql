create table public.book_genres (
  book_id uuid not null,
  computed_at timestamp with time zone default now() not null,
  confidence real not null,
  genre_id text not null,
  map_version integer not null,
  rank smallint not null,
  source text not null
);

-- constraints
alter table public.book_genres add constraint book_genres_book_id_fkey FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE;
alter table public.book_genres add constraint book_genres_confidence_range CHECK (((confidence > (0)::double precision) AND (confidence <= (1)::double precision)));
alter table public.book_genres add constraint book_genres_genre_id_fkey FOREIGN KEY (genre_id) REFERENCES genres(id) ON UPDATE CASCADE;
alter table public.book_genres add constraint book_genres_map_version_positive CHECK ((map_version > 0));
alter table public.book_genres add constraint book_genres_pkey PRIMARY KEY (book_id, genre_id);
alter table public.book_genres add constraint book_genres_rank_range CHECK (((rank >= 1) AND (rank <= 3)));
alter table public.book_genres add constraint book_genres_rank_unique UNIQUE (book_id, rank);
alter table public.book_genres add constraint book_genres_source CHECK ((source = ANY (ARRAY['wikidata'::text, 'apple'::text, 'openlibrary'::text])));

-- indexes
CREATE INDEX book_genres_genre ON public.book_genres USING btree (genre_id);

-- row level security
alter table public.book_genres enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.book_genres to service_role;
grant insert on table public.book_genres to service_role;
grant maintain on table public.book_genres to service_role;
grant references on table public.book_genres to service_role;
grant select on table public.book_genres to authenticated;
grant select on table public.book_genres to service_role;
grant trigger on table public.book_genres to service_role;
grant truncate on table public.book_genres to service_role;
grant update on table public.book_genres to service_role;
