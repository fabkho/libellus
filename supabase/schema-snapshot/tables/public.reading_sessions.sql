create table public.reading_sessions (
  abandon_reason text,
  created_at timestamp with time zone default now() not null,
  ended_on date,
  entry_id uuid not null,
  id uuid default gen_random_uuid() not null,
  import_key text,
  outcome session_outcome,
  progress_page integer,
  progress_percent smallint,
  progress_updated_at timestamp with time zone,
  rating smallint,
  review text,
  review_spoilers boolean default false not null,
  started_on date
);

-- constraints
alter table public.reading_sessions add constraint reading_sessions_end_after_start CHECK ((ended_on >= started_on));
alter table public.reading_sessions add constraint reading_sessions_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES library_entries(id) ON DELETE CASCADE;
alter table public.reading_sessions add constraint reading_sessions_import_key_once UNIQUE (entry_id, import_key);
alter table public.reading_sessions add constraint reading_sessions_import_key_present CHECK ((import_key ~ '^[a-z]+:\S+$'::text));
alter table public.reading_sessions add constraint reading_sessions_open_has_no_end CHECK (((outcome IS NOT NULL) OR (ended_on IS NULL)));
alter table public.reading_sessions add constraint reading_sessions_open_has_start CHECK (((outcome IS NOT NULL) OR (started_on IS NOT NULL)));
alter table public.reading_sessions add constraint reading_sessions_pkey PRIMARY KEY (id);
alter table public.reading_sessions add constraint reading_sessions_progress_one_kind CHECK ((num_nonnulls(progress_page, progress_percent) <= 1));
alter table public.reading_sessions add constraint reading_sessions_progress_page_not_negative CHECK ((progress_page >= 0));
alter table public.reading_sessions add constraint reading_sessions_progress_percent_range CHECK (((progress_percent >= 0) AND (progress_percent <= 100)));
alter table public.reading_sessions add constraint reading_sessions_progress_stamped CHECK (((progress_updated_at IS NOT NULL) = (num_nonnulls(progress_page, progress_percent) = 1)));
alter table public.reading_sessions add constraint reading_sessions_rating_quarters CHECK (((rating >= 1) AND (rating <= 20)));
alter table public.reading_sessions add constraint reading_sessions_rating_when_finished CHECK (((rating IS NULL) OR (NOT (outcome IS DISTINCT FROM 'finished'::session_outcome))));
alter table public.reading_sessions add constraint reading_sessions_reason_present CHECK (((abandon_reason ~ '\S'::text) AND (char_length(abandon_reason) <= 1000)));
alter table public.reading_sessions add constraint reading_sessions_reason_when_abandoned CHECK (((abandon_reason IS NULL) OR (NOT (outcome IS DISTINCT FROM 'abandoned'::session_outcome))));
alter table public.reading_sessions add constraint reading_sessions_review_present CHECK (((review ~ '\S'::text) AND (char_length(review) <= 10000)));
alter table public.reading_sessions add constraint reading_sessions_review_when_closed CHECK (((review IS NULL) OR (outcome IS NOT NULL)));

-- indexes
CREATE INDEX reading_sessions_entry ON public.reading_sessions USING btree (entry_id, ended_on DESC);
CREATE UNIQUE INDEX reading_sessions_one_open ON public.reading_sessions USING btree (entry_id) WHERE (outcome IS NULL);

-- row level security
alter table public.reading_sessions enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.reading_sessions to service_role;
grant insert on table public.reading_sessions to service_role;
grant maintain on table public.reading_sessions to service_role;
grant references on table public.reading_sessions to service_role;
grant select on table public.reading_sessions to authenticated;
grant select on table public.reading_sessions to service_role;
grant trigger on table public.reading_sessions to service_role;
grant truncate on table public.reading_sessions to service_role;
grant update on table public.reading_sessions to service_role;
