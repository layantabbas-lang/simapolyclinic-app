-- =============================================================
-- 0012_patient_clinical_history.sql
-- One free-text clinical history summary per patient, kept in its own
-- table (not a column on patients) so receptionist/accountant -- who can
-- read patients for scheduling/registration/billing -- never see
-- doctor-authored clinical narrative. Same separation SIMA used, keyed
-- here by patient_id instead of a numeric patient_mrn.
--
-- Safe to re-run.
-- =============================================================

begin;

create table if not exists public.patient_clinical_history (
  patient_id uuid primary key references public.patients (id) on delete cascade,
  history    text,
  updated_by uuid references public.staff (id) on delete set null,
  updated_at timestamptz not null default now()
);

drop trigger if exists patient_clinical_history_set_updated_at on public.patient_clinical_history;
create trigger patient_clinical_history_set_updated_at
  before update on public.patient_clinical_history
  for each row execute function app.set_updated_at();

alter table public.patient_clinical_history enable row level security;

drop policy if exists patient_clinical_history_select on public.patient_clinical_history;
create policy patient_clinical_history_select on public.patient_clinical_history
  for select to authenticated
  using (app.can_access_patient(patient_id));

drop policy if exists patient_clinical_history_write on public.patient_clinical_history;
create policy patient_clinical_history_write on public.patient_clinical_history
  for all to authenticated
  using (app.has_role('owner', 'admin', 'doctor', 'nurse') and app.can_access_patient(patient_id))
  with check (app.has_role('owner', 'admin', 'doctor', 'nurse') and app.can_access_patient(patient_id));

grant select, insert, update on public.patient_clinical_history to authenticated;

revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

insert into app.schema_migrations (version, name)
values ('0012', 'patient_clinical_history')
on conflict (version) do nothing;

commit;
