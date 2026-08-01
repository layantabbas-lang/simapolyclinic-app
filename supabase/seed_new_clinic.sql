-- =============================================================
-- seed_new_clinic.sql
-- Run ONCE per new clinic, in the Supabase SQL editor or via psql
-- as the postgres role. Both bypass RLS, which is the only way to
-- create the first admin: there is no staff row yet, so no policy
-- can authorise the insert.
--
-- Edit the values below before running.
-- =============================================================

begin;

update public.clinic_settings set
  clinic_name             = 'Polyclinique Example',
  clinic_name_ar          = 'عيادة المثال',
  phone                   = '+961 1 000 000',
  address                 = 'Baabda, Mount Lebanon',
  default_slot_minutes    = 20,
  vat_pct                 = 11,
  doctors_see_all_records = false
where id;

-- The first admin. Leave user_id null: migration 0008 links it
-- automatically when this person signs up with the same email.
insert into public.staff (full_name, email, roles, phone)
values ('Clinic Owner', 'owner@example.com', array['owner','admin']::public.staff_role[], '+961 3 000 000')
on conflict do nothing;

-- Starter price list.
insert into public.services (code, name, name_ar, category, price_usd) values
  ('CONS-GEN',  'General consultation',   'استشارة عامة',     'Consultation', 30),
  ('CONS-SPEC', 'Specialist consultation','استشارة اختصاصي',  'Consultation', 50),
  ('CONS-FU',   'Follow-up visit',        'زيارة متابعة',      'Consultation', 20),
  ('PROC-INJ',  'Injection',              'حقنة',             'Procedure',     10),
  ('PROC-ECG',  'ECG',                    'تخطيط قلب',        'Diagnostic',    25),
  ('PROC-US',   'Ultrasound',             'صدى',              'Diagnostic',    45)
on conflict (code) do nothing;

insert into public.rooms (name, floor) values
  ('Room 1', 'Ground'),
  ('Room 2', 'Ground'),
  ('Room 3', 'First')
on conflict do nothing;

commit;

-- Sanity check: every table in public must have RLS on.
-- This should return zero rows.
select c.relname as table_without_rls
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and not c.relrowsecurity;
