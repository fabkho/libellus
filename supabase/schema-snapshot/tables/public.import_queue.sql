create table public.import_queue (
  beat_at timestamp with time zone default clock_timestamp() not null,
  device text,
  done integer default 0 not null,
  holder text not null,
  joined_at timestamp with time zone default clock_timestamp() not null,
  member_id uuid not null,
  rows integer default 0 not null,
  started_at timestamp with time zone
);

-- constraints
alter table public.import_queue add constraint import_queue_device_check CHECK (((device IS NULL) OR ((char_length(device) >= 1) AND (char_length(device) <= 64))));
alter table public.import_queue add constraint import_queue_done_check CHECK ((done >= 0));
alter table public.import_queue add constraint import_queue_holder_check CHECK (((char_length(holder) >= 1) AND (char_length(holder) <= 64)));
alter table public.import_queue add constraint import_queue_member_id_fkey FOREIGN KEY (member_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.import_queue add constraint import_queue_pkey PRIMARY KEY (member_id);
alter table public.import_queue add constraint import_queue_rows_check CHECK (((rows >= 0) AND (rows <= 100000)));

-- indexes
CREATE INDEX import_queue_line ON public.import_queue USING btree (joined_at, member_id) WHERE (started_at IS NULL);
CREATE UNIQUE INDEX import_queue_one_runner ON public.import_queue USING btree ((true)) WHERE (started_at IS NOT NULL);

-- row level security
alter table public.import_queue enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.import_queue to service_role;
grant insert on table public.import_queue to service_role;
grant maintain on table public.import_queue to service_role;
grant references on table public.import_queue to service_role;
grant select on table public.import_queue to service_role;
grant trigger on table public.import_queue to service_role;
grant truncate on table public.import_queue to service_role;
grant update on table public.import_queue to service_role;
