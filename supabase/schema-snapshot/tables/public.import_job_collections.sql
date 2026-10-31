create table public.import_job_collections (
  began_at timestamp with time zone default now() not null,
  collection_order jsonb default '[]'::jsonb not null,
  empty_collections jsonb default '[]'::jsonb not null,
  empty_made boolean default false not null,
  job_id uuid not null
);

-- constraints
alter table public.import_job_collections add constraint import_job_collections_collection_order_check CHECK ((jsonb_typeof(collection_order) = 'array'::text));
alter table public.import_job_collections add constraint import_job_collections_empty_collections_check CHECK ((jsonb_typeof(empty_collections) = 'array'::text));
alter table public.import_job_collections add constraint import_job_collections_job_id_fkey FOREIGN KEY (job_id) REFERENCES import_jobs(id) ON DELETE CASCADE;
alter table public.import_job_collections add constraint import_job_collections_pkey PRIMARY KEY (job_id);

-- row level security
alter table public.import_job_collections enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.import_job_collections to service_role;
grant insert on table public.import_job_collections to service_role;
grant maintain on table public.import_job_collections to service_role;
grant references on table public.import_job_collections to service_role;
grant select on table public.import_job_collections to service_role;
grant trigger on table public.import_job_collections to service_role;
grant truncate on table public.import_job_collections to service_role;
grant update on table public.import_job_collections to service_role;
