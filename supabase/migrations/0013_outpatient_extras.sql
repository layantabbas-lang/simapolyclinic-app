-- =============================================================
-- 0013_outpatient_extras.sql
-- Four outpatient-appropriate features carried over from SIMA's UI
-- that never had a backing table in this schema: the doctor's
-- current-medications reference list, internal staff notes +
-- routing, the patient contact log, lab results (against the
-- 0011 lab_parameters catalog), and a doctor's own list of
-- locations they see patients at.
--
-- Deliberately NOT included here: patient_orders (a full nurse
-- Care Queue / medication-administration-record system with
-- pharmacy stock deduction) and admissions (bed/ward/room
-- tracking) -- both are inpatient hospital workflows, and
-- admissions specifically is the bed-board feature this project
-- excluded from day one. Their leftover UI in PatientsDirectory
-- is removed in the same change as this migration, not built out.
--
-- Safe to re-run.
-- =============================================================

begin;

-- -------------------------------------------------------------
-- Current medications -- a doctor's own med-rec reference list of
-- what the patient is taking. Deliberately separate from any
-- nurse-facing standing order / administration schedule: just a
-- drug name + note the doctor can add, edit, or delete any time.
-- -------------------------------------------------------------
create table if not exists public.patient_medications (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null references public.patients (id) on delete cascade,
  drug_name   text not null,
  note        text,
  created_by  uuid references public.staff (id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists patient_medications_patient_idx on public.patient_medications (patient_id, created_at desc);

-- -------------------------------------------------------------
-- Staff notes -- an internal memo attached to a patient, optionally
-- routed to a role and/or a specific staff member. Kept separate
-- from patient_contact_log (which is the short, broadly-readable
-- summary line) so clinical detail in the note body gets the
-- tighter read access below.
-- -------------------------------------------------------------
create table if not exists public.staff_notes (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null references public.patients (id) on delete cascade,
  body        text not null,
  created_by  uuid references public.staff (id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists staff_notes_patient_idx on public.staff_notes (patient_id, created_at desc);

create table if not exists public.staff_note_recipients (
  id                 uuid primary key default gen_random_uuid(),
  staff_note_id      uuid not null references public.staff_notes (id) on delete cascade,
  recipient_role     public.staff_role,
  recipient_user_id  uuid references public.staff (id) on delete cascade,
  constraint staff_note_recipients_target_chk check (recipient_role is not null or recipient_user_id is not null)
);

create index if not exists staff_note_recipients_note_idx on public.staff_note_recipients (staff_note_id);
create index if not exists staff_note_recipients_user_idx on public.staff_note_recipients (recipient_user_id) where recipient_user_id is not null;

-- -------------------------------------------------------------
-- Contact log -- a short, broadly-readable record of patient
-- contact (phone calls, messages), optionally linking to a fuller
-- staff_notes entry for clinical detail.
-- -------------------------------------------------------------
create table if not exists public.patient_contact_log (
  id            uuid primary key default gen_random_uuid(),
  patient_id    uuid not null references public.patients (id) on delete cascade,
  entry_type    text not null check (entry_type in ('nurse_contact', 'provider_contact', 'secretary_contact', 'phone_call', 'message')),
  actor         text not null check (actor in ('patient', 'secretary', 'nurse', 'provider', 'admin', 'other')),
  summary       text not null,
  staff_note_id uuid references public.staff_notes (id) on delete set null,
  logged_by     uuid references public.staff (id) on delete set null,
  occurred_at   timestamptz not null default now()
);

create index if not exists patient_contact_log_patient_idx on public.patient_contact_log (patient_id, occurred_at desc);

-- -------------------------------------------------------------
-- Lab results -- individual parameter results against the
-- 0011_lab_parameters catalog. Populated either by hand or by the
-- document-analyzer extraction flow.
-- -------------------------------------------------------------
create table if not exists public.patient_lab_results (
  id           uuid primary key default gen_random_uuid(),
  patient_id   uuid not null references public.patients (id) on delete cascade,
  parameter_id bigint not null references public.lab_parameters (id) on delete restrict,
  result_value text not null,
  is_abnormal  boolean not null default false,
  created_by   uuid references public.staff (id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists patient_lab_results_patient_idx on public.patient_lab_results (patient_id, created_at desc);

-- -------------------------------------------------------------
-- Doctor locations -- a doctor's own list of places they see
-- patients (clinics, home visits), for tagging appointments/notes.
-- -------------------------------------------------------------
create table if not exists public.doctor_locations (
  id         uuid primary key default gen_random_uuid(),
  doctor_id  uuid not null references public.staff (id) on delete cascade,
  name       text not null,
  is_active  boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists doctor_locations_doctor_idx on public.doctor_locations (doctor_id, sort_order);

-- =============================================================
-- POLICIES
-- =============================================================

alter table public.patient_medications  enable row level security;
alter table public.staff_notes          enable row level security;
alter table public.staff_note_recipients enable row level security;
alter table public.patient_contact_log  enable row level security;
alter table public.patient_lab_results  enable row level security;
alter table public.doctor_locations     enable row level security;

drop policy if exists patient_medications_select on public.patient_medications;
create policy patient_medications_select on public.patient_medications
  for select to authenticated
  using (app.can_access_patient(patient_id));

drop policy if exists patient_medications_write on public.patient_medications;
create policy patient_medications_write on public.patient_medications
  for all to authenticated
  using (app.has_role('owner', 'admin', 'doctor', 'nurse') and app.can_access_patient(patient_id))
  with check (app.has_role('owner', 'admin', 'doctor', 'nurse') and app.can_access_patient(patient_id));

-- Staff notes: visible to the author, admins, anyone with a care
-- relationship to the patient, or an explicit routed recipient
-- (by role or by name) -- so routing a note to e.g. receptionist
-- works even for staff who don't otherwise have chart access.
drop policy if exists staff_notes_select on public.staff_notes;
create policy staff_notes_select on public.staff_notes
  for select to authenticated
  using (
    created_by = app.staff_id()
    or app.is_admin()
    or app.can_access_patient(patient_id)
    or exists (
      select 1 from public.staff_note_recipients r
      where r.staff_note_id = staff_notes.id
        and (r.recipient_user_id = app.staff_id() or (r.recipient_role is not null and app.has_role(r.recipient_role)))
    )
  );

drop policy if exists staff_notes_insert on public.staff_notes;
create policy staff_notes_insert on public.staff_notes
  for insert to authenticated
  with check (app.is_staff() and created_by = app.staff_id());

drop policy if exists staff_notes_update on public.staff_notes;
create policy staff_notes_update on public.staff_notes
  for update to authenticated
  using (app.is_admin() or created_by = app.staff_id())
  with check (app.is_admin() or created_by = app.staff_id());

drop policy if exists staff_notes_delete on public.staff_notes;
create policy staff_notes_delete on public.staff_notes
  for delete to authenticated
  using (app.is_admin());

-- Recipient rows are just routing metadata, not clinical content --
-- readable by any staff, but only insertable alongside a note the
-- staff member themselves authored.
drop policy if exists staff_note_recipients_select on public.staff_note_recipients;
create policy staff_note_recipients_select on public.staff_note_recipients
  for select to authenticated
  using (app.is_staff());

drop policy if exists staff_note_recipients_insert on public.staff_note_recipients;
create policy staff_note_recipients_insert on public.staff_note_recipients
  for insert to authenticated
  with check (exists (
    select 1 from public.staff_notes n
    where n.id = staff_note_id and n.created_by = app.staff_id()
  ));

drop policy if exists staff_note_recipients_delete on public.staff_note_recipients;
create policy staff_note_recipients_delete on public.staff_note_recipients
  for delete to authenticated
  using (app.is_admin());

-- Contact log: the summary line is meant to stay non-clinical (put
-- clinical detail in the attached staff_note instead), so it's
-- readable clinic-wide like a shared front-desk log.
drop policy if exists patient_contact_log_select on public.patient_contact_log;
create policy patient_contact_log_select on public.patient_contact_log
  for select to authenticated
  using (app.is_staff());

drop policy if exists patient_contact_log_insert on public.patient_contact_log;
create policy patient_contact_log_insert on public.patient_contact_log
  for insert to authenticated
  with check (app.is_staff() and logged_by = app.staff_id());

drop policy if exists patient_contact_log_update on public.patient_contact_log;
create policy patient_contact_log_update on public.patient_contact_log
  for update to authenticated
  using (app.is_admin() or logged_by = app.staff_id())
  with check (app.is_admin() or logged_by = app.staff_id());

drop policy if exists patient_contact_log_delete on public.patient_contact_log;
create policy patient_contact_log_delete on public.patient_contact_log
  for delete to authenticated
  using (app.is_admin());

drop policy if exists patient_lab_results_select on public.patient_lab_results;
create policy patient_lab_results_select on public.patient_lab_results
  for select to authenticated
  using (app.can_access_patient(patient_id) or app.has_role('lab_tech'));

drop policy if exists patient_lab_results_write on public.patient_lab_results;
create policy patient_lab_results_write on public.patient_lab_results
  for all to authenticated
  using (app.has_role('owner', 'admin', 'doctor', 'nurse', 'lab_tech') and app.can_access_patient(patient_id))
  with check (app.has_role('owner', 'admin', 'doctor', 'nurse', 'lab_tech') and app.can_access_patient(patient_id));

-- Doctor locations: names are harmless clinic-wide (needed for
-- appointment/note location pickers), but only the owning doctor
-- (or an admin) can manage the list.
drop policy if exists doctor_locations_select on public.doctor_locations;
create policy doctor_locations_select on public.doctor_locations
  for select to authenticated
  using (app.is_staff());

drop policy if exists doctor_locations_write on public.doctor_locations;
create policy doctor_locations_write on public.doctor_locations
  for all to authenticated
  using (app.is_admin() or doctor_id = app.staff_id())
  with check (app.is_admin() or doctor_id = app.staff_id());

grant select, insert, update, delete on public.patient_medications   to authenticated;
grant select, insert, update, delete on public.staff_notes           to authenticated;
grant select, insert, delete         on public.staff_note_recipients to authenticated;
grant select, insert, update, delete on public.patient_contact_log   to authenticated;
grant select, insert, update, delete on public.patient_lab_results   to authenticated;
grant select, insert, update, delete on public.doctor_locations      to authenticated;

revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

insert into app.schema_migrations (version, name)
values ('0013', 'outpatient_extras')
on conflict (version) do nothing;

commit;
