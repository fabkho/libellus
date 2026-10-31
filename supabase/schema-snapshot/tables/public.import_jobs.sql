create table public.import_jobs (
  added integer default 0 not null,
  already integer default 0 not null,
  chunks integer default 0 not null,
  claimed_at timestamp with time zone,
  cover_edition integer default 0 not null,
  cover_goodreads integer default 0 not null,
  cover_lent integer default 0 not null,
  cover_none integer default 0 not null,
  cover_openlibrary integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  device text,
  done integer default 0 not null,
  error text,
  failed integer default 0 not null,
  finished_at timestamp with time zone,
  id uuid default gen_random_uuid() not null,
  kept integer default 0 not null,
  languages text[] default '{}'::text[] not null,
  lease_until timestamp with time zone,
  member_id uuid not null,
  needs_look integer default 0 not null,
  not_before timestamp with time zone,
  notified_at timestamp with time zone,
  progress_at timestamp with time zone default now() not null,
  runner text,
  source text not null,
  stalls integer default 0 not null,
  started_at timestamp with time zone,
  state text default 'queued'::text not null,
  total integer not null
);

-- constraints
alter table public.import_jobs add constraint import_jobs_already_check CHECK (((already >= 0) AND (already <= 100000)));
alter table public.import_jobs add constraint import_jobs_device_check CHECK (((device IS NULL) OR ((char_length(device) >= 1) AND (char_length(device) <= 64))));
alter table public.import_jobs add constraint import_jobs_done_check CHECK ((done >= 0));
alter table public.import_jobs add constraint import_jobs_error_check CHECK (((error IS NULL) OR (char_length(error) <= 500)));
alter table public.import_jobs add constraint import_jobs_languages_check CHECK ((cardinality(languages) <= 5));
alter table public.import_jobs add constraint import_jobs_member_id_fkey FOREIGN KEY (member_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.import_jobs add constraint import_jobs_pkey PRIMARY KEY (id);
alter table public.import_jobs add constraint import_jobs_runner_check CHECK (((runner IS NULL) OR ((char_length(runner) >= 1) AND (char_length(runner) <= 64))));
alter table public.import_jobs add constraint import_jobs_source_check CHECK ((source ~ '^[a-z]{1,20}$'::text));
alter table public.import_jobs add constraint import_jobs_state_check CHECK ((state = ANY (ARRAY['queued'::text, 'running'::text, 'paused'::text, 'done'::text, 'failed'::text, 'cancelled'::text])));
alter table public.import_jobs add constraint import_jobs_total_check CHECK (((total >= 1) AND (total <= 10000)));

-- indexes
CREATE INDEX import_jobs_finished ON public.import_jobs USING btree (finished_at) WHERE (finished_at IS NOT NULL);
CREATE INDEX import_jobs_live ON public.import_jobs USING btree (created_at) WHERE (state = ANY (ARRAY['queued'::text, 'running'::text, 'paused'::text]));
CREATE INDEX import_jobs_member ON public.import_jobs USING btree (member_id, created_at DESC);
CREATE UNIQUE INDEX import_jobs_one_live ON public.import_jobs USING btree (member_id) WHERE (state = ANY (ARRAY['queued'::text, 'running'::text, 'paused'::text]));

-- row level security
alter table public.import_jobs enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.import_jobs to service_role;
grant insert on table public.import_jobs to service_role;
grant maintain on table public.import_jobs to service_role;
grant references on table public.import_jobs to service_role;
grant select on table public.import_jobs to authenticated;
grant select on table public.import_jobs to service_role;
grant trigger on table public.import_jobs to service_role;
grant truncate on table public.import_jobs to service_role;
grant update on table public.import_jobs to service_role;
