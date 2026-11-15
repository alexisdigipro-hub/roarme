-- Polls (Alex, 15 Nov, from Telegram's New Poll): a message in a chat with a question, up to 12 options and its
-- settings; the votes are kept here. Members of the chat read the poll; who voted for what is shown only when the poll
-- shows voters (otherwise only counts, through roar_poll_state). Safe to run again.
create table if not exists public.roar_polls (
  message_id uuid primary key references public.roar_messages (id) on delete cascade,
  room_id uuid not null references public.roar_rooms (id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  question text not null,
  description text not null default '',
  options jsonb not null default '[]'::jsonb,      -- [{ id, text, by }]
  show_voters boolean not null default true,
  multiple boolean not null default false,
  add_options boolean not null default false,
  revote boolean not null default true,
  shuffle boolean not null default false,
  correct jsonb,                                      -- option ids that are right (a quiz), or null
  closes_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.roar_poll_votes (
  message_id uuid not null references public.roar_polls (message_id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  option_id text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, option_id)
);
alter table public.roar_polls enable row level security;
alter table public.roar_poll_votes enable row level security;
drop policy if exists roar_polls_read on public.roar_polls;
create policy roar_polls_read on public.roar_polls for select to authenticated using (public.roar_is_member(room_id));
drop policy if exists roar_polls_add on public.roar_polls;
create policy roar_polls_add on public.roar_polls for insert to authenticated with check (
  created_by = auth.uid() and public.roar_is_member(room_id)
  and exists (select 1 from public.roar_messages m where m.id = message_id and m.user_id = auth.uid() and m.room_id = roar_polls.room_id)
);
-- one's own votes are always readable; everyone's only when the poll shows voters
drop policy if exists roar_poll_votes_read on public.roar_poll_votes;
create policy roar_poll_votes_read on public.roar_poll_votes for select to authenticated using (
  user_id = auth.uid() or exists (select 1 from public.roar_polls p where p.message_id = roar_poll_votes.message_id and p.show_voters and public.roar_is_member(p.room_id))
);
grant select, insert on public.roar_polls to authenticated;
grant select on public.roar_poll_votes to authenticated;
do $$ begin alter publication supabase_realtime add table public.roar_polls; exception when duplicate_object then null; end $$;

-- the poll as one person sees it: its settings, the counts, my own votes and, when shown, who voted for what
create or replace function public.roar_poll_state(m uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p roar_polls; res jsonb;
begin
  select * into p from roar_polls where message_id = m;
  if p.message_id is null or not roar_is_member(p.room_id) then return null; end if;
  select jsonb_build_object(
    'poll', to_jsonb(p),
    'closed', p.closed_at is not null or (p.closes_at is not null and p.closes_at < now()),
    'counts', coalesce((select jsonb_object_agg(option_id, n) from (select option_id, count(*) n from roar_poll_votes where message_id = m group by option_id) c), '{}'::jsonb),
    'voters_total', (select count(distinct user_id) from roar_poll_votes where message_id = m),
    'mine', coalesce((select jsonb_agg(option_id) from roar_poll_votes where message_id = m and user_id = auth.uid()), '[]'::jsonb),
    'voters', case when p.show_voters then coalesce((select jsonb_object_agg(option_id, us) from (select option_id, jsonb_agg(user_id order by created_at) us from roar_poll_votes where message_id = m group by option_id) v), '{}'::jsonb) else null end
  ) into res;
  return res;
end $$;

-- vote (opts = the chosen option ids; an empty list takes my vote back, if revoting is allowed)
create or replace function public.roar_poll_vote(m uuid, opts text[]) returns void
language plpgsql security definer set search_path = public as $$
declare p roar_polls; had boolean;
begin
  select * into p from roar_polls where message_id = m;
  if p.message_id is null or not roar_is_member(p.room_id) then raise exception 'not allowed'; end if;
  if p.closed_at is not null or (p.closes_at is not null and p.closes_at < now()) then raise exception 'This poll has ended'; end if;
  if coalesce(array_length(opts, 1), 0) > 1 and not p.multiple then raise exception 'Only one answer'; end if;
  if exists (select 1 from unnest(opts) o where not exists (select 1 from jsonb_array_elements(p.options) e where e->>'id' = o)) then raise exception 'No such option'; end if;
  select exists (select 1 from roar_poll_votes where message_id = m and user_id = auth.uid()) into had;
  if had and not p.revote then raise exception 'Votes in this poll cannot be changed'; end if;
  delete from roar_poll_votes where message_id = m and user_id = auth.uid();
  insert into roar_poll_votes (message_id, user_id, option_id) select m, auth.uid(), o from unnest(opts) o on conflict do nothing;
  update roar_polls set updated_at = now() where message_id = m;
end $$;

-- a member adds an option, when the poll allows it (12 at most)
create or replace function public.roar_poll_add_option(m uuid, t text) returns void
language plpgsql security definer set search_path = public as $$
declare p roar_polls;
begin
  select * into p from roar_polls where message_id = m;
  if p.message_id is null or not roar_is_member(p.room_id) or not p.add_options then raise exception 'not allowed'; end if;
  if p.closed_at is not null or (p.closes_at is not null and p.closes_at < now()) then raise exception 'This poll has ended'; end if;
  if jsonb_array_length(p.options) >= 12 then raise exception 'A poll has at most 12 options'; end if;
  if length(trim(coalesce(t, ''))) = 0 then raise exception 'Write the option'; end if;
  update roar_polls set options = options || jsonb_build_array(jsonb_build_object('id', substr(md5(random()::text || clock_timestamp()::text), 1, 8), 'text', left(trim(t), 100), 'by', auth.uid())), updated_at = now() where message_id = m;
end $$;

-- whoever made it (or an admin of the group) stops it
create or replace function public.roar_poll_stop(m uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update roar_polls set closed_at = now(), updated_at = now() where message_id = m and closed_at is null and (created_by = auth.uid() or roar_is_admin(room_id));
end $$;

revoke all on function public.roar_poll_state(uuid), public.roar_poll_vote(uuid, text[]), public.roar_poll_add_option(uuid, text), public.roar_poll_stop(uuid) from public, anon;
grant execute on function public.roar_poll_state(uuid), public.roar_poll_vote(uuid, text[]), public.roar_poll_add_option(uuid, text), public.roar_poll_stop(uuid) to authenticated;
