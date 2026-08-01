\set ON_ERROR_STOP on
\pset pager off

-- ---------- fixtures (as postgres, bypassing RLS) ----------
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','admin@c.lb'),
  ('22222222-2222-2222-2222-222222222222','doc.a@c.lb'),
  ('33333333-3333-3333-3333-333333333333','doc.b@c.lb'),
  ('44444444-4444-4444-4444-444444444444','recep@c.lb');

insert into public.staff (id, user_id, full_name, email, roles) values
  ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Admin','admin@c.lb','{owner,admin}'),
  ('aaaaaaaa-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','Dr A','doc.a@c.lb','{doctor}'),
  ('aaaaaaaa-0000-0000-0000-000000000003','33333333-3333-3333-3333-333333333333','Dr B','doc.b@c.lb','{doctor}'),
  ('aaaaaaaa-0000-0000-0000-000000000004','44444444-4444-4444-4444-444444444444','Reception','recep@c.lb','{receptionist}');

insert into public.patients (id, first_name, last_name) values
  ('bbbbbbbb-0000-0000-0000-000000000001','Patient','OfDrA'),
  ('bbbbbbbb-0000-0000-0000-000000000002','Patient','OfDrB');

-- Each doctor has an encounter with exactly one patient.
insert into public.encounters (patient_id, doctor_id, chief_complaint) values
  ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000002','Dr A private note'),
  ('bbbbbbbb-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000003','Dr B private note');

insert into public.invoices (id, patient_id, total_usd, status)
values ('cccccccc-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001', 50, 'issued');

\echo ''
\echo '=================== RLS ENFORCEMENT ==================='

-- ---------- Dr A ----------
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
\echo '--- Dr A (doctors_see_all_records = false) ---'
select 'encounters visible' as check, count(*) as n from public.encounters;
select 'patient registry visible' as check, count(*) as n from public.patients;

-- ---------- Dr B ----------
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
\echo '--- Dr B ---'
select 'encounters visible' as check, count(*) as n from public.encounters;

-- ---------- Receptionist ----------
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
\echo '--- Receptionist ---'
select 'patients visible (needs them)' as check, count(*) as n from public.patients;
select 'encounters visible (must be 0)' as check, count(*) as n from public.encounters;
select 'invoices visible (needs them)' as check, count(*) as n from public.invoices;

\echo '--- Receptionist attempting to write a clinical note ---'
do $$
begin
  insert into public.encounters (patient_id, doctor_id, chief_complaint)
  values ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000002','forged');
  raise warning 'SECURITY HOLE: receptionist inserted an encounter';
exception when insufficient_privilege then
  raise notice 'BLOCKED as expected (RLS denied insert)';
end $$;

\echo '--- Dr A attempting to escalate own role to admin ---'
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$
begin
  update public.staff set roles = '{owner,admin}'
    where id = 'aaaaaaaa-0000-0000-0000-000000000002';
  if app.is_admin() then
    raise warning 'SECURITY HOLE: doctor escalated to admin';
  else
    raise notice 'BLOCKED as expected (roles unchanged)';
  end if;
exception when insufficient_privilege then
  raise notice 'BLOCKED as expected (RLS denied role escalation)';
end $$;

-- ---------- Admin ----------
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
\echo '--- Admin ---'
select 'encounters visible' as check, count(*) as n from public.encounters;
select 'audit rows recorded' as check, count(*) as n from public.audit_log;

-- ---------- anon ----------
reset role;
set role anon;
\echo '--- anon (unauthenticated) ---'
do $$
begin
  perform count(*) from public.patients;
  raise warning 'SECURITY HOLE: anon read the patient table';
exception when insufficient_privilege then
  raise notice 'BLOCKED as expected (anon has no grant)';
end $$;

reset role;

-- ---------- clinic flips the open-records setting ----------
update public.clinic_settings set doctors_see_all_records = true where id;
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
\echo '--- Dr A after doctors_see_all_records = true ---'
select 'encounters visible' as check, count(*) as n from public.encounters;
reset role;

-- ---------- double-booking guard ----------
\echo '--- double booking the same doctor ---'
do $$
begin
  insert into public.appointments (patient_id, doctor_id, starts_at, ends_at) values
    ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000002',
     '2026-08-01 09:00+03','2026-08-01 09:20+03');
  insert into public.appointments (patient_id, doctor_id, starts_at, ends_at) values
    ('bbbbbbbb-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000002',
     '2026-08-01 09:10+03','2026-08-01 09:30+03');
  raise warning 'BUG: overlapping appointment accepted';
exception when exclusion_violation then
  raise notice 'BLOCKED as expected (overlap constraint)';
end $$;

-- ---------- payment rolls up to invoice ----------
insert into public.payments (invoice_id, amount_original, currency, amount_usd, method)
values ('cccccccc-0000-0000-0000-000000000001', 30, 'USD', 30, 'cash');
select 'invoice after $30 of $50' as check, status, paid_usd from public.invoices
where id = 'cccccccc-0000-0000-0000-000000000001';

insert into public.payments (invoice_id, amount_original, currency, fx_rate_lbp, amount_usd, method)
values ('cccccccc-0000-0000-0000-000000000001', 1790000, 'LBP', 89500, 20, 'omt');
select 'invoice after LBP balance' as check, status, paid_usd from public.invoices
where id = 'cccccccc-0000-0000-0000-000000000001';
