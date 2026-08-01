-- =============================================================
-- 0002_staff_and_roles.sql
-- Staff directory, clinic settings, and the RLS helper functions
-- that every later policy depends on.
-- Safe to re-run.
-- =============================================================

begin;

do $$ begin
  create type public.staff_role as enum (
    'owner', 'admin', 'doctor', 'nurse', 'receptionist', 'accountant', 'lab_tech'
  );
exception when duplicate_object then null; end $$;

-- -------------------------------------------------------------
-- Staff
-- roles is an array: an owner is very often also a doctor.
-- -------------------------------------------------------------
create table if not exists public.staff (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid unique references auth.users (id) on delete set null,
  full_name     text not null,
  full_name_ar  text,
  roles         public.staff_role[] not null default '{}',
  specialty     text,
  license_no    text,
  phone         text,
  email         citext,
  color_hex     text,                       -- calendar colour
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists staff_user_id_idx on public.staff (user_id) where user_id is not null;
create index if not exists staff_roles_idx   on public.staff using gin (roles);
create index if not exists staff_active_idx  on public.staff (is_active) where is_active;

drop trigger if exists staff_set_updated_at on public.staff;
create trigger staff_set_updated_at
  before update on public.staff
  for each row execute function app.set_updated_at();

-- -------------------------------------------------------------
-- Clinic settings (single row, id is always true)
-- -------------------------------------------------------------
create table if not exists public.clinic_settings (
  id                      boolean primary key default true,
  clinic_name             text not null default 'Polyclinic',
  clinic_name_ar          text,
  phone                   text,
  address                 text,
  logo_url                text,
  default_slot_minutes    integer not null default 20,
  vat_pct                 numeric(5,2) not null default 11,
  -- When true, any doctor may open any patient file.
  -- When false, access requires an appointment or encounter link.
  doctors_see_all_records boolean not null default false,
  updated_at              timestamptz not null default now(),
  constraint clinic_settings_singleton check (id)
);

insert into public.clinic_settings (id) values (true) on conflict (id) do nothing;

drop trigger if exists clinic_settings_set_updated_at on public.clinic_settings;
create trigger clinic_settings_set_updated_at
  before update on public.clinic_settings
  for each row execute function app.set_updated_at();

-- =============================================================
-- RLS HELPERS
--
-- security definer + empty search_path is load-bearing, not
-- decoration. These run as the function owner, which bypasses
-- RLS, and that is what stops a policy on public.staff from
-- recursing into itself when it needs to read public.staff.
--
-- For the same reason: enable row level security, but do NOT
-- use force row level security on these tables.
-- =============================================================

create or replace function app.staff_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select s.id
  from public.staff s
  where s.user_id = (select auth.uid())
    and s.is_active
  limit 1
$$;

create or replace function app.is_staff()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.staff s
    where s.user_id = (select auth.uid())
      and s.is_active
  )
$$;

create or replace function app.has_role(variadic p_roles public.staff_role[])
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.staff s
    where s.user_id = (select auth.uid())
      and s.is_active
      and s.roles && p_roles
  )
$$;

create or replace function app.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select app.has_role('owner', 'admin')
$$;

grant execute on function
  app.staff_id(),
  app.is_staff(),
  app.has_role(public.staff_role[]),
  app.is_admin()
to authenticated;

-- =============================================================
-- POLICIES
-- =============================================================

alter table public.staff           enable row level security;
alter table public.clinic_settings enable row level security;

-- Staff directory is readable by all active staff (needed to render
-- doctor pickers, calendars, "seen by" labels).
drop policy if exists staff_select on public.staff;
create policy staff_select on public.staff
  for select to authenticated
  using (app.is_staff());

drop policy if exists staff_admin_write on public.staff;
create policy staff_admin_write on public.staff
  for all to authenticated
  using (app.is_admin())
  with check (app.is_admin());

-- A staff member may edit their own row. Role escalation is blocked
-- by the roles-unchanged check.
drop policy if exists staff_self_update on public.staff;
create policy staff_self_update on public.staff
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and roles = (select s2.roles from public.staff s2 where s2.id = public.staff.id)
    and is_active = (select s2.is_active from public.staff s2 where s2.id = public.staff.id)
  );

drop policy if exists clinic_settings_select on public.clinic_settings;
create policy clinic_settings_select on public.clinic_settings
  for select to authenticated
  using (app.is_staff());

drop policy if exists clinic_settings_admin_write on public.clinic_settings;
create policy clinic_settings_admin_write on public.clinic_settings
  for all to authenticated
  using (app.is_admin())
  with check (app.is_admin());

grant select, insert, update on public.staff to authenticated;
grant select, update          on public.clinic_settings to authenticated;

revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

insert into app.schema_migrations (version, name)
values ('0002', 'staff_and_roles')
on conflict (version) do nothing;

commit;
