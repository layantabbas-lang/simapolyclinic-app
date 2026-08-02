-- Combined migrations 0001-0008, for pasting into the Supabase SQL Editor in one go.
-- Generated 2026-08-02, safe to re-run (each migration is idempotent).

-- =============================================================
-- 0001_bootstrap.sql
-- =============================================================
-- =============================================================
-- 0001_bootstrap.sql
-- Extensions, private schema, migration tracking, shared helpers.
-- Safe to re-run.
-- =============================================================

begin;

create extension if not exists citext;
create extension if not exists pg_trgm;
create extension if not exists btree_gist;

-- -------------------------------------------------------------
-- Private schema. NEVER add this to PostgREST's exposed schemas.
-- Helper functions live here so they are unreachable over the API
-- but still callable from RLS policy expressions.
-- -------------------------------------------------------------
create schema if not exists app;

revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- Stop API roles creating ad-hoc objects in public.
revoke create on schema public from public;

-- -------------------------------------------------------------
-- Migration ledger
-- -------------------------------------------------------------
create table if not exists app.schema_migrations (
  version     text primary key,
  name        text        not null,
  applied_at  timestamptz not null default now()
);

revoke all on app.schema_migrations from authenticated, anon;

-- -------------------------------------------------------------
-- Shared updated_at trigger
-- -------------------------------------------------------------
create or replace function app.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -------------------------------------------------------------
-- anon must never touch anything in this database.
-- Repeated at the end of every migration.
-- -------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

insert into app.schema_migrations (version, name)
values ('0001', 'bootstrap')
on conflict (version) do nothing;

commit;

-- =============================================================
-- 0002_staff_and_roles.sql
-- =============================================================
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

-- =============================================================
-- 0003_patients.sql
-- =============================================================
-- =============================================================
-- 0003_patients.sql
-- Patient registry + payer/insurance records.
-- Demographics are readable by all active staff; clinical data
-- is restricted separately in 0005.
-- Safe to re-run.
-- =============================================================

begin;

do $$ begin
  create type public.gender as enum ('male', 'female', 'other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.payer_type as enum (
    'cash', 'nssf', 'private_insurance', 'corporate', 'ngo', 'army'
  );
exception when duplicate_object then null; end $$;

create sequence if not exists public.mrn_seq start 1000;

