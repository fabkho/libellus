create table public.work_authors (
  work_id uuid not null,
  author_id uuid not null,
  "position" smallint default 1 not null
);

-- constraints
alter table public.work_authors add constraint work_authors_author_id_fkey FOREIGN KEY (author_id) REFERENCES authors(id) ON DELETE CASCADE;
alter table public.work_authors add constraint work_authors_pkey PRIMARY KEY (work_id, author_id);
alter table public.work_authors add constraint work_authors_work_id_fkey FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE CASCADE;

-- indexes
CREATE INDEX work_authors_author ON public.work_authors USING btree (author_id);

-- row level security
alter table public.work_authors enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.work_authors to service_role;
grant insert on table public.work_authors to service_role;
grant maintain on table public.work_authors to service_role;
grant references on table public.work_authors to service_role;
grant select on table public.work_authors to authenticated;
grant select on table public.work_authors to service_role;
grant trigger on table public.work_authors to service_role;
grant truncate on table public.work_authors to service_role;
grant update on table public.work_authors to service_role;
