create table private.note_moderation_log (
  author_id uuid,
  body text not null,
  id uuid default gen_random_uuid() not null,
  message_id uuid not null,
  reason text not null,
  removed_at timestamp with time zone default now() not null,
  removed_by uuid,
  room_id uuid not null,
  visibility text not null
);

-- constraints
alter table private.note_moderation_log add constraint note_moderation_log_author_id_fkey FOREIGN KEY (author_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table private.note_moderation_log add constraint note_moderation_log_pkey PRIMARY KEY (id);
alter table private.note_moderation_log add constraint note_moderation_log_removed_by_fkey FOREIGN KEY (removed_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- indexes
CREATE INDEX note_moderation_log_author ON private.note_moderation_log USING btree (author_id);
CREATE INDEX note_moderation_log_removed_at ON private.note_moderation_log USING btree (removed_at);
CREATE INDEX note_moderation_log_removed_by ON private.note_moderation_log USING btree (removed_by) WHERE (removed_by IS NOT NULL);

-- row level security
alter table private.note_moderation_log enable row level security;

-- no grants to anon, authenticated, service_role, public
