-- =============================================================
-- 0015_appointment_requests.sql
-- Public "request a visit" queue + the availability engine that
-- finally puts doctor_schedules (created in 0004, unused since) to work.
--
-- Security shape, deliberately:
--   * anon keeps ZERO access to this schema, exactly as before. The
--     public page never talks to Postgres -- it goes through a
--     serverless function holding the service-role key, so validation
--     and rate limiting live somewhere a browser can't bypass.
--   * A request is NOT an appointment. Strangers write only to this
--     queue; a row in public.appointments appears only when a staff
--     member confirms one.
--   * Nothing clinical lives here. Just who asked, when, and why.
--
-- Safe to re-run.
-- =============================================================

begin;

do $$ begin
  create type public.appointment_request_status as enum (
    'pending', 'confirmed', 'declined', 'cancelled'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.appointment_requests (
  id             uuid primary key default gen_random_uuid(),

  -- What the patient typed. Free text on purpose: this is an unverified
  -- stranger until staff match them to a chart, so it must never be
  -- treated as identity.
  full_name      text not null,
  phone          text not null,
  email          citext,
  reason         text,
  notes          text,

  requested_at   timestamptz not null,          -- the slot they picked
  doctor_id      uuid references public.staff (id) on delete set null,

  status         public.appointment_request_status not null default 'pending',

  -- Set once staff act on it.
  patient_id     uuid references public.patients (id)     on delete set null,
  appointment_id uuid references public.appointments (id) on delete set null,
  handled_by     uuid references public.staff (id)        on delete set null,
  handled_at     timestamptz,
  decline_reason text,
  notified_at    timestamptz,                   -- staff pressed "Notify by WhatsApp"

  -- Coarse abuse signal. A hash, not the address itself -- there's no
  -- reason to keep a visitor's raw IP to count submissions.
  ip_hash        text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists appointment_requests_status_idx  on public.appointment_requests (status, requested_at);
create index if not exists appointment_requests_phone_idx   on public.appointment_requests (phone, created_at desc);
create index if not exists appointment_requests_slot_idx    on public.appointment_requests (doctor_id, requested_at) where status = 'pending';

drop trigger if exists appointment_requests_set_updated_at on public.appointment_requests;
create trigger appointment_requests_set_updated_at
  before update on public.appointment_requests
  for each row execute function app.set_updated_at();

-- =============================================================
-- AVAILABILITY ENGINE
--
-- One source of truth for "is this slot free", used by both the public
-- page and the staff book. Computing it in the database (rather than
-- shipping the day's appointments to a browser and subtracting there)
-- is what keeps a public caller from ever seeing who else is booked.
-- =============================================================

-- Lives in public, not app, because PostgREST can only expose functions
-- from the API schema -- the serverless booking function reaches it via
-- rpc(). That makes the grants below load-bearing: Postgres grants
-- EXECUTE to PUBLIC by default, so it must be revoked explicitly or an
-- anonymous caller could run it.
create or replace function public.available_slots(
  p_doctor_id uuid,
  p_date      date
)
returns table (slot_start timestamptz, slot_end timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_sched record;
begin
  for v_sched in
    select s.start_time, s.end_time, s.slot_minutes
    from public.doctor_schedules s
    where s.doctor_id = p_doctor_id
      -- Postgres dow: 0 = Sunday .. 6 = Saturday, matching the
      -- weekday column's documented meaning in 0004.
      and s.weekday = extract(dow from p_date)::smallint
      and (s.valid_from is null or p_date >= s.valid_from)
      and (s.valid_to   is null or p_date <= s.valid_to)
  loop
    return query
    with slots as (
      select
        gs                                                   as s_start,
        gs + make_interval(mins => v_sched.slot_minutes)      as s_end
      from generate_series(
        (p_date + v_sched.start_time)::timestamptz,
        (p_date + v_sched.end_time)::timestamptz - make_interval(mins => v_sched.slot_minutes),
        make_interval(mins => v_sched.slot_minutes)
      ) as gs
    )
    select sl.s_start, sl.s_end
    from slots sl
    where
      -- Never offer a slot in the past.
      sl.s_start > now()
      -- Already booked.
      and not exists (
        select 1 from public.appointments a
        where a.doctor_id = p_doctor_id
          and a.status not in ('cancelled', 'no_show')
          and tstzrange(a.starts_at, a.ends_at) && tstzrange(sl.s_start, sl.s_end)
      )
      -- Already requested by someone else and still awaiting a decision.
      -- Held so two people can't be told the same slot is free, which
      -- would only surface as a clash when staff confirm the second one.
      and not exists (
        select 1 from public.appointment_requests r
        where r.doctor_id = p_doctor_id
          and r.status = 'pending'
          and r.requested_at = sl.s_start
      );
  end loop;
end;
$$;

-- Staff use this to see the same picture; the public page reaches it only
-- through the service-role serverless function. Revoke the default
-- grant-to-everyone first, then hand it back to just those two.
revoke all on function public.available_slots(uuid, date) from public;
revoke all on function public.available_slots(uuid, date) from anon;
grant execute on function public.available_slots(uuid, date) to authenticated;
grant execute on function public.available_slots(uuid, date) to service_role;

-- =============================================================
-- POLICIES
--
-- Staff-only, like everything else. The public page has no policy here
-- because it has no database connection -- it posts to a function.
-- =============================================================

alter table public.appointment_requests enable row level security;

drop policy if exists appointment_requests_select on public.appointment_requests;
create policy appointment_requests_select on public.appointment_requests
  for select to authenticated
  using (app.is_staff());

drop policy if exists appointment_requests_write on public.appointment_requests;
create policy appointment_requests_write on public.appointment_requests
  for all to authenticated
  using (app.has_role('owner', 'admin', 'receptionist', 'nurse', 'doctor'))
  with check (app.has_role('owner', 'admin', 'receptionist', 'nurse', 'doctor'));

grant select, insert, update on public.appointment_requests to authenticated;

-- =============================================================
-- BOOKING MESSAGE TEMPLATE
--
-- The confirmation WhatsApp text, editable per clinic. Staff press
-- "Notify by WhatsApp" and this is what gets pre-filled -- nothing is
-- sent automatically and no messaging provider is involved.
-- Placeholders are substituted in the app: {{name}} {{date}} {{time}}
-- {{doctor}} {{clinic}} {{phone}} {{address}}
-- =============================================================

alter table public.clinic_settings
  add column if not exists booking_enabled boolean not null default true;

alter table public.clinic_settings
  add column if not exists whatsapp_template text;

update public.clinic_settings
set whatsapp_template = coalesce(whatsapp_template,
'Hello {{name}}, your appointment at {{clinic}} is confirmed for {{date}} at {{time}} with {{doctor}}.

Please arrive 10 minutes early and bring your ID.

{{address}}
{{phone}}')
where id;

-- Default country code used to turn a local number like 03 332 486 into
-- the international form wa.me requires (9613332486). Lebanon by default.
alter table public.clinic_settings
  add column if not exists default_country_code text not null default '961';

revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

insert into app.schema_migrations (version, name)
values ('0015', 'appointment_requests')
on conflict (version) do nothing;

commit;
