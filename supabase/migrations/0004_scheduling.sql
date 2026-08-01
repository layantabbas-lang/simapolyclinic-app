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
