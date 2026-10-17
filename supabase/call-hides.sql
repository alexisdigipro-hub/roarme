-- Delete calls from Recent Calls (Alex, 17 Oct 2026): one by one or all. Each person clears their own list; the other
-- person keeps theirs (as on WhatsApp). The call row itself stays for the other side.
-- Safe to run again.

create table if not exists public.roar_call_hides (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  call_id uuid not null references public.roar_calls (id) on delete cascade,
  hidden_at timestamptz not null default now(),
  primary key (user_id, call_id)
);
alter table public.roar_call_hides enable row level security;

drop policy if exists roar_call_hides_select on public.roar_call_hides;
create policy roar_call_hides_select on public.roar_call_hides for select to authenticated using (user_id = auth.uid());
drop policy if exists roar_call_hides_insert on public.roar_call_hides;
create policy roar_call_hides_insert on public.roar_call_hides for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.roar_calls c where c.id = call_id and (c.caller = auth.uid() or c.callee = auth.uid())));
drop policy if exists roar_call_hides_delete on public.roar_call_hides;
create policy roar_call_hides_delete on public.roar_call_hides for delete to authenticated using (user_id = auth.uid());

revoke all on public.roar_call_hides from anon;
grant select, insert, delete on public.roar_call_hides to authenticated;
