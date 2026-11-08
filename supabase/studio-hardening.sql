-- RoarTransfer Studio security hardening (Alex, 8 Nov 2026: "check the whole site for security holes"). Safe to run again.
-- 1. Picture addresses (logo, banner, backdrop, cover, thumb) only from our own storage or an inline picture: a crafted
--    value could otherwise run script in the page of whoever opens a link.
-- 2. Members change only the columns the page needs: no taking a project's ownership, no pointing a version at another
--    project's file. 3. Notes stay in their own project, keep their author, and point only at their own project's files.
-- 4. A limit on wrong Studio link passwords.
update public.roarstudio_studios set banner = null where banner is not null and banner !~ '^https://bzmjhbnwhdwmncxkqkdl\.supabase\.co/storage/v1/object/public/' and banner !~ '^data:image/(jpeg|png|webp);base64,';

create or replace function public.roarstudio_pic_ok(u text) returns boolean language sql immutable set search_path = '' as $$
  select u is null or u ~ '^https://bzmjhbnwhdwmncxkqkdl\.supabase\.co/storage/v1/object/public/[A-Za-z0-9/_.%~-]+(\?[A-Za-z0-9=&_.-]*)?$' or u ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$'
$$;
alter table public.roarstudio_studios drop constraint if exists rs_studios_pics;
alter table public.roarstudio_studios add constraint rs_studios_pics check (public.roarstudio_pic_ok(logo) and public.roarstudio_pic_ok(banner) and public.roarstudio_pic_ok(backdrop));
alter table public.roarstudio_projects drop constraint if exists rs_projects_cover;
alter table public.roarstudio_projects add constraint rs_projects_cover check (public.roarstudio_pic_ok(cover));
alter table public.roarstudio_versions drop constraint if exists rs_versions_thumb;
alter table public.roarstudio_versions add constraint rs_versions_thumb check (thumb is null or thumb ~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$');

revoke update on public.roarstudio_versions from anon, authenticated;
grant update (label) on public.roarstudio_versions to authenticated;
revoke update on public.roarstudio_projects from anon, authenticated;
grant update (title, artist, color, cover, credits, updated_at) on public.roarstudio_projects to authenticated;
revoke update on public.roarstudio_comments from anon, authenticated;
grant update (done, body) on public.roarstudio_comments to authenticated;

create or replace function public.roarstudio_comment_guard() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.roarstudio_versions v where v.id = new.version_id and v.project_id = new.project_id) then
    raise exception 'note and version are in different projects';
  end if;
  if new.parent_id is not null and not exists (select 1 from public.roarstudio_comments c where c.id = new.parent_id and c.project_id = new.project_id) then
    raise exception 'reply to a note of another project';
  end if;
  if new.voice is not null and (new.voice not like 'studio/' || new.project_id || '/voice/%' or new.voice ~ '\.\.') then raise exception 'bad voice key'; end if;
  if new.attach is not null and (new.attach not like 'studio/' || new.project_id || '/att/%' or new.attach ~ '\.\.') then raise exception 'bad attach key'; end if;
  if tg_op = 'UPDATE' and (new.author is distinct from old.author or new.project_id <> old.project_id or new.version_id <> old.version_id) then
    raise exception 'a note keeps its author and place';
  end if;
  return new;
end $$;
drop trigger if exists roarstudio_comment_guard on public.roarstudio_comments;
create trigger roarstudio_comment_guard before insert or update on public.roarstudio_comments for each row execute function public.roarstudio_comment_guard();

alter table public.roarstudio_comments add column if not exists mentioned_at timestamptz;

create table if not exists public.roarstudio_pw_fails (
  id bigint generated always as identity primary key,
  token text not null,
  ip text,
  at timestamptz not null default now()
);
create index if not exists roarstudio_pw_fails_token on public.roarstudio_pw_fails (token, at);
alter table public.roarstudio_pw_fails enable row level security;
revoke all on public.roarstudio_pw_fails from anon, authenticated;

-- the waiting list: where a sign-up came from, for a limit per address
alter table public.roarstudio_waitlist add column if not exists ip text;
