create table public.series (
  created_at timestamp with time zone default now() not null,
  created_by uuid,
  fetched_at timestamp with time zone,
  id uuid default gen_random_uuid() not null,
  name text not null,
  openlibrary_key text,
  parent_id uuid,
  source text not null,
  wikidata_id text
);

-- constraints
alter table public.series add constraint series_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.series add constraint series_member_iff_created_by CHECK (((source = 'member'::text) = (created_by IS NOT NULL)));
alter table public.series add constraint series_name_present CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 300)));
alter table public.series add constraint series_not_own_parent CHECK ((parent_id <> id));
alter table public.series add constraint series_openlibrary_format CHECK ((openlibrary_key ~ '^OL[1-9][0-9]{0,11}L$'::text));
alter table public.series add constraint series_openlibrary_key_key UNIQUE (openlibrary_key);
alter table public.series add constraint series_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES series(id) ON DELETE SET NULL;
alter table public.series add constraint series_pkey PRIMARY KEY (id);
alter table public.series add constraint series_source CHECK ((source = ANY (ARRAY['wikidata'::text, 'openlibrary'::text, 'member'::text])));
alter table public.series add constraint series_wikidata_format CHECK ((wikidata_id ~ '^Q[1-9][0-9]{0,11}$'::text));
alter table public.series add constraint series_wikidata_id_key UNIQUE (wikidata_id);

-- indexes
CREATE INDEX series_created_by ON public.series USING btree (created_by) WHERE (created_by IS NOT NULL);
CREATE UNIQUE INDEX series_member_name ON public.series USING btree (created_by, lower(name)) WHERE (created_by IS NOT NULL);
CREATE UNIQUE INDEX series_name_only ON public.series USING btree (lower(name)) WHERE ((wikidata_id IS NULL) AND (openlibrary_key IS NULL) AND (created_by IS NULL));
CREATE INDEX series_parent ON public.series USING btree (parent_id) WHERE (parent_id IS NOT NULL);

-- row level security
alter table public.series enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.series to service_role;
grant insert on table public.series to service_role;
grant maintain on table public.series to service_role;
grant references on table public.series to service_role;
grant select on table public.series to authenticated;
grant select on table public.series to service_role;
grant trigger on table public.series to service_role;
grant truncate on table public.series to service_role;
grant update on table public.series to service_role;
