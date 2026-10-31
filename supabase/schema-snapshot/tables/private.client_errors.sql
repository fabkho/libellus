create table private.client_errors (
  id bigint generated always as identity not null,
  created_at timestamp with time zone default now() not null,
  last_seen_at timestamp with time zone default now() not null,
  user_id uuid,
  caller_key text not null,
  kind text not null,
  message text not null,
  stack text,
  route text,
  app_version text,
  user_agent text,
  standalone boolean,
  online boolean,
  count integer default 1 not null
);

-- constraints
alter table private.client_errors add constraint client_errors_app_version_check CHECK ((char_length(app_version) <= 64));
alter table private.client_errors add constraint client_errors_count_check CHECK ((count >= 1));
alter table private.client_errors add constraint client_errors_kind_check CHECK ((kind = ANY (ARRAY['error'::text, 'unhandledrejection'::text, 'vue'::text, 'chunk'::text, 'outbox'::text, 'shelf'::text, 'vitals'::text])));
alter table private.client_errors add constraint client_errors_message_check CHECK (((char_length(message) >= 1) AND (char_length(message) <= 1000)));
alter table private.client_errors add constraint client_errors_pkey PRIMARY KEY (id);
alter table private.client_errors add constraint client_errors_route_check CHECK ((char_length(route) <= 200));
alter table private.client_errors add constraint client_errors_stack_check CHECK ((char_length(stack) <= 8000));
alter table private.client_errors add constraint client_errors_user_agent_check CHECK ((char_length(user_agent) <= 200));
alter table private.client_errors add constraint client_errors_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- indexes
CREATE INDEX client_errors_caller_created_at ON private.client_errors USING btree (caller_key, created_at);
CREATE INDEX client_errors_created_at ON private.client_errors USING btree (created_at);
CREATE INDEX client_errors_user_id ON private.client_errors USING btree (user_id);

-- row level security
alter table private.client_errors enable row level security;

-- no grants to anon, authenticated, service_role, public
