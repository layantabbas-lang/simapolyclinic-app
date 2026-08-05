-- =============================================================
-- 0017_service_role_grants.sql
-- Grants the booking endpoint's server-side role the little it needs.
--
-- Every table so far was granted explicitly to `authenticated` and
-- nothing else, so service_role -- the key held only by the Vercel
-- serverless functions -- had no table privileges at all. The public
-- booking endpoint was the first code to actually read a table with
-- it, and failed with:
--   42501 permission denied for table staff
--
-- Deliberately NOT `grant all on all tables to service_role`. That key
-- bypasses RLS entirely, so the blast radius if it ever leaked is the
-- whole database. It gets read access to the two tables the public
-- page renders from, and write access to the request queue -- nothing
-- touching patients, clinical data, or billing.
--
-- public.available_slots needs no extra grants here: it's SECURITY
-- DEFINER, so it reads doctor_schedules/appointments as its owner.
-- The caller only needs EXECUTE, granted in 0015.
--
-- Safe to re-run.
-- =============================================================

begin;

-- Clinic name/phone/address for the page header, and booking_enabled.
grant select on public.clinic_settings to service_role;

-- The doctor list. The endpoint selects only id/full_name/specialty/roles
-- and returns even less -- no emails, phones, or licence numbers.
grant select on public.staff to service_role;

-- The queue itself: insert a request, and read recent ones per phone to
-- enforce the rate limit.
grant select, insert on public.appointment_requests to service_role;

-- Reassert the standing rule -- anon still reaches nothing.
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

insert into app.schema_migrations (version, name)
values ('0017', 'service_role_grants')
on conflict (version) do nothing;

commit;
