create table public.authors (
  birth_date date,
  birth_precision smallint,
  created_at timestamp with time zone default now() not null,
  death_date date,
  death_precision smallint,
  fetched_at timestamp with time zone,
  id uuid default gen_random_uuid() not null,
  name text not null,
  openlibrary_key text,
  photo_credit jsonb,
  photo_url text,
  summaries jsonb default '{}'::jsonb not null,
  wikidata_id text,
  works_fetched_at timestamp with time zone
);

-- constraints
alter table public.authors add constraint authors_birth_precision CHECK (((birth_precision >= 9) AND (birth_precision <= 11)));
alter table public.authors add constraint authors_death_precision CHECK (((death_precision >= 9) AND (death_precision <= 11)));
alter table public.authors add constraint authors_name_present CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 300)));
alter table public.authors add constraint authors_openlibrary_format CHECK ((openlibrary_key ~ '^OL[1-9][0-9]{0,11}A$'::text));
alter table public.authors add constraint authors_openlibrary_key_key UNIQUE (openlibrary_key);
alter table public.authors add constraint authors_photo_url_https CHECK ((photo_url ~ '^https://'::text));
alter table public.authors add constraint authors_pkey PRIMARY KEY (id);
alter table public.authors add constraint authors_summaries_object CHECK ((jsonb_typeof(summaries) = 'object'::text));
alter table public.authors add constraint authors_wikidata_format CHECK ((wikidata_id ~ '^Q[1-9][0-9]{0,11}$'::text));
alter table public.authors add constraint authors_wikidata_id_key UNIQUE (wikidata_id);

-- indexes
CREATE INDEX authors_name_key ON public.authors USING btree (author_name_key(name));
CREATE UNIQUE INDEX authors_name_only ON public.authors USING btree (lower(name)) WHERE ((wikidata_id IS NULL) AND (openlibrary_key IS NULL));

-- row level security
alter table public.authors enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.authors to service_role;
grant insert on table public.authors to service_role;
grant maintain on table public.authors to service_role;
grant references on table public.authors to service_role;
grant select on table public.authors to authenticated;
grant select on table public.authors to service_role;
grant trigger on table public.authors to service_role;
grant truncate on table public.authors to service_role;
grant update on table public.authors to service_role;
