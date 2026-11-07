create table public.rooms (
  book_id uuid not null,
  chapters_set_by uuid,
  created_at timestamp with time zone default clock_timestamp() not null,
  id uuid default gen_random_uuid() not null,
  kind text not null,
  work_key text not null
);

-- constraints
alter table public.rooms add constraint rooms_book_id_fkey FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE RESTRICT;
alter table public.rooms add constraint rooms_chapters_set_by_fkey FOREIGN KEY (chapters_set_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.rooms add constraint rooms_kind_check CHECK ((kind = ANY (ARRAY['notes'::text, 'buddy'::text])));
alter table public.rooms add constraint rooms_pkey PRIMARY KEY (id);
alter table public.rooms add constraint rooms_work_key_check CHECK ((work_key ~ '^[wb]:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text));

-- indexes
CREATE INDEX rooms_book ON public.rooms USING btree (book_id);
CREATE INDEX rooms_chapters_set_by ON public.rooms USING btree (chapters_set_by) WHERE (chapters_set_by IS NOT NULL);
CREATE UNIQUE INDEX rooms_notes_work ON public.rooms USING btree (work_key) WHERE (kind = 'notes'::text);

-- row level security
alter table public.rooms enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.rooms to service_role;
grant insert on table public.rooms to service_role;
grant maintain on table public.rooms to service_role;
grant references on table public.rooms to service_role;
grant select on table public.rooms to service_role;
grant trigger on table public.rooms to service_role;
grant truncate on table public.rooms to service_role;
grant update on table public.rooms to service_role;
