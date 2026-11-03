create table public.buddy_read_members (
  auto_through smallint,
  buddy_read_id uuid not null,
  entry_id uuid,
  hand_through smallint,
  invited_at timestamp with time zone default clock_timestamp() not null,
  invited_by uuid,
  joined_at timestamp with time zone,
  last_read_at timestamp with time zone,
  member_id uuid not null,
  read_through smallint generated always as (GREATEST(COALESCE((auto_through)::integer, 0), COALESCE((hand_through)::integer, 0))) stored,
  role text default 'member'::text not null
);

-- constraints
alter table public.buddy_read_members add constraint buddy_read_members_auto_through_check CHECK ((auto_through >= 0));
alter table public.buddy_read_members add constraint buddy_read_members_buddy_read_id_fkey FOREIGN KEY (buddy_read_id) REFERENCES buddy_reads(id) ON DELETE CASCADE;
alter table public.buddy_read_members add constraint buddy_read_members_check CHECK (((role = 'member'::text) OR (joined_at IS NOT NULL)));
alter table public.buddy_read_members add constraint buddy_read_members_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES library_entries(id) ON DELETE SET NULL;
alter table public.buddy_read_members add constraint buddy_read_members_hand_through_check CHECK ((hand_through >= 0));
alter table public.buddy_read_members add constraint buddy_read_members_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.buddy_read_members add constraint buddy_read_members_member_id_fkey FOREIGN KEY (member_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.buddy_read_members add constraint buddy_read_members_pkey PRIMARY KEY (buddy_read_id, member_id);
alter table public.buddy_read_members add constraint buddy_read_members_role_check CHECK ((role = ANY (ARRAY['host'::text, 'member'::text])));

-- indexes
CREATE INDEX buddy_read_members_entry ON public.buddy_read_members USING btree (entry_id) WHERE (entry_id IS NOT NULL);
CREATE INDEX buddy_read_members_invited_by ON public.buddy_read_members USING btree (invited_by) WHERE (invited_by IS NOT NULL);
CREATE INDEX buddy_read_members_member ON public.buddy_read_members USING btree (member_id);
CREATE UNIQUE INDEX buddy_read_members_one_host ON public.buddy_read_members USING btree (buddy_read_id) WHERE (role = 'host'::text);

-- row level security
alter table public.buddy_read_members enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.buddy_read_members to service_role;
grant insert on table public.buddy_read_members to service_role;
grant maintain on table public.buddy_read_members to service_role;
grant references on table public.buddy_read_members to service_role;
grant select on table public.buddy_read_members to service_role;
grant trigger on table public.buddy_read_members to service_role;
grant truncate on table public.buddy_read_members to service_role;
grant update on table public.buddy_read_members to service_role;
