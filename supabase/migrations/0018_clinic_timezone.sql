-- =============================================================
-- 0018_clinic_timezone.sql
-- Interpret working hours in the clinic's own timezone.
--
-- doctor_schedules stores wall-clock times (08:00-15:00) with no zone,
-- and available_slots cast them with a plain ::timestamptz. That cast
-- uses the *session* timezone, which is UTC on Supabase -- so the
-- clinic's 08:00 became 08:00Z, and a patient in Beirut (UTC+3, and +2
-- in winter) was shown 11:00. Booking "8:00" would have meant arriving
-- three hours late.
--
-- AT TIME ZONE reads the naive timestamp *as* a time in the given zone,
-- which is what a schedule of "we open at 8" actually means. It also
-- follows DST per date, so the autumn changeover needs no maintenance.
--
-- Safe to re-run.
-- =============================================================

begin;

alter table public.clinic_settings
  add column if not exists timezone text not null default 'Asia/Beirut';

create or replace function public.available_slots(
  p_doctor_id uuid,
  p_date      date
)
returns table (slot_start timestamptz, slot_end timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_sched record;
  v_tz    text;
begin
  select coalesce(cs.timezone, 'Asia/Beirut') into v_tz
  from public.clinic_settings cs limit 1;
  if v_tz is null or v_tz = '' then
    v_tz := 'Asia/Beirut';
  end if;

  for v_sched in
    select s.start_time, s.end_time, s.slot_minutes
    from public.doctor_schedules s
    where s.doctor_id = p_doctor_id
      and s.weekday = extract(dow from p_date)::smallint
      and (s.valid_from is null or p_date >= s.valid_from)
      and (s.valid_to   is null or p_date <= s.valid_to)
  loop
    return query
    with slots as (
      select
        gs                                              as s_start,
        gs + make_interval(mins => v_sched.slot_minutes) as s_end
      from generate_series(
        -- Wall-clock time read as local time in the clinic's zone.
        (p_date + v_sched.start_time) at time zone v_tz,
        ((p_date + v_sched.end_time) at time zone v_tz)
          - make_interval(mins => v_sched.slot_minutes),
        make_interval(mins => v_sched.slot_minutes)
      ) as gs
    )
    select sl.s_start, sl.s_end
    from slots sl
    where
      sl.s_start > now()
      and not exists (
        select 1 from public.appointments a
        where a.doctor_id = p_doctor_id
          and a.status not in ('cancelled', 'no_show')
          and tstzrange(a.starts_at, a.ends_at) && tstzrange(sl.s_start, sl.s_end)
      )
      and not exists (
        select 1 from public.appointment_requests r
        where r.doctor_id = p_doctor_id
          and r.status = 'pending'
          and r.requested_at = sl.s_start
      );
  end loop;
end;
$$;

revoke all on function public.available_slots(uuid, date) from public;
revoke all on function public.available_slots(uuid, date) from anon;
grant execute on function public.available_slots(uuid, date) to authenticated;
grant execute on function public.available_slots(uuid, date) to service_role;

insert into app.schema_migrations (version, name)
values ('0018', 'clinic_timezone')
on conflict (version) do nothing;

commit;
