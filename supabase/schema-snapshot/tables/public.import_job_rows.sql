create table public.import_job_rows (
  attempts smallint default 0 not null,
  cover text,
  cover_attempts smallint default 0 not null,
  cover_not_before timestamp with time zone,
  cover_size text,
  cover_source text,
  cover_state text default 'pending'::text not null,
  cover_taken_by text,
  cover_tries smallint default 0 not null,
  cover_url text,
  done_at timestamp with time zone,
  edition jsonb,
  entry_id uuid,
  error text,
  idx integer not null,
  job_id uuid not null,
  key text not null,
  match_book jsonb,
  outcome text,
  pass smallint default 0 not null,
  payload jsonb not null,
  state text default 'pending'::text not null,
  taken_by text,
  tier text,
  verdict text,
  write_attempts smallint default 0 not null,
  write_state text default 'pending'::text not null,
  write_taken_by text
);

-- constraints
alter table public.import_job_rows add constraint import_job_rows_cover_check CHECK ((cover = ANY (ARRAY['own'::text, 'lent'::text, 'goodreads'::text, 'none'::text])));
alter table public.import_job_rows add constraint import_job_rows_cover_decided CHECK (((cover_state <> 'done'::text) OR (cover_source IS NOT NULL)));
alter table public.import_job_rows add constraint import_job_rows_cover_size_check CHECK ((cover_size = ANY (ARRAY['S'::text, 'M'::text, 'L'::text])));
alter table public.import_job_rows add constraint import_job_rows_cover_source_check CHECK ((cover_source = ANY (ARRAY['edition'::text, 'lent'::text, 'openlibrary'::text, 'goodreads'::text, 'none'::text])));
alter table public.import_job_rows add constraint import_job_rows_cover_state_check CHECK ((cover_state = ANY (ARRAY['pending'::text, 'goodreads'::text, 'done'::text])));
alter table public.import_job_rows add constraint import_job_rows_cover_url_check CHECK (((cover_url IS NULL) OR (cover_url ~ '^https://[^[:space:]]+$'::text)));
alter table public.import_job_rows add constraint import_job_rows_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES library_entries(id) ON DELETE SET NULL;
alter table public.import_job_rows add constraint import_job_rows_error_check CHECK (((error IS NULL) OR (char_length(error) <= 200)));
alter table public.import_job_rows add constraint import_job_rows_idx_check CHECK (((idx >= 0) AND (idx <= 9999)));
alter table public.import_job_rows add constraint import_job_rows_job_id_fkey FOREIGN KEY (job_id) REFERENCES import_jobs(id) ON DELETE CASCADE;
alter table public.import_job_rows add constraint import_job_rows_key_check CHECK (((char_length(key) >= 1) AND (char_length(key) <= 300)));
alter table public.import_job_rows add constraint import_job_rows_match_book_check CHECK (((match_book IS NULL) OR (jsonb_typeof(match_book) = 'object'::text)));
alter table public.import_job_rows add constraint import_job_rows_outcome_check CHECK ((outcome = ANY (ARRAY['added'::text, 'imported'::text, 'in_library'::text, 'failed'::text])));
alter table public.import_job_rows add constraint import_job_rows_pass_check CHECK (((pass >= 0) AND (pass <= 1)));
alter table public.import_job_rows add constraint import_job_rows_payload_check CHECK ((jsonb_typeof(payload) = 'object'::text));
alter table public.import_job_rows add constraint import_job_rows_pkey PRIMARY KEY (job_id, idx);
alter table public.import_job_rows add constraint import_job_rows_state_check CHECK ((state = ANY (ARRAY['pending'::text, 'done'::text])));
alter table public.import_job_rows add constraint import_job_rows_tier_check CHECK ((tier = ANY (ARRAY['quiet'::text, 'probablyFine'::text, 'needsLook'::text])));
alter table public.import_job_rows add constraint import_job_rows_verdict_check CHECK ((verdict = ANY (ARRAY['matched'::text, 'fromFile'::text, 'inLibrary'::text, 'imported'::text])));
alter table public.import_job_rows add constraint import_job_rows_write_state_check CHECK ((write_state = ANY (ARRAY['pending'::text, 'done'::text])));

-- indexes
CREATE INDEX import_job_rows_cover ON public.import_job_rows USING btree (job_id, cover_state, idx) WHERE (cover_state <> 'done'::text);
CREATE INDEX import_job_rows_entry ON public.import_job_rows USING btree (entry_id) WHERE (entry_id IS NOT NULL);
CREATE INDEX import_job_rows_pending ON public.import_job_rows USING btree (job_id, pass, idx) WHERE (state = 'pending'::text);
CREATE INDEX import_job_rows_write ON public.import_job_rows USING btree (job_id, idx) WHERE (write_state = 'pending'::text);

-- row level security
alter table public.import_job_rows enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.import_job_rows to service_role;
grant insert on table public.import_job_rows to service_role;
grant maintain on table public.import_job_rows to service_role;
grant references on table public.import_job_rows to service_role;
grant select on table public.import_job_rows to authenticated;
grant select on table public.import_job_rows to service_role;
grant trigger on table public.import_job_rows to service_role;
grant truncate on table public.import_job_rows to service_role;
grant update on table public.import_job_rows to service_role;
