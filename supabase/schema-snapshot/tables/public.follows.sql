create table public.follows (
  follower_id uuid not null,
  followee_id uuid not null,
  requested_at timestamp with time zone default now() not null,
  accepted_at timestamp with time zone,
  declined_at timestamp with time zone
);

-- constraints
alter table public.follows add constraint follows_check CHECK ((follower_id <> followee_id));
alter table public.follows add constraint follows_check1 CHECK (((accepted_at IS NULL) OR (declined_at IS NULL)));
alter table public.follows add constraint follows_followee_id_fkey FOREIGN KEY (followee_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.follows add constraint follows_follower_id_fkey FOREIGN KEY (follower_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.follows add constraint follows_pkey PRIMARY KEY (follower_id, followee_id);

-- indexes
CREATE INDEX follows_followee ON public.follows USING btree (followee_id);
CREATE INDEX follows_followee_accepted ON public.follows USING btree (followee_id, accepted_at DESC, follower_id DESC) WHERE (accepted_at IS NOT NULL);

-- row level security
alter table public.follows enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.follows to service_role;
grant insert on table public.follows to service_role;
grant maintain on table public.follows to service_role;
grant references on table public.follows to service_role;
grant select on table public.follows to service_role;
grant trigger on table public.follows to service_role;
grant truncate on table public.follows to service_role;
grant update on table public.follows to service_role;
