-- =============================================================
-- 0001_bootstrap.sql
-- Extensions, private schema, migration tracking, shared helpers.
-- Safe to re-run.
-- =============================================================

begin;

create extension if not exists citext;
create extension if not exists pg_trgm;
create extension if not exists btree_gist;

-- -------------------------------------------------------------
-- Private schema. NEVER add this to PostgREST's exposed schemas.
-- Helper functions live here so they are unreachable over the API
-- but still callable from RLS policy expressions.
-- -------------------------------------------------------------
create schema if not exists app;

revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- Stop API roles creating ad-hoc objects in public.
revoke create on schema public from public;

-- -------------------------------------------------------------
-- Migration ledger
-- -------------------------------------------------------------
create table if not exists app.schema_migrations (
  version     text primary key,
  name        text        not null,
  applied_at  timestamptz not null default now()
);

revoke all on app.schema_migrations from authenticated, anon;

-- -------------------------------------------------------------
-- Shared updated_at trigger
-- -------------------------------------------------------------
create or replace function app.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -------------------------------------------------------------
-- anon must never touch anything in this database.
-- Repeated at the end of every migration.
-- -------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

insert into app.schema_migrations (version, name)
values ('0001', 'bootstrap')
on conflict (version) do nothing;

commit;
