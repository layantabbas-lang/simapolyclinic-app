-- =============================================================
-- 0007_audit.sql
-- Append-only audit trail.
--
-- The trigger is security definer so it writes as the function
-- owner, which bypasses RLS. The table itself has a SELECT policy
-- for admins and NO insert/update/delete policies, so no API role
-- can forge, alter or erase an entry.
--
-- Note: old_data / new_data contain PHI by design. Restrict who
-- gets the 'admin' role accordingly, and factor this table into
-- your retention policy.
--
-- Safe to re-run.
-- =============================================================

begin;

create table if not exists public.audit_log (
  id             bigint generated always as identity primary key,
  occurred_at    timestamptz not null default now(),
  actor_user_id  uuid,
  actor_staff_id uuid,
  action         text not null,
  table_name     text not null,
  record_id      text,
  old_data       jsonb,
  new_data       jsonb
);

create index if not exists audit_log_time_idx   on public.audit_log (occurred_at desc);
create index if not exists audit_log_record_idx on public.audit_log (table_name, record_id);
create index if not exists audit_log_actor_idx  on public.audit_log (actor_staff_id);

create or replace function app.audit_trigger()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_old := to_jsonb(old);
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    v_new := to_jsonb(new);
  end if;

  insert into public.audit_log (
    actor_user_id, actor_staff_id, action, table_name, record_id, old_data, new_data
  ) values (
    (select auth.uid()),
    app.staff_id(),
    tg_op,
    tg_table_name,
    coalesce(v_new ->> 'id', v_old ->> 'id'),
    v_old,
    v_new
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- Attach to everything worth defending.
do $$
declare
  t text;
begin
  foreach t in array array[
    'staff', 'clinic_settings', 'patients', 'patient_payers',
    'appointments', 'encounters', 'diagnoses', 'prescriptions',
    'lab_orders', 'invoices', 'payments', 'services'
  ]
  loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format(
      'create trigger audit_%1$s
         after insert or update or delete on public.%1$I
         for each row execute function app.audit_trigger()', t);
  end loop;
end $$;

alter table public.audit_log enable row level security;

drop policy if exists audit_log_admin_select on public.audit_log;
create policy audit_log_admin_select on public.audit_log
  for select to authenticated
  using (app.is_admin());

-- No insert / update / delete policies. Deliberate.
grant select on public.audit_log to authenticated;

revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

insert into app.schema_migrations (version, name)
values ('0007', 'audit')
on conflict (version) do nothing;

commit;
