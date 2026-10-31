create table private.waitlist (
  consent_text_version text not null,
  created_at timestamp with time zone default now() not null,
  email citext not null,
  id uuid default gen_random_uuid() not null,
  invite_code_id uuid,
  invited_at timestamp with time zone,
  locale text,
  note text,
  source text default 'reading_page'::text not null,
  source_member_id uuid
);

-- constraints
alter table private.waitlist add constraint waitlist_consent_text_version_check CHECK (((char_length(consent_text_version) >= 1) AND (char_length(consent_text_version) <= 40)));
alter table private.waitlist add constraint waitlist_email_check CHECK (((char_length((email)::text) >= 6) AND (char_length((email)::text) <= 254)));
alter table private.waitlist add constraint waitlist_email_key UNIQUE (email);
alter table private.waitlist add constraint waitlist_invite_code_id_fkey FOREIGN KEY (invite_code_id) REFERENCES invite_codes(id) ON DELETE SET NULL;
alter table private.waitlist add constraint waitlist_locale_check CHECK ((locale = ANY (ARRAY['de'::text, 'en'::text])));
alter table private.waitlist add constraint waitlist_note_check CHECK ((char_length(note) <= 1000));
alter table private.waitlist add constraint waitlist_pkey PRIMARY KEY (id);
alter table private.waitlist add constraint waitlist_source_check CHECK ((source = 'reading_page'::text));
alter table private.waitlist add constraint waitlist_source_member_id_fkey FOREIGN KEY (source_member_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- indexes
CREATE INDEX waitlist_created_at ON private.waitlist USING btree (created_at DESC);
CREATE INDEX waitlist_invite_code_id ON private.waitlist USING btree (invite_code_id) WHERE (invite_code_id IS NOT NULL);
CREATE INDEX waitlist_source_member_id ON private.waitlist USING btree (source_member_id) WHERE (source_member_id IS NOT NULL);

-- row level security
alter table private.waitlist enable row level security;

-- no grants to anon, authenticated, service_role, public
