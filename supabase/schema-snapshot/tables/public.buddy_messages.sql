create table public.buddy_messages (
  author_id uuid not null,
  body text default ''::text not null,
  buddy_read_id uuid not null,
  client_id uuid not null,
  created_at timestamp with time zone default clock_timestamp() not null,
  deleted_at timestamp with time zone,
  deleted_by uuid,
  id uuid default gen_random_uuid() not null,
  kind text default 'text'::text not null,
  media_height integer,
  media_url text,
  media_width integer,
  reply_to uuid,
  section_id uuid,
  spoiler boolean default false not null
);

-- constraints
alter table public.buddy_messages add constraint buddy_messages_author_id_client_id_key UNIQUE (author_id, client_id);
alter table public.buddy_messages add constraint buddy_messages_author_id_fkey FOREIGN KEY (author_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.buddy_messages add constraint buddy_messages_body_length CHECK ((char_length(body) <= 2000));
alter table public.buddy_messages add constraint buddy_messages_buddy_read_id_fkey FOREIGN KEY (buddy_read_id) REFERENCES buddy_reads(id) ON DELETE CASCADE;
alter table public.buddy_messages add constraint buddy_messages_deleted_by CHECK (((deleted_by IS NULL) OR (deleted_at IS NOT NULL)));
alter table public.buddy_messages add constraint buddy_messages_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.buddy_messages add constraint buddy_messages_kind CHECK ((kind = ANY (ARRAY['text'::text, 'gif'::text])));
alter table public.buddy_messages add constraint buddy_messages_pkey PRIMARY KEY (id);
alter table public.buddy_messages add constraint buddy_messages_reply_to_fkey FOREIGN KEY (reply_to) REFERENCES buddy_messages(id) ON DELETE SET NULL;
alter table public.buddy_messages add constraint buddy_messages_section_id_fkey FOREIGN KEY (section_id) REFERENCES buddy_read_sections(id) ON DELETE CASCADE;
alter table public.buddy_messages add constraint buddy_messages_shape CHECK (COALESCE(
CASE
    WHEN (deleted_at IS NOT NULL) THEN ((body = ''::text) AND (media_url IS NULL) AND (media_width IS NULL) AND (media_height IS NULL))
    WHEN (kind = 'text'::text) THEN ((char_length(body) >= 1) AND (body ~ '[^[:space:][:cntrl:]\u00a0\u200b]'::text) AND (media_url IS NULL) AND (media_width IS NULL) AND (media_height IS NULL))
    WHEN (kind = 'gif'::text) THEN ((char_length(media_url) <= 500) AND (media_url ~ '^https://static[0-9]*\.klipy\.com/[A-Za-z0-9._~%/+=?&-]+$'::text) AND ((media_width >= 1) AND (media_width <= 10000)) AND ((media_height >= 1) AND (media_height <= 10000)))
    ELSE false
END, false));
alter table public.buddy_messages add constraint buddy_messages_spoiler CHECK (((NOT spoiler) OR (section_id IS NOT NULL)));

-- indexes
CREATE INDEX buddy_messages_author ON public.buddy_messages USING btree (author_id, created_at DESC);
CREATE INDEX buddy_messages_deleted_by ON public.buddy_messages USING btree (deleted_by) WHERE (deleted_by IS NOT NULL);
CREATE INDEX buddy_messages_read ON public.buddy_messages USING btree (buddy_read_id, created_at DESC, id DESC);
CREATE INDEX buddy_messages_reply_to ON public.buddy_messages USING btree (reply_to) WHERE (reply_to IS NOT NULL);
CREATE INDEX buddy_messages_section ON public.buddy_messages USING btree (section_id, created_at DESC) WHERE (section_id IS NOT NULL);

-- row level security
alter table public.buddy_messages enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.buddy_messages to service_role;
grant insert on table public.buddy_messages to service_role;
grant maintain on table public.buddy_messages to service_role;
grant references on table public.buddy_messages to service_role;
grant select on table public.buddy_messages to service_role;
grant trigger on table public.buddy_messages to service_role;
grant truncate on table public.buddy_messages to service_role;
grant update on table public.buddy_messages to service_role;
