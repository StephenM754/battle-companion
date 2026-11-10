-- Battle Companion: Supabase schema.
-- Paste the whole file into Supabase > SQL Editor > New query, and press Run. Safe to run again.
-- Every table uses row-level security: a signed-in user can only see and change their own rows.

-- ---------------------------------------------------------------- profiles (username + admin flag)
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  username   text unique not null,
  is_admin   boolean not null default false,
  created_at timestamptz not null default now()
);

-- New sign-ups get a profile automatically. Username comes from the user's metadata,
-- else from the part of the email before the @ (we sign in with "<username>@battle-companion.app").
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username)
  values (new.id, lower(coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1))))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;

-- ---------------------------------------------------------------- lists
create table if not exists public.lists (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null,
  faction    text,
  slug       text,
  points     integer,
  raw        text not null,
  parsed     jsonb not null,
  notes      text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lists_user on public.lists(user_id);

-- ---------------------------------------------------------------- layouts (saved deployments)
create table if not exists public.layouts (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  list_id    bigint not null references public.lists(id) on delete cascade,
  battleplan text not null,
  name       text not null,
  data       jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists layouts_list on public.layouts(list_id, battleplan);

-- ---------------------------------------------------------------- updated_at
create or replace function public.touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists lists_touch on public.lists;
create trigger lists_touch before update on public.lists for each row execute function public.touch();
drop trigger if exists layouts_touch on public.layouts;
create trigger layouts_touch before update on public.layouts for each row execute function public.touch();

-- ---------------------------------------------------------------- row-level security
alter table public.profiles enable row level security;
alter table public.lists    enable row level security;
alter table public.layouts  enable row level security;

drop policy if exists "profiles: read own or admin" on public.profiles;
create policy "profiles: read own or admin" on public.profiles
  for select using (id = auth.uid() or public.is_admin());

drop policy if exists "lists: own rows" on public.lists;
create policy "lists: own rows" on public.lists
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "layouts: own rows" on public.layouts;
create policy "layouts: own rows" on public.layouts
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from public.lists l where l.id = list_id and l.user_id = auth.uid()));