create table if not exists public.patients (
  id            uuid primary key default gen_random_uuid(),
  mrn           text unique not null,
  first_name    text not null,
  last_name     text not null,
  father_name   text,
  mother_name   text,
  full_name_ar  text,
  gender        public.gender,
  date_of_birth date,
  national_id   text,                 -- Lebanese ID / passport / residency
  phone         text,
  phone_alt     text,
  email         citext,
  address_line  text,
  city          text,
  nationality   text default 'Lebanese',
  blood_type    text,
  allergies     text,
  chronic_notes text,
  is_deceased   boolean not null default false,
  deleted_at    timestamptz,
  created_by    uuid references public.staff (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.patients
  alter column mrn set default 'P' || lpad(nextval('public.mrn_seq')::text, 6, '0');

create index if not exists patients_last_name_idx on public.patients (lower(last_name));
create index if not exists patients_phone_idx     on public.patients (phone);
create index if not exists patients_national_idx  on public.patients (national_id);
create index if not exists patients_active_idx    on public.patients (deleted_at) where deleted_at is null;
create index if not exists patients_name_trgm_idx
  on public.patients using gin ((first_name || ' ' || last_name) gin_trgm_ops);

drop trigger if exists patients_set_updated_at on public.patients;
create trigger patients_set_updated_at
  before update on public.patients
  for each row execute function app.set_updated_at();

-- -------------------------------------------------------------
-- Payer / insurance
-- -------------------------------------------------------------
create table if not exists public.patient_payers (
  id           uuid primary key default gen_random_uuid(),
  patient_id   uuid not null references public.patients (id) on delete cascade,
  payer_type   public.payer_type not null default 'cash',
  payer_name   text,                              -- e.g. Bankers, Libano-Suisse, NSSF branch
  policy_no    text,
  card_no      text,
  coverage_pct numeric(5,2) check (coverage_pct between 0 and 100),
  valid_from   date,
  valid_to     date,
  is_primary   boolean not null default true,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint patient_payers_valid_range check (valid_to is null or valid_from is null or valid_to >= valid_from)
);

create index if not exists patient_payers_patient_idx on public.patient_payers (patient_id);
create unique index if not exists patient_payers_one_primary_idx
  on public.patient_payers (patient_id) where is_primary;

drop trigger if exists patient_payers_set_updated_at on public.patient_payers;
create trigger patient_payers_set_updated_at
  before update on public.patient_payers
  for each row execute function app.set_updated_at();

-- =============================================================
-- POLICIES
-- Note: no DELETE policy anywhere. Medical records are soft-deleted
-- via deleted_at so retention obligations stay satisfiable.
-- =============================================================

alter table public.patients       enable row level security;
alter table public.patient_payers enable row level security;

drop policy if exists patients_select on public.patients;
create policy patients_select on public.patients
  for select to authenticated
  using (app.is_staff());

drop policy if exists patients_insert on public.patients;
create policy patients_insert on public.patients
  for insert to authenticated
  with check (app.has_role('owner', 'admin', 'receptionist', 'doctor', 'nurse'));

drop policy if exists patients_update on public.patients;
create policy patients_update on public.patients
  for update to authenticated
  using (app.has_role('owner', 'admin', 'receptionist', 'doctor', 'nurse'))
  with check (app.has_role('owner', 'admin', 'receptionist', 'doctor', 'nurse'));

drop policy if exists patient_payers_select on public.patient_payers;
create policy patient_payers_select on public.patient_payers
  for select to authenticated
  using (app.is_staff());

drop policy if exists patient_payers_write on public.patient_payers;
create policy patient_payers_write on public.patient_payers
  for all to authenticated
  using (app.has_role('owner', 'admin', 'receptionist', 'accountant'))
  with check (app.has_role('owner', 'admin', 'receptionist', 'accountant'));

grant select, insert, update on public.patients       to authenticated;
grant select, insert, update on public.patient_payers to authenticated;
grant usage on sequence public.mrn_seq to authenticated;

revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

insert into app.schema_migrations (version, name)
values ('0003', 'patients')
on conflict (version) do nothing;

commit;

-- =============================================================
-- 0004_scheduling.sql
-- =============================================================
-- =============================================================
-- 0004_scheduling.sql
-- Rooms, weekly doctor availability, appointment book.
-- Double-booking is prevented in the database, not the UI.
-- Safe to re-run.
-- =============================================================

begin;

do $$ begin
  create type public.appointment_status as enum (
    'scheduled', 'confirmed', 'arrived', 'in_progress',
    'completed', 'no_show', 'cancelled'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.rooms (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  floor      text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

-- -------------------------------------------------------------
-- Weekly availability template. weekday: 0 = Sunday .. 6 = Saturday
-- -------------------------------------------------------------
create table if not exists public.doctor_schedules (
  id            uuid primary key default gen_random_uuid(),
  doctor_id     uuid not null references public.staff (id) on delete cascade,
  weekday       smallint not null check (weekday between 0 and 6),
  start_time    time not null,
  end_time      time not null,
  slot_minutes  integer not null default 20 check (slot_minutes > 0),
  room_id       uuid references public.rooms (id),
  valid_from    date,
  valid_to      date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint doctor_schedules_time_order check (end_time > start_time)
);

create index if not exists doctor_schedules_doctor_idx on public.doctor_schedules (doctor_id, weekday);

drop trigger if exists doctor_schedules_set_updated_at on public.doctor_schedules;
create trigger doctor_schedules_set_updated_at
  before update on public.doctor_schedules
  for each row execute function app.set_updated_at();

-- -------------------------------------------------------------
-- Appointments
-- -------------------------------------------------------------
create table if not exists public.appointments (
  id               uuid primary key default gen_random_uuid(),
  patient_id       uuid not null references public.patients (id) on delete restrict,
  doctor_id        uuid not null references public.staff (id)    on delete restrict,
  room_id          uuid references public.rooms (id),
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  status           public.appointment_status not null default 'scheduled',
  reason           text,
  notes            text,
  is_walk_in       boolean not null default false,
  arrived_at       timestamptz,
  cancelled_reason text,
  created_by       uuid references public.staff (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint appointments_time_order check (ends_at > starts_at)
);

create index if not exists appointments_doctor_time_idx  on public.appointments (doctor_id, starts_at);
create index if not exists appointments_patient_idx      on public.appointments (patient_id, starts_at desc);
create index if not exists appointments_day_idx          on public.appointments (starts_at);
create index if not exists appointments_status_idx       on public.appointments (status);

-- One doctor cannot hold two live appointments at the same time.
--
-- Checked against the catalog rather than wrapped in an exception
-- handler: an EXCLUDE constraint builds an index underneath, so a
-- duplicate raises duplicate_table (42P07), not duplicate_object.
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'appointments_no_overlap'
      and conrelid = 'public.appointments'::regclass
  ) then
    alter table public.appointments
      add constraint appointments_no_overlap
      exclude using gist (
        doctor_id with =,
        tstzrange(starts_at, ends_at) with &&
      ) where (status not in ('cancelled', 'no_show'));
  end if;
end $$;

drop trigger if exists appointments_set_updated_at on public.appointments;
create trigger appointments_set_updated_at
  before update on public.appointments
  for each row execute function app.set_updated_at();

-- =============================================================
-- POLICIES
-- =============================================================

alter table public.rooms            enable row level security;
alter table public.doctor_schedules enable row level security;
alter table public.appointments     enable row level security;

drop policy if exists rooms_select on public.rooms;
create policy rooms_select on public.rooms
  for select to authenticated using (app.is_staff());

drop policy if exists rooms_admin_write on public.rooms;
create policy rooms_admin_write on public.rooms
  for all to authenticated
  using (app.is_admin()) with check (app.is_admin());

drop policy if exists doctor_schedules_select on public.doctor_schedules;
create policy doctor_schedules_select on public.doctor_schedules
  for select to authenticated using (app.is_staff());

-- Admins manage anyone's schedule; a doctor manages their own.
drop policy if exists doctor_schedules_write on public.doctor_schedules;
create policy doctor_schedules_write on public.doctor_schedules
  for all to authenticated
  using (app.is_admin() or doctor_id = app.staff_id())
  with check (app.is_admin() or doctor_id = app.staff_id());

-- The whole front desk sees the whole book; that is the point of a book.
drop policy if exists appointments_select on public.appointments;
create policy appointments_select on public.appointments
  for select to authenticated using (app.is_staff());

drop policy if exists appointments_insert on public.appointments;
create policy appointments_insert on public.appointments
  for insert to authenticated
  with check (app.has_role('owner', 'admin', 'receptionist', 'nurse', 'doctor'));

drop policy if exists appointments_update on public.appointments;
create policy appointments_update on public.appointments
  for update to authenticated
  using (
    app.has_role('owner', 'admin', 'receptionist', 'nurse')
    or doctor_id = app.staff_id()
  )
  with check (
    app.has_role('owner', 'admin', 'receptionist', 'nurse')
    or doctor_id = app.staff_id()
  );

grant select, insert, update on public.rooms            to authenticated;
grant select, insert, update on public.doctor_schedules to authenticated;
grant select, insert, update on public.appointments     to authenticated;

revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

insert into app.schema_migrations (version, name)
values ('0004', 'scheduling')
on conflict (version) do nothing;

commit;

-- =============================================================
-- 0005_clinical.sql
-- =============================================================
-- =============================================================
-- 0005_clinical.sql
-- Encounters, vitals, diagnoses, prescriptions, lab orders.
--
-- This is where the multi-doctor rule actually lives. A doctor
-- reaches a clinical record only through a care relationship
-- (an appointment or an encounter), unless the clinic has turned
-- on clinic_settings.doctors_see_all_records.
--
-- Safe to re-run.
-- =============================================================

begin;

do $$ begin
  create type public.encounter_status as enum ('open', 'signed', 'amended', 'voided');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.lab_order_status as enum ('ordered', 'collected', 'resulted', 'cancelled');
exception when duplicate_object then null; end $$;

-- -------------------------------------------------------------
-- Encounters
-- -------------------------------------------------------------
create table if not exists public.encounters (
  id             uuid primary key default gen_random_uuid(),
  patient_id     uuid not null references public.patients (id)     on delete restrict,
  doctor_id      uuid not null references public.staff (id)        on delete restrict,
  appointment_id uuid references public.appointments (id)          on delete set null,
  occurred_at    timestamptz not null default now(),
  status         public.encounter_status not null default 'open',
  chief_complaint text,
  history         text,
  examination     text,
  assessment      text,
  plan            text,
  follow_up_date  date,
  signed_at       timestamptz,
  signed_by       uuid references public.staff (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists encounters_patient_idx on public.encounters (patient_id, occurred_at desc);
create index if not exists encounters_doctor_idx  on public.encounters (doctor_id, occurred_at desc);

drop trigger if exists encounters_set_updated_at on public.encounters;
create trigger encounters_set_updated_at
  before update on public.encounters
  for each row execute function app.set_updated_at();

-- -------------------------------------------------------------
-- Vitals
-- -------------------------------------------------------------
create table if not exists public.vitals (
  id             uuid primary key default gen_random_uuid(),
  patient_id     uuid not null references public.patients (id) on delete cascade,
  encounter_id   uuid references public.encounters (id) on delete set null,
  recorded_at    timestamptz not null default now(),
  recorded_by    uuid references public.staff (id),
  temperature_c  numeric(4,1),
  systolic_bp    integer,
  diastolic_bp   integer,
  heart_rate     integer,
  resp_rate      integer,
  spo2           integer,
  weight_kg      numeric(5,2),
  height_cm      numeric(5,1),
  glucose_mgdl   numeric(6,1),
  notes          text
);

create index if not exists vitals_patient_idx on public.vitals (patient_id, recorded_at desc);

-- -------------------------------------------------------------
-- Diagnoses
-- -------------------------------------------------------------
create table if not exists public.diagnoses (
  id           uuid primary key default gen_random_uuid(),
  patient_id   uuid not null references public.patients (id) on delete cascade,
  encounter_id uuid references public.encounters (id) on delete set null,
  icd10_code   text,
  description  text not null,
  is_chronic   boolean not null default false,
  diagnosed_on date not null default current_date,
  resolved_on  date,
  created_by   uuid references public.staff (id),
  created_at   timestamptz not null default now()
);

create index if not exists diagnoses_patient_idx on public.diagnoses (patient_id);

-- -------------------------------------------------------------
-- Prescriptions
-- -------------------------------------------------------------
create table if not exists public.prescriptions (
  id           uuid primary key default gen_random_uuid(),
  patient_id   uuid not null references public.patients (id) on delete restrict,
  encounter_id uuid references public.encounters (id) on delete set null,
  doctor_id    uuid not null references public.staff (id) on delete restrict,
  issued_at    timestamptz not null default now(),
  notes        text,
  printed_at   timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists prescriptions_patient_idx on public.prescriptions (patient_id, issued_at desc);

create table if not exists public.prescription_items (
  id              uuid primary key default gen_random_uuid(),
  prescription_id uuid not null references public.prescriptions (id) on delete cascade,
  drug_name       text not null,
  form            text,
  strength        text,
  dose            text,
  frequency       text,
  duration        text,
  quantity        text,
  instructions    text,
  sort_order      integer not null default 0
);

create index if not exists prescription_items_rx_idx on public.prescription_items (prescription_id);

-- -------------------------------------------------------------
-- Lab / imaging orders
-- -------------------------------------------------------------
create table if not exists public.lab_orders (
  id            uuid primary key default gen_random_uuid(),
  patient_id    uuid not null references public.patients (id) on delete restrict,
  encounter_id  uuid references public.encounters (id) on delete set null,
  doctor_id     uuid not null references public.staff (id) on delete restrict,
  status        public.lab_order_status not null default 'ordered',
  external_lab  text,
  ordered_at    timestamptz not null default now(),
  collected_at  timestamptz,
  resulted_at   timestamptz,
  clinical_note text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists lab_orders_patient_idx on public.lab_orders (patient_id, ordered_at desc);
create index if not exists lab_orders_status_idx  on public.lab_orders (status);

drop trigger if exists lab_orders_set_updated_at on public.lab_orders;
create trigger lab_orders_set_updated_at
  before update on public.lab_orders
  for each row execute function app.set_updated_at();

create table if not exists public.lab_order_items (
  id            uuid primary key default gen_random_uuid(),
  lab_order_id  uuid not null references public.lab_orders (id) on delete cascade,
  test_code     text,
  test_name     text not null,
  result_value  text,
  result_unit   text,
  ref_range     text,
  is_abnormal   boolean,
  resulted_at   timestamptz,
  file_path     text,                       -- Supabase Storage object path
  sort_order    integer not null default 0
);

create index if not exists lab_order_items_order_idx on public.lab_order_items (lab_order_id);

-- =============================================================
-- CARE RELATIONSHIP HELPER
-- Defined after the tables it reads.
-- =============================================================

create or replace function app.can_access_patient(p_patient_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select
    app.is_admin()
    or coalesce(
         (select cs.doctors_see_all_records from public.clinic_settings cs limit 1),
         false
       )
    or exists (
         select 1 from public.appointments a
         where a.patient_id = p_patient_id
           and a.doctor_id = app.staff_id()
       )
    or exists (
         select 1 from public.encounters e
         where e.patient_id = p_patient_id
           and e.doctor_id = app.staff_id()
       )
    -- Nurses and lab techs get access while a visit is live today.
    or (
         app.has_role('nurse', 'lab_tech')
         and exists (
           select 1 from public.appointments a2
           where a2.patient_id = p_patient_id
             and a2.starts_at >= (now() - interval '1 day')
             and a2.status <> 'cancelled'
         )
       )
$$;

grant execute on function app.can_access_patient(uuid) to authenticated;

-- =============================================================
-- POLICIES
--
-- Receptionists and accountants get NO policy on these tables,
-- so they cannot read clinical content at all. That separation
-- is the main reason demographics live in their own table.
-- =============================================================

alter table public.encounters         enable row level security;
alter table public.vitals             enable row level security;
alter table public.diagnoses          enable row level security;
alter table public.prescriptions      enable row level security;
alter table public.prescription_items enable row level security;
alter table public.lab_orders         enable row level security;
alter table public.lab_order_items    enable row level security;

drop policy if exists encounters_select on public.encounters;
create policy encounters_select on public.encounters
  for select to authenticated
  using (app.can_access_patient(patient_id));

drop policy if exists encounters_insert on public.encounters;
create policy encounters_insert on public.encounters
  for insert to authenticated
  with check (app.has_role('owner', 'admin', 'doctor') and doctor_id = app.staff_id());

-- A signed encounter is closed. Amendments create a new row.
drop policy if exists encounters_update on public.encounters;
create policy encounters_update on public.encounters
  for update to authenticated
  using ((app.is_admin() or doctor_id = app.staff_id()) and status = 'open')
  with check (app.is_admin() or doctor_id = app.staff_id());

drop policy if exists vitals_select on public.vitals;
create policy vitals_select on public.vitals
  for select to authenticated
  using (app.can_access_patient(patient_id));

drop policy if exists vitals_write on public.vitals;
create policy vitals_write on public.vitals
  for all to authenticated
  using (app.has_role('owner', 'admin', 'doctor', 'nurse') and app.can_access_patient(patient_id))
  with check (app.has_role('owner', 'admin', 'doctor', 'nurse') and app.can_access_patient(patient_id));

drop policy if exists diagnoses_select on public.diagnoses;
create policy diagnoses_select on public.diagnoses
  for select to authenticated
  using (app.can_access_patient(patient_id));

drop policy if exists diagnoses_write on public.diagnoses;
create policy diagnoses_write on public.diagnoses
  for all to authenticated
  using (app.has_role('owner', 'admin', 'doctor') and app.can_access_patient(patient_id))
  with check (app.has_role('owner', 'admin', 'doctor') and app.can_access_patient(patient_id));

drop policy if exists prescriptions_select on public.prescriptions;
create policy prescriptions_select on public.prescriptions
  for select to authenticated
  using (app.can_access_patient(patient_id));

drop policy if exists prescriptions_write on public.prescriptions;
create policy prescriptions_write on public.prescriptions
  for all to authenticated
  using (app.has_role('owner', 'admin', 'doctor') and doctor_id = app.staff_id())
  with check (app.has_role('owner', 'admin', 'doctor') and doctor_id = app.staff_id());

drop policy if exists prescription_items_select on public.prescription_items;
create policy prescription_items_select on public.prescription_items
  for select to authenticated
  using (exists (
    select 1 from public.prescriptions p
    where p.id = prescription_id and app.can_access_patient(p.patient_id)
  ));

drop policy if exists prescription_items_write on public.prescription_items;
create policy prescription_items_write on public.prescription_items
  for all to authenticated
  using (exists (
    select 1 from public.prescriptions p
    where p.id = prescription_id
      and (app.is_admin() or p.doctor_id = app.staff_id())
  ))
  with check (exists (
    select 1 from public.prescriptions p
    where p.id = prescription_id
      and (app.is_admin() or p.doctor_id = app.staff_id())
  ));

drop policy if exists lab_orders_select on public.lab_orders;
create policy lab_orders_select on public.lab_orders
  for select to authenticated
  using (app.can_access_patient(patient_id) or app.has_role('lab_tech'));

drop policy if exists lab_orders_write on public.lab_orders;
create policy lab_orders_write on public.lab_orders
  for all to authenticated
  using (app.has_role('owner', 'admin', 'doctor', 'nurse', 'lab_tech'))
  with check (app.has_role('owner', 'admin', 'doctor', 'nurse', 'lab_tech'));

drop policy if exists lab_order_items_select on public.lab_order_items;
create policy lab_order_items_select on public.lab_order_items
  for select to authenticated
  using (exists (
    select 1 from public.lab_orders o
    where o.id = lab_order_id
      and (app.can_access_patient(o.patient_id) or app.has_role('lab_tech'))
  ));

drop policy if exists lab_order_items_write on public.lab_order_items;
create policy lab_order_items_write on public.lab_order_items
  for all to authenticated
  using (app.has_role('owner', 'admin', 'doctor', 'nurse', 'lab_tech'))
  with check (app.has_role('owner', 'admin', 'doctor', 'nurse', 'lab_tech'));

grant select, insert, update on public.encounters         to authenticated;
grant select, insert, update on public.vitals             to authenticated;
grant select, insert, update on public.diagnoses          to authenticated;
grant select, insert, update on public.prescriptions      to authenticated;
grant select, insert, update on public.prescription_items to authenticated;
grant select, insert, update on public.lab_orders         to authenticated;
grant select, insert, update on public.lab_order_items    to authenticated;

revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

insert into app.schema_migrations (version, name)
values ('0005', 'clinical')
on conflict (version) do nothing;

commit;

-- =============================================================
-- 0006_billing.sql
-- =============================================================
-- =============================================================
-- 0006_billing.sql
-- Service price list, invoices, payments.
--
-- USD is the functional currency: every amount is stored in USD.
-- LBP is a presentation layer. Each invoice and payment captures
-- the FX rate in force at the moment of the transaction, so an
-- old receipt can always be reprinted with the rate it was issued
-- at rather than today's rate.
--
-- Safe to re-run.
-- =============================================================

begin;

do $$ begin
  create type public.currency as enum ('USD', 'LBP');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.invoice_status as enum
    ('draft', 'issued', 'partially_paid', 'paid', 'void');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.payment_method as enum
    ('cash', 'card', 'omt', 'whish', 'bank_transfer', 'cheque', 'insurance', 'other');
exception when duplicate_object then null; end $$;

-- -------------------------------------------------------------
-- Price list
-- -------------------------------------------------------------
create table if not exists public.services (
  id          uuid primary key default gen_random_uuid(),
  code        text unique,
  name        text not null,
  name_ar     text,
  category    text,
  price_usd   numeric(12,2) not null default 0 check (price_usd >= 0),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists services_active_idx on public.services (is_active) where is_active;

drop trigger if exists services_set_updated_at on public.services;
create trigger services_set_updated_at
  before update on public.services
  for each row execute function app.set_updated_at();

-- -------------------------------------------------------------
-- Invoices
-- -------------------------------------------------------------
create sequence if not exists public.invoice_no_seq start 1;

create table if not exists public.invoices (
  id            uuid primary key default gen_random_uuid(),
  invoice_no    text unique not null,
  patient_id    uuid not null references public.patients (id)   on delete restrict,
  encounter_id  uuid references public.encounters (id)          on delete set null,
  appointment_id uuid references public.appointments (id)       on delete set null,
  status        public.invoice_status not null default 'draft',
  payer_type    public.payer_type not null default 'cash',
  payer_name    text,
  issued_at     timestamptz,
  due_date      date,
  -- LBP per 1 USD, captured at issue time.
  fx_rate_lbp   numeric(14,4),
  subtotal_usd  numeric(12,2) not null default 0,
  discount_usd  numeric(12,2) not null default 0 check (discount_usd >= 0),
  vat_pct       numeric(5,2)  not null default 11,
  vat_usd       numeric(12,2) not null default 0,
  total_usd     numeric(12,2) not null default 0,
  paid_usd      numeric(12,2) not null default 0,
  covered_usd   numeric(12,2) not null default 0,   -- insurer / NSSF portion
  notes         text,
  created_by    uuid references public.staff (id),
  voided_at     timestamptz,
  void_reason   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.invoices
  alter column invoice_no set default
    to_char(now(), 'YYYY') || '-' || lpad(nextval('public.invoice_no_seq')::text, 6, '0');

create index if not exists invoices_patient_idx on public.invoices (patient_id, created_at desc);
create index if not exists invoices_status_idx  on public.invoices (status);
create index if not exists invoices_issued_idx  on public.invoices (issued_at);

drop trigger if exists invoices_set_updated_at on public.invoices;
create trigger invoices_set_updated_at
  before update on public.invoices
  for each row execute function app.set_updated_at();

create table if not exists public.invoice_items (
  id            uuid primary key default gen_random_uuid(),
  invoice_id    uuid not null references public.invoices (id) on delete cascade,
  service_id    uuid references public.services (id),
  description   text not null,
  quantity      numeric(10,2) not null default 1 check (quantity > 0),
  unit_price_usd numeric(12,2) not null default 0,
  discount_usd  numeric(12,2) not null default 0,
  line_total_usd numeric(12,2) generated always as
    (round((quantity * unit_price_usd) - discount_usd, 2)) stored,
  doctor_id     uuid references public.staff (id),
  sort_order    integer not null default 0
);

create index if not exists invoice_items_invoice_idx on public.invoice_items (invoice_id);

-- -------------------------------------------------------------
-- Payments
-- -------------------------------------------------------------
create table if not exists public.payments (
  id              uuid primary key default gen_random_uuid(),
  invoice_id      uuid not null references public.invoices (id) on delete restrict,
  paid_at         timestamptz not null default now(),
  method          public.payment_method not null default 'cash',
  -- What the patient physically handed over:
  amount_original numeric(14,2) not null check (amount_original > 0),
  currency        public.currency not null default 'USD',
  fx_rate_lbp     numeric(14,4),
  -- Normalised value used for all reporting:
  amount_usd      numeric(12,2) not null check (amount_usd > 0),
  reference       text,
  received_by     uuid references public.staff (id),
  notes           text,
  created_at      timestamptz not null default now()
);

create index if not exists payments_invoice_idx on public.payments (invoice_id);
create index if not exists payments_date_idx    on public.payments (paid_at);

-- Keep invoices.paid_usd and status in sync with payments.
create or replace function app.refresh_invoice_totals()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_invoice_id uuid;
  v_paid       numeric(12,2);
  v_total      numeric(12,2);
begin
  v_invoice_id := coalesce(new.invoice_id, old.invoice_id);

  select coalesce(sum(p.amount_usd), 0) into v_paid
  from public.payments p where p.invoice_id = v_invoice_id;

  select i.total_usd into v_total
  from public.invoices i where i.id = v_invoice_id;

  update public.invoices
     set paid_usd = v_paid,
         status = case
                    when status = 'void' then 'void'
                    when v_paid >= coalesce(v_total, 0) and coalesce(v_total, 0) > 0 then 'paid'
                    when v_paid > 0 then 'partially_paid'
                    when status = 'draft' then 'draft'
                    else 'issued'
                  end::public.invoice_status
   where id = v_invoice_id;

  return null;
end;
$$;

drop trigger if exists payments_refresh_invoice on public.payments;
create trigger payments_refresh_invoice
  after insert or update or delete on public.payments
  for each row execute function app.refresh_invoice_totals();

-- =============================================================
-- POLICIES
-- Doctors may read invoices for patients they treat (useful for
-- "what did this visit cost"), but cannot take money.
-- =============================================================

alter table public.services      enable row level security;
alter table public.invoices      enable row level security;
alter table public.invoice_items enable row level security;
alter table public.payments      enable row level security;

drop policy if exists services_select on public.services;
create policy services_select on public.services
  for select to authenticated using (app.is_staff());

drop policy if exists services_write on public.services;
create policy services_write on public.services
  for all to authenticated
  using (app.has_role('owner', 'admin', 'accountant'))
  with check (app.has_role('owner', 'admin', 'accountant'));

drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices
  for select to authenticated
  using (
    app.has_role('owner', 'admin', 'accountant', 'receptionist')
    or app.can_access_patient(patient_id)
  );

drop policy if exists invoices_write on public.invoices;
create policy invoices_write on public.invoices
  for all to authenticated
  using (app.has_role('owner', 'admin', 'accountant', 'receptionist'))
  with check (app.has_role('owner', 'admin', 'accountant', 'receptionist'));

drop policy if exists invoice_items_select on public.invoice_items;
create policy invoice_items_select on public.invoice_items
  for select to authenticated
  using (exists (
    select 1 from public.invoices i
    where i.id = invoice_id
      and (app.has_role('owner', 'admin', 'accountant', 'receptionist')
           or app.can_access_patient(i.patient_id))
  ));

drop policy if exists invoice_items_write on public.invoice_items;
create policy invoice_items_write on public.invoice_items
  for all to authenticated
  using (app.has_role('owner', 'admin', 'accountant', 'receptionist'))
  with check (app.has_role('owner', 'admin', 'accountant', 'receptionist'));

drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments
  for select to authenticated
  using (app.has_role('owner', 'admin', 'accountant', 'receptionist'));

-- Payments are insert-only for cashiers. Corrections are reversals,
-- entered by an admin; nobody edits history at the front desk.
drop policy if exists payments_insert on public.payments;
create policy payments_insert on public.payments
  for insert to authenticated
  with check (app.has_role('owner', 'admin', 'accountant', 'receptionist'));

drop policy if exists payments_admin_update on public.payments;
create policy payments_admin_update on public.payments
  for update to authenticated
  using (app.has_role('owner', 'admin', 'accountant'))
  with check (app.has_role('owner', 'admin', 'accountant'));

grant select, insert, update on public.services      to authenticated;
grant select, insert, update on public.invoices      to authenticated;
grant select, insert, update on public.invoice_items to authenticated;
grant select, insert, update on public.payments      to authenticated;
grant usage on sequence public.invoice_no_seq to authenticated;

revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

insert into app.schema_migrations (version, name)
values ('0006', 'billing')
on conflict (version) do nothing;

commit;

-- =============================================================
-- 0007_audit.sql
-- =============================================================
-- =============================================================
-- 0007_audit.sql
-- Append-only audit trail.
--
-- The trigger is security definer so it writes as the function
-- owner, which bypasses RLS. The table itself has a SELECT policy
-- for admins and NO insert/update/delete policies, so no API role
-- can forge, alter or erase an entry.
--
-- Note: old_data / new_data contain PHI by design. Restrict who
-- gets the 'admin' role accordingly, and factor this table into
-- your retention policy.
--
-- Safe to re-run.
-- =============================================================

begin;

create table if not exists public.audit_log (
  id             bigint generated always as identity primary key,
  occurred_at    timestamptz not null default now(),
  actor_user_id  uuid,
  actor_staff_id uuid,
  action         text not null,
  table_name     text not null,
  record_id      text,
  old_data       jsonb,
  new_data       jsonb
);

create index if not exists audit_log_time_idx   on public.audit_log (occurred_at desc);
create index if not exists audit_log_record_idx on public.audit_log (table_name, record_id);
create index if not exists audit_log_actor_idx  on public.audit_log (actor_staff_id);

create or replace function app.audit_trigger()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_old := to_jsonb(old);
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    v_new := to_jsonb(new);
  end if;

  insert into public.audit_log (
    actor_user_id, actor_staff_id, action, table_name, record_id, old_data, new_data
  ) values (
    (select auth.uid()),
    app.staff_id(),
    tg_op,
    tg_table_name,
    coalesce(v_new ->> 'id', v_old ->> 'id'),
    v_old,
    v_new
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- Attach to everything worth defending.
do $$
declare
  t text;
begin
  foreach t in array array[
    'staff', 'clinic_settings', 'patients', 'patient_payers',
    'appointments', 'encounters', 'diagnoses', 'prescriptions',
    'lab_orders', 'invoices', 'payments', 'services'
  ]
  loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format(
      'create trigger audit_%1$s
         after insert or update or delete on public.%1$I
         for each row execute function app.audit_trigger()', t);
  end loop;
end $$;

alter table public.audit_log enable row level security;

drop policy if exists audit_log_admin_select on public.audit_log;
create policy audit_log_admin_select on public.audit_log
  for select to authenticated
  using (app.is_admin());

-- No insert / update / delete policies. Deliberate.
grant select on public.audit_log to authenticated;

revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

insert into app.schema_migrations (version, name)
values ('0007', 'audit')
on conflict (version) do nothing;

commit;

-- =============================================================
-- 0008_provisioning.sql
-- =============================================================
-- =============================================================
-- 0008_provisioning.sql
-- Invite-only staff onboarding.
--
-- An admin creates the staff row first (with an email, no user_id).
-- When that person signs up, this trigger links their auth user to
-- the waiting row. If no row is waiting, they get an account with
-- zero roles and every policy denies them.
--
-- This is why no policy anywhere uses auth.jwt() claims: the client
-- controls sign-up metadata, but it does not control this table.
--
-- Safe to re-run.
-- =============================================================

begin;

create or replace function app.link_staff_on_signup()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.staff s
     set user_id = new.id,
         updated_at = now()
   -- citext must be schema-qualified: search_path is empty inside
   -- this function, so a bare type name will not resolve.
   where s.email = new.email::public.citext
     and s.user_id is null
     and s.is_active;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.link_staff_on_signup();

-- Convenience view for the app's "who am I" call.
create or replace view public.me
with (security_invoker = true)
as
  select s.id, s.full_name, s.full_name_ar, s.roles, s.specialty, s.is_active
  from public.staff s
  where s.user_id = (select auth.uid());

grant select on public.me to authenticated;

revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

insert into app.schema_migrations (version, name)
values ('0008', 'provisioning')
on conflict (version) do nothing;

commit;

