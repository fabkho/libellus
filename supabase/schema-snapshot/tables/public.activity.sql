create table public.activity (
  created_at timestamp with time zone default now() not null,
  entry_id uuid not null,
  id uuid default gen_random_uuid() not null,
  kind text not null,
  member_id uuid not null,
  on_day date,
  session_id uuid,
  visible_at timestamp with time zone not null
);

-- constraints
alter table public.activity add constraint activity_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES library_entries(id) ON DELETE CASCADE;
alter table public.activity add constraint activity_kind_check CHECK ((kind = ANY (ARRAY['want'::text, 'started'::text, 'finished'::text, 'abandoned'::text, 'reviewed'::text])));
alter table public.activity add constraint activity_member_id_fkey FOREIGN KEY (member_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.activity add constraint activity_pkey PRIMARY KEY (id);
alter table public.activity add constraint activity_session_id_fkey FOREIGN KEY (session_id) REFERENCES reading_sessions(id) ON DELETE CASCADE;

-- indexes
CREATE INDEX activity_entry ON public.activity USING btree (entry_id);
CREATE INDEX activity_feed ON public.activity USING btree (member_id, visible_at DESC, id DESC);
CREATE UNIQUE INDEX activity_once ON public.activity USING btree (session_id, kind);

-- row level security
alter table public.activity enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.activity to service_role;
grant insert on table public.activity to service_role;
grant maintain on table public.activity to service_role;
grant references on table public.activity to service_role;
grant select on table public.activity to service_role;
grant trigger on table public.activity to service_role;
grant truncate on table public.activity to service_role;
grant update on table public.activity to service_role;
