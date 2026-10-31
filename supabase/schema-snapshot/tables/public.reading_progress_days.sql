create table public.reading_progress_days (
  day date not null,
  end_page integer,
  end_percent smallint,
  session_id uuid not null,
  start_page integer,
  start_percent smallint,
  updated_at timestamp with time zone default now() not null
);

-- constraints
alter table public.reading_progress_days add constraint reading_progress_days_end_one_kind CHECK ((num_nonnulls(end_page, end_percent) = 1));
alter table public.reading_progress_days add constraint reading_progress_days_pages_not_negative CHECK (((start_page >= 0) AND (end_page >= 0)));
alter table public.reading_progress_days add constraint reading_progress_days_percent_range CHECK ((((start_percent >= 0) AND (start_percent <= 100)) AND ((end_percent >= 0) AND (end_percent <= 100))));
alter table public.reading_progress_days add constraint reading_progress_days_pkey PRIMARY KEY (session_id, day);
alter table public.reading_progress_days add constraint reading_progress_days_session_id_fkey FOREIGN KEY (session_id) REFERENCES reading_sessions(id) ON DELETE CASCADE;
alter table public.reading_progress_days add constraint reading_progress_days_start_one_kind CHECK ((num_nonnulls(start_page, start_percent) <= 1));

-- row level security
alter table public.reading_progress_days enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.reading_progress_days to service_role;
grant insert on table public.reading_progress_days to service_role;
grant maintain on table public.reading_progress_days to service_role;
grant references on table public.reading_progress_days to service_role;
grant select on table public.reading_progress_days to authenticated;
grant select on table public.reading_progress_days to service_role;
grant trigger on table public.reading_progress_days to service_role;
grant truncate on table public.reading_progress_days to service_role;
grant update on table public.reading_progress_days to service_role;
