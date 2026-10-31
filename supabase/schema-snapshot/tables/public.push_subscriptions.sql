create table public.push_subscriptions (
  id uuid default gen_random_uuid() not null,
  member_id uuid not null,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  locale text default 'en'::text not null,
  created_at timestamp with time zone default now() not null,
  last_ok_at timestamp with time zone
);

-- constraints
alter table public.push_subscriptions add constraint push_subscriptions_auth_check CHECK ((auth ~ '^[A-Za-z0-9_-]{22}$'::text));
alter table public.push_subscriptions add constraint push_subscriptions_endpoint_check CHECK (((endpoint ~ '^https://[^[:space:]]+$'::text) AND (char_length(endpoint) <= 1000)));
alter table public.push_subscriptions add constraint push_subscriptions_endpoint_key UNIQUE (endpoint);
alter table public.push_subscriptions add constraint push_subscriptions_locale_check CHECK ((locale = ANY (ARRAY['en'::text, 'de'::text])));
alter table public.push_subscriptions add constraint push_subscriptions_member_id_fkey FOREIGN KEY (member_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.push_subscriptions add constraint push_subscriptions_p256dh_check CHECK ((p256dh ~ '^[A-Za-z0-9_-]{87}$'::text));
alter table public.push_subscriptions add constraint push_subscriptions_pkey PRIMARY KEY (id);

-- indexes
CREATE INDEX push_subscriptions_member ON public.push_subscriptions USING btree (member_id);

-- row level security
alter table public.push_subscriptions enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.push_subscriptions to service_role;
grant insert on table public.push_subscriptions to service_role;
grant maintain on table public.push_subscriptions to service_role;
grant references on table public.push_subscriptions to service_role;
grant select on table public.push_subscriptions to authenticated;
grant select on table public.push_subscriptions to service_role;
grant trigger on table public.push_subscriptions to service_role;
grant truncate on table public.push_subscriptions to service_role;
grant update on table public.push_subscriptions to service_role;
