-- Migration: create_auth_backend (Fase 1 — issue #40)
-- Change: supabase-auth-backend
-- Proyecto dedicado: whacwpjgizlxvnmckyli (base vacía)
-- PRD: docs/requirements/supabase-auth-backend.md

-- ============================================================
-- 1. profiles (1:1 con auth.users)
-- ============================================================
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- 2. accounts
-- ============================================================
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type text not null default 'custom',
  balance integer not null default 0,
  icon text,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- 3. transactions
-- ============================================================
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  type text not null check (type in ('expense','transfer','income','adjustment')),
  amount integer not null,
  description text,
  date timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- 4. Triggers
-- ============================================================

-- handle_new_user: crea el profile al registrarse
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- set_updated_at: mantiene updated_at en las 3 tablas
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_updated_at
  before update on public.profiles
  for each row execute procedure public.set_updated_at();

create trigger set_updated_at
  before update on public.accounts
  for each row execute procedure public.set_updated_at();

create trigger set_updated_at
  before update on public.transactions
  for each row execute procedure public.set_updated_at();

-- ============================================================
-- 5. Índices
-- ============================================================
create index accounts_user_id_idx on public.accounts (user_id);
create index transactions_user_id_date_idx on public.transactions (user_id, date);
create index transactions_account_id_idx on public.transactions (account_id);

-- ============================================================
-- 6. RLS (aislamiento por usuario — regla: auth.uid() = user_id)
-- ============================================================
alter table public.profiles enable row level security;
alter table public.accounts enable row level security;
alter table public.transactions enable row level security;

-- profiles (la fila propia se identifica por id = auth.uid())
create policy "select own profile" on public.profiles
  for select using (auth.uid() = id);
create policy "insert own profile" on public.profiles
  for insert with check (auth.uid() = id);
create policy "update own profile" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);
create policy "delete own profile" on public.profiles
  for delete using (auth.uid() = id);

-- accounts
create policy "select own accounts" on public.accounts
  for select using (auth.uid() = user_id);
create policy "insert own accounts" on public.accounts
  for insert with check (auth.uid() = user_id);
create policy "update own accounts" on public.accounts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own accounts" on public.accounts
  for delete using (auth.uid() = user_id);

-- transactions
create policy "select own transactions" on public.transactions
  for select using (auth.uid() = user_id);
create policy "insert own transactions" on public.transactions
  for insert with check (auth.uid() = user_id);
create policy "update own transactions" on public.transactions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own transactions" on public.transactions
  for delete using (auth.uid() = user_id);

-- ============================================================
-- 7. Grants (default Supabase: anon/authenticated sobre public,
--    gobernados por RLS — anon sin uid no obtiene filas)
-- ============================================================
grant usage on schema public to anon, authenticated;
grant all on table public.profiles to anon, authenticated;
grant all on table public.accounts to anon, authenticated;
grant all on table public.transactions to anon, authenticated;
