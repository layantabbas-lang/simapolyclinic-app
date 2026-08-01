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
