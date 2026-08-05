-- =============================================================
-- 0020_lock_rls_helpers.sql
-- Take EXECUTE on the RLS helper functions away from PUBLIC.
--
-- Found reviewing the live grants: the five helpers carried an ACL of
--
--     =X/postgres              <- empty grantee means PUBLIC
--     authenticated=X/postgres
--
-- The first line grants EXECUTE to PUBLIC, which includes anon. That
-- came from Postgres's default for new functions -- 0002 granted
-- `authenticated` explicitly but never revoked the default.
--
-- It is not currently reachable: 0001 does `revoke all on schema app
-- from public`, and without USAGE on the schema nobody can call
-- anything inside it. But that left one grant -- a single future
-- `grant usage on schema app to anon` -- standing between anon and
-- five SECURITY DEFINER functions that bypass RLS by design. Two
-- independent locks are the point of defence in depth; this restores
-- the second one.
--
-- `authenticated` keeps EXECUTE: RLS policy expressions are evaluated
-- as the querying user, so every logged-in request needs to call these.
-- Revoking from them would lock the whole clinic out of its own data.
--
-- The trigger functions in this schema (set_updated_at, audit_trigger,
-- refresh_invoice_totals, link_staff_on_signup) are deliberately left
-- alone: they return `trigger`, and Postgres refuses to invoke such a
-- function directly, so a PUBLIC grant on them confers nothing.
--
-- Safe to re-run.
-- =============================================================

begin;

revoke all on function app.staff_id()                            from public;
revoke all on function app.is_staff()                            from public;
revoke all on function app.is_admin()                            from public;
revoke all on function app.has_role(public.staff_role[])         from public;
revoke all on function app.can_access_patient(uuid)              from public;

-- Belt and braces: name anon directly, so this reads unambiguously in
-- a future audit rather than relying on anon's membership of PUBLIC.
revoke all on function app.staff_id()                            from anon;
revoke all on function app.is_staff()                            from anon;
revoke all on function app.is_admin()                            from anon;
revoke all on function app.has_role(public.staff_role[])         from anon;
revoke all on function app.can_access_patient(uuid)              from anon;

-- Re-assert what must keep working. Without these, every policy that
-- calls a helper starts failing and no one can read anything.
grant execute on function app.staff_id()                          to authenticated;
grant execute on function app.is_staff()                          to authenticated;
grant execute on function app.is_admin()                          to authenticated;
grant execute on function app.has_role(public.staff_role[])       to authenticated;
grant execute on function app.can_access_patient(uuid)            to authenticated;

insert into app.schema_migrations (version, name)
values ('0020', 'lock_rls_helpers')
on conflict (version) do nothing;

commit;
