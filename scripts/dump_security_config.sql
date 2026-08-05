-- =============================================================
-- dump_security_config.sql
-- Read-only. Paste into the Supabase SQL Editor, run, and send the
-- results back. Changes nothing.
--
-- The schema export shows tables and foreign keys but not the access
-- rules, and in this app RLS *is* the security boundary -- so this is
-- what's needed to actually review who can read and write what.
--
-- Run each block and copy its output (four result sets).
-- =============================================================

-- ── 1. Which tables have RLS switched on at all.
--    A table with policies but RLS disabled is wide open: the policies
--    simply aren't consulted. That is the single most dangerous state
--    here, so it's checked first.
select
  c.relname                          as table_name,
  c.relrowsecurity                   as rls_enabled,
  c.relforcerowsecurity              as rls_forced,
  (select count(*) from pg_policies p
    where p.schemaname = 'public' and p.tablename = c.relname) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
order by c.relrowsecurity, c.relname;


-- ── 2. Every policy, in full.
select
  tablename,
  policyname,
  cmd            as applies_to,
  roles,
  qual           as using_expression,
  with_check     as with_check_expression
from pg_policies
where schemaname = 'public'
order by tablename, cmd, policyname;


-- ── 3. Table privileges for the three API roles.
--    anon should appear here with NOTHING. Any row for anon is a hole
--    straight past RLS-less tables. service_role should hold only what
--    the serverless functions actually need.
select
  table_name,
  grantee,
  string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated', 'service_role', 'public')
group by table_name, grantee
order by
  case grantee when 'anon' then 0 when 'public' then 1 else 2 end,
  table_name;


-- ── 4. Functions callable over the API, and who may execute them.
--    SECURITY DEFINER functions run as their owner and bypass RLS, so
--    any of those executable by anon deserves a hard look.
select
  n.nspname                                as schema,
  p.proname                                as function_name,
  case when p.prosecdef then 'DEFINER (bypasses RLS)' else 'INVOKER' end as security,
  pg_get_userbyid(p.proowner)              as owner,
  coalesce(array_to_string(p.proacl, E'\n'), '(default: executable by PUBLIC)') as grants
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'app')
order by n.nspname, p.proname;
