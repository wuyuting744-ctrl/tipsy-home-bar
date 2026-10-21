-- Tipsy Club account data and guest ordering for a static GitHub Pages frontend.
-- Run once in Supabase Dashboard → SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.tipsy_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tipsy_bar_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stock text[] not null default '{}',
  favorites text[] not null default '{}',
  custom_recipes jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  constraint tipsy_custom_recipes_is_array check (jsonb_typeof(custom_recipes) = 'array')
);

create table if not exists public.tipsy_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  share_code uuid not null unique default gen_random_uuid(),
  bar_name text not null default '微调的小酒吧',
  menu text[] not null default '{}',
  published_recipes jsonb not null default '[]'::jsonb check (jsonb_typeof(published_recipes) = 'array'),
  is_open boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists tipsy_one_open_session_per_owner
  on public.tipsy_sessions(owner_id) where is_open;

create table if not exists public.tipsy_orders (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.tipsy_sessions(id) on delete cascade,
  guest_name text not null check (char_length(guest_name) between 1 and 40),
  recipe_id text not null,
  sweetness text not null default '标准口味',
  status text not null default 'pending' check (status in ('pending', 'making', 'done')),
  created_at timestamptz not null default now()
);

alter table public.tipsy_profiles enable row level security;
alter table public.tipsy_bar_data enable row level security;
alter table public.tipsy_sessions enable row level security;
alter table public.tipsy_orders enable row level security;

drop policy if exists "Users manage their own Tipsy profile" on public.tipsy_profiles;
create policy "Users manage their own Tipsy profile"
  on public.tipsy_profiles for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users manage their own Tipsy bar data" on public.tipsy_bar_data;
create policy "Users manage their own Tipsy bar data"
  on public.tipsy_bar_data for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users manage their own Tipsy sessions" on public.tipsy_sessions;
create policy "Users manage their own Tipsy sessions"
  on public.tipsy_sessions for all to authenticated
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "Bar owners read their Tipsy orders" on public.tipsy_orders;
create policy "Bar owners read their Tipsy orders"
  on public.tipsy_orders for select to authenticated
  using (exists (
    select 1 from public.tipsy_sessions s
    where s.id = session_id and s.owner_id = auth.uid()
  ));

drop policy if exists "Bar owners update their Tipsy orders" on public.tipsy_orders;
create policy "Bar owners update their Tipsy orders"
  on public.tipsy_orders for update to authenticated
  using (exists (
    select 1 from public.tipsy_sessions s
    where s.id = session_id and s.owner_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.tipsy_sessions s
    where s.id = session_id and s.owner_id = auth.uid()
  ));

create or replace function public.tipsy_public_menu(p_share_code uuid)
returns table (session_id uuid, bar_name text, menu text[], published_recipes jsonb)
language sql stable security definer
set search_path = ''
as $$
  select s.id, s.bar_name, s.menu, s.published_recipes
  from public.tipsy_sessions s
  where s.share_code = p_share_code and s.is_open
  limit 1;
$$;

create or replace function public.tipsy_place_order(
  p_share_code uuid,
  p_guest_name text,
  p_recipe_id text,
  p_sweetness text default '标准口味'
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
  v_order_id uuid;
  v_guest_name text := left(trim(coalesce(p_guest_name, '')), 40);
  v_sweetness text := left(trim(coalesce(p_sweetness, '标准口味')), 40);
begin
  if char_length(v_guest_name) < 1 then
    raise exception '请填写昵称';
  end if;

  select s.id into v_session_id
  from public.tipsy_sessions s
  where s.share_code = p_share_code
    and s.is_open
    and p_recipe_id = any(s.menu)
  limit 1 for update;

  if v_session_id is null then
    raise exception '今晚菜单已关闭或该饮品不在菜单中';
  end if;

  if exists (
    select 1 from public.tipsy_orders o
    where o.session_id = v_session_id and o.guest_name = v_guest_name
      and o.created_at > now() - interval '5 seconds'
  ) then
    raise exception '刚刚已下单，请稍等几秒再点下一杯';
  end if;

  if (select count(*) from public.tipsy_orders where session_id = v_session_id) >= 300 then
    raise exception '今晚订单已达上限，请联系主人';
  end if;

  insert into public.tipsy_orders(session_id, guest_name, recipe_id, sweetness)
  values (v_session_id, v_guest_name, p_recipe_id, v_sweetness)
  returning id into v_order_id;

  return v_order_id;
end;
$$;

revoke all on function public.tipsy_public_menu(uuid) from public;
revoke all on function public.tipsy_place_order(uuid, text, text, text) from public;
grant execute on function public.tipsy_public_menu(uuid) to anon, authenticated;
grant execute on function public.tipsy_place_order(uuid, text, text, text) to anon, authenticated;

revoke all on public.tipsy_profiles, public.tipsy_bar_data, public.tipsy_sessions from anon;
grant select, insert, update, delete on public.tipsy_profiles to authenticated;
grant select, insert, update, delete on public.tipsy_bar_data to authenticated;
grant select, insert, update, delete on public.tipsy_sessions to authenticated;
revoke all on public.tipsy_orders from anon, authenticated;
grant select on public.tipsy_orders to authenticated;
grant update(status) on public.tipsy_orders to authenticated;

create or replace function public.tipsy_create_profile_for_new_user()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.tipsy_profiles(user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', '调酒爱好者'))
  on conflict (user_id) do nothing;

  insert into public.tipsy_bar_data(user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists tipsy_auth_user_created on auth.users;
create trigger tipsy_auth_user_created
  after insert on auth.users
  for each row execute function public.tipsy_create_profile_for_new_user();

revoke all on function public.tipsy_create_profile_for_new_user() from public, anon, authenticated;
