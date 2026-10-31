create table public.feedback (
  id uuid default gen_random_uuid() not null,
  member_id uuid default auth.uid() not null,
  kind text not null,
  body text not null,
  context jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  handled_at timestamp with time zone,
  owner_note text
);

-- constraints
alter table public.feedback add constraint feedback_body_length CHECK (((char_length(body) >= 10) AND (char_length(body) <= 2000)));
alter table public.feedback add constraint feedback_body_trimmed CHECK ((char_length(btrim(body)) >= 10));
alter table public.feedback add constraint feedback_context_object CHECK ((jsonb_typeof(context) = 'object'::text));
alter table public.feedback add constraint feedback_context_size CHECK ((octet_length((context)::text) <= 4000));
alter table public.feedback add constraint feedback_kind CHECK ((kind = ANY (ARRAY['bug'::text, 'feature'::text, 'other'::text])));
alter table public.feedback add constraint feedback_member_id_fkey FOREIGN KEY (member_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.feedback add constraint feedback_owner_note_length CHECK (((owner_note IS NULL) OR (char_length(owner_note) <= 2000)));
alter table public.feedback add constraint feedback_pkey PRIMARY KEY (id);

-- indexes
CREATE INDEX feedback_created ON public.feedback USING btree (created_at DESC);
CREATE INDEX feedback_member_created ON public.feedback USING btree (member_id, created_at DESC);

-- row level security
alter table public.feedback enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.feedback to service_role;
grant insert (body) on table public.feedback to authenticated;
grant insert (context) on table public.feedback to authenticated;
grant insert (kind) on table public.feedback to authenticated;
grant insert (member_id) on table public.feedback to authenticated;
grant insert on table public.feedback to service_role;
grant maintain on table public.feedback to service_role;
grant references on table public.feedback to service_role;
grant select on table public.feedback to service_role;
grant trigger on table public.feedback to service_role;
grant truncate on table public.feedback to service_role;
grant update on table public.feedback to service_role;
