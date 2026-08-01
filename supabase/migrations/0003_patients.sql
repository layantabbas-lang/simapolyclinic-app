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
