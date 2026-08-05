-- =============================================================
-- 0016_clinic_hours.sql
-- Working hours for Layan's Clinic: Monday to Friday, 08:00-15:00,
-- in 30-minute slots. This is what public.available_slots reads to
-- decide what the booking page can offer -- with doctor_schedules
-- empty, every date shows "no times available".
--
-- Also grants the clinic owner the 'doctor' role. The booking page
-- only offers staff carrying it, and RLS uses it for clinical access
-- (encounters, prescriptions, orders) -- owner/admin alone doesn't
-- make someone bookable.
--
-- Adding another doctor later: repeat the insert with their staff id.
--
-- Safe to re-run.
-- =============================================================

begin;

-- -------------------------------------------------------------
-- 1. Make the treating physician bookable.
--    array_append only when missing, so re-running doesn't
--    accumulate duplicate roles.
-- -------------------------------------------------------------
update public.staff
set roles = array_append(roles, 'doctor'::public.staff_role)
where email = 'Layan.t.abbas@gmail.com'
  and not (roles @> array['doctor'::public.staff_role]);

-- Fallback for the same person if the email on the row differs from
-- the login: match the owner instead. Same guard against duplicates.
update public.staff
set roles = array_append(roles, 'doctor'::public.staff_role)
where roles @> array['owner'::public.staff_role]
  and not (roles @> array['doctor'::public.staff_role]);

-- -------------------------------------------------------------
-- 2. Weekly hours: Mon-Fri 08:00-15:00, 30-minute slots.
--    weekday follows Postgres dow (0 = Sunday .. 6 = Saturday),
--    so Monday..Friday is 1..5 -- matching what available_slots
--    compares against extract(dow from date).
--
--    No natural unique key here, so guard on the values themselves
--    to keep this idempotent.
-- -------------------------------------------------------------
insert into public.doctor_schedules (doctor_id, weekday, start_time, end_time, slot_minutes)
select s.id, wd, time '08:00', time '15:00', 30
from public.staff s
cross join generate_series(1, 5) as wd
where s.roles @> array['doctor'::public.staff_role]
  and s.is_active
  and not exists (
    select 1 from public.doctor_schedules ds
    where ds.doctor_id = s.id
      and ds.weekday = wd
      and ds.start_time = time '08:00'
      and ds.end_time = time '15:00'
  );

-- Keep the app's own default in step, so appointments booked by staff
-- in the calendar default to the same length as the public page offers.
update public.clinic_settings set default_slot_minutes = 30 where id;

insert into app.schema_migrations (version, name)
values ('0016', 'clinic_hours')
on conflict (version) do nothing;

commit;
