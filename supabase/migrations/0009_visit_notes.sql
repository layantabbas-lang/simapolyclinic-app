-- =============================================================
-- 0009_visit_notes.sql
-- Free-text clinical notes (rich-text draft/sign workflow), written by
-- the note editor UI (src/components/VisitNotesManager.tsx and the
-- in-chart Note tab in PatientsDirectory.tsx). This is deliberately
-- separate from public.encounters (0005_clinical.sql) -- encounters are
-- the structured SOAP record; visit_notes is the free-text note the UI
-- was actually built around when it was carried over.
--
-- Keyed by patient_id (uuid), not a numeric mrn -- this app's mrn is a
-- formatted string (e.g. "P001000"), not the plain integer SIMA's UI
-- code assumed. See docs/sima-interface.md and App.tsx history for
-- context on that mismatch.
--
-- Safe to re-run.
-- =============================================================

begin;

do $$ begin
  create type public.visit_note_status as enum ('draft', 'final');
exception when duplicate_object then null; end $$;

create table if not exists public.visit_notes (
  id              uuid primary key default gen_random_uuid(),
  patient_id      uuid not null references public.patients (id)     on delete cascade,
  doctor_id       uuid references public.staff (id)                 on delete set null,
  appointment_id  uuid references public.appointments (id)          on delete set null,
  status          public.visit_note_status not null default 'draft',
  content         text,
  blood_pressure  text,
  heart_rate      text,
  diagnosis       text,
  follow_up_date  text,
  template_id     uuid,
  note_data       jsonb,
  -- Carried over from the UI's optional per-doctor location tag. No FK:
  -- this app doesn't have a doctor_locations table (that's a SIMA-only
  -- concept for a doctor who sees patients at more than one clinic).
  location_id     integer,
  visit_date      timestamptz not null default now(),
  created_by      uuid references public.staff (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists visit_notes_patient_idx     on public.visit_notes (patient_id, created_at desc);
create index if not exists visit_notes_appointment_idx on public.visit_notes (appointment_id) where appointment_id is not null;

drop trigger if exists visit_notes_set_updated_at on public.visit_notes;
create trigger visit_notes_set_updated_at
  before update on public.visit_notes
  for each row execute function app.set_updated_at();

-- =============================================================
-- POLICIES — same care-relationship gate as encounters/diagnoses in
-- 0005_clinical.sql. Receptionists/accountants get no policy here, so
-- they cannot read clinical note content at all.
-- =============================================================

alter table public.visit_notes enable row level security;

drop policy if exists visit_notes_select on public.visit_notes;
create policy visit_notes_select on public.visit_notes
  for select to authenticated
  using (app.can_access_patient(patient_id));

drop policy if exists visit_notes_write on public.visit_notes;
create policy visit_notes_write on public.visit_notes
  for all to authenticated
  using (app.has_role('owner', 'admin', 'doctor', 'nurse') and app.can_access_patient(patient_id))
  with check (app.has_role('owner', 'admin', 'doctor', 'nurse') and app.can_access_patient(patient_id));

grant select, insert, update on public.visit_notes to authenticated;

revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

insert into app.schema_migrations (version, name)
values ('0009', 'visit_notes')
on conflict (version) do nothing;

commit;
