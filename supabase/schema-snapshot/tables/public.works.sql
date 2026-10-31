create table public.works (
  cover_url text,
  created_at timestamp with time zone default now() not null,
  editions jsonb default '{}'::jsonb not null,
  fetched_at timestamp with time zone,
  first_year smallint,
  genre_ids text[] default '{}'::text[] not null,
  id uuid default gen_random_uuid() not null,
  kind text,
  openlibrary_key text,
  title text not null,
  titles jsonb default '{}'::jsonb not null,
  wikidata_id text
);

-- constraints
alter table public.works add constraint works_cover_url_https CHECK ((cover_url ~ '^https://'::text));
alter table public.works add constraint works_editions_object CHECK ((jsonb_typeof(editions) = 'object'::text));
alter table public.works add constraint works_identified CHECK (((wikidata_id IS NOT NULL) OR (openlibrary_key IS NOT NULL)));
alter table public.works add constraint works_kind CHECK ((kind = ANY (ARRAY['novel'::text, 'novella'::text, 'collection'::text, 'short-story'::text, 'nonfiction'::text, 'poetry'::text, 'graphic'::text, 'other'::text])));
alter table public.works add constraint works_openlibrary_format CHECK ((openlibrary_key ~ '^OL[1-9][0-9]{0,11}W$'::text));
alter table public.works add constraint works_openlibrary_key_key UNIQUE (openlibrary_key);
alter table public.works add constraint works_pkey PRIMARY KEY (id);
alter table public.works add constraint works_title_present CHECK (((char_length(btrim(title)) >= 1) AND (char_length(btrim(title)) <= 500)));
alter table public.works add constraint works_titles_object CHECK ((jsonb_typeof(titles) = 'object'::text));
alter table public.works add constraint works_wikidata_format CHECK ((wikidata_id ~ '^Q[1-9][0-9]{0,11}$'::text));
alter table public.works add constraint works_wikidata_id_key UNIQUE (wikidata_id);
alter table public.works add constraint works_year_plausible CHECK (((first_year >= '-3000'::integer) AND (first_year <= 2100)));

-- row level security
alter table public.works enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.works to service_role;
grant insert on table public.works to service_role;
grant maintain on table public.works to service_role;
grant references on table public.works to service_role;
grant select on table public.works to authenticated;
grant select on table public.works to service_role;
grant trigger on table public.works to service_role;
grant truncate on table public.works to service_role;
grant update on table public.works to service_role;
