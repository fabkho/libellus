create table public.room_messages (
  author_id uuid not null,
  body text not null,
  client_id uuid not null,
  created_at timestamp with time zone default clock_timestamp() not null,
  deleted_at timestamp with time zone,
  deleted_by uuid,
  id uuid default gen_random_uuid() not null,
  kind text default 'text'::text not null,
  moderated boolean default false not null,
  reply_to uuid,
  room_id uuid not null,
  section_id uuid,
  spoiler boolean default false not null,
  visibility text not null
);

-- constraints
alter table public.room_messages add constraint room_messages_author_id_client_id_key UNIQUE (author_id, client_id);
alter table public.room_messages add constraint room_messages_author_id_fkey FOREIGN KEY (author_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.room_messages add constraint room_messages_deleted_by CHECK (((deleted_by IS NULL) OR (deleted_at IS NOT NULL)));
alter table public.room_messages add constraint room_messages_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.room_messages add constraint room_messages_kind_check CHECK ((kind = 'text'::text));
alter table public.room_messages add constraint room_messages_moderated CHECK (((NOT moderated) OR (deleted_at IS NOT NULL)));
alter table public.room_messages add constraint room_messages_pkey PRIMARY KEY (id);
alter table public.room_messages add constraint room_messages_reply_to_fkey FOREIGN KEY (reply_to) REFERENCES room_messages(id) ON DELETE SET NULL;
alter table public.room_messages add constraint room_messages_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE;
alter table public.room_messages add constraint room_messages_section_id_fkey FOREIGN KEY (section_id) REFERENCES room_sections(id) ON DELETE CASCADE;
alter table public.room_messages add constraint room_messages_shape CHECK (
CASE
    WHEN (deleted_at IS NOT NULL) THEN (body = ''::text)
    ELSE (((char_length(body) >= 1) AND (char_length(body) <= 2000)) AND (body ~ '[^[:space:][:cntrl:]\u00a0\u200b]'::text))
END);
alter table public.room_messages add constraint room_messages_visibility_check CHECK ((visibility = ANY (ARRAY['private'::text, 'friends'::text, 'public'::text, 'members'::text])));

-- indexes
CREATE INDEX room_messages_author ON public.room_messages USING btree (author_id, created_at DESC);
CREATE INDEX room_messages_deleted_by ON public.room_messages USING btree (deleted_by) WHERE (deleted_by IS NOT NULL);
CREATE INDEX room_messages_public_author ON public.room_messages USING btree (author_id) WHERE ((visibility = 'public'::text) AND (deleted_at IS NULL));
CREATE INDEX room_messages_reply_to ON public.room_messages USING btree (reply_to) WHERE (reply_to IS NOT NULL);
CREATE INDEX room_messages_room ON public.room_messages USING btree (room_id, section_id, created_at DESC);
CREATE INDEX room_messages_section ON public.room_messages USING btree (section_id, created_at DESC);

-- row level security
alter table public.room_messages enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.room_messages to service_role;
grant insert on table public.room_messages to service_role;
grant maintain on table public.room_messages to service_role;
grant references on table public.room_messages to service_role;
grant select on table public.room_messages to service_role;
grant trigger on table public.room_messages to service_role;
grant truncate on table public.room_messages to service_role;
grant update on table public.room_messages to service_role;
