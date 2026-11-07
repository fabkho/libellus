create table public.room_reactions (
  created_at timestamp with time zone default clock_timestamp() not null,
  emoji text not null,
  member_id uuid not null,
  message_id uuid not null
);

-- constraints
alter table public.room_reactions add constraint room_reactions_emoji_check CHECK ((emoji = ANY (ARRAY['❤️'::text, '😂'::text, '😮'::text, '😢'::text, '🔥'::text, '📚'::text])));
alter table public.room_reactions add constraint room_reactions_member_id_fkey FOREIGN KEY (member_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.room_reactions add constraint room_reactions_message_id_fkey FOREIGN KEY (message_id) REFERENCES room_messages(id) ON DELETE CASCADE;
alter table public.room_reactions add constraint room_reactions_pkey PRIMARY KEY (message_id, member_id);

-- indexes
CREATE INDEX room_reactions_member ON public.room_reactions USING btree (member_id);

-- row level security
alter table public.room_reactions enable row level security;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.room_reactions to service_role;
grant insert on table public.room_reactions to service_role;
grant maintain on table public.room_reactions to service_role;
grant references on table public.room_reactions to service_role;
grant select on table public.room_reactions to service_role;
grant trigger on table public.room_reactions to service_role;
grant truncate on table public.room_reactions to service_role;
grant update on table public.room_reactions to service_role;
