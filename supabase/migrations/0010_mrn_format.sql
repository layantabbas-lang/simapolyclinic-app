-- =============================================================
-- 0010_mrn_format.sql
-- Switches patient MRNs from this app's original "P" + zero-padded
-- format (e.g. "P001000") to a plain incrementing number, matching
-- SIMA's own MRN convention (e.g. "221115673") so charts read the same
-- way across both systems.
--
-- Reformats any patients already created under the old scheme.
-- Safe to re-run.
-- =============================================================

begin;

alter table public.patients
  alter column mrn set default nextval('public.mrn_seq')::text;

-- Strip the old "P" prefix and leading zeros from already-generated MRNs
-- (e.g. "P001000" -> "1000"). Only touches rows still in the old format;
-- anything already plain-numeric (or manually set) is left alone.
update public.patients
set mrn = ltrim(substring(mrn from 2), '0')
where mrn ~ '^P[0-9]+$';

-- Guard against an empty string if a padded value were ever all zeros.
update public.patients set mrn = '0' where mrn = '';

insert into app.schema_migrations (version, name)
values ('0010', 'mrn_format')
on conflict (version) do nothing;

commit;
