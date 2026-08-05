-- =============================================================
-- 0014_patient_orders.sql
-- Doctor's orders for an outpatient visit: labs, imaging, procedures,
-- medications, and general instructions. Written as free text, captured
-- as a draft, then signed -- signing is what makes an order real.
--
-- Outpatient shape on purpose. SIMA's version of this table carried an
-- inpatient medication-administration schedule (frequency_hours,
-- total_occurrences, a per-dose administrations child table, and
-- pharmacy stock deduction driving a nurse Care Queue). None of that
-- applies in a clinic where the patient walks out with a prescription,
-- so it isn't here: an order is written, signed, and later marked
-- completed or cancelled.
--
-- Safe to re-run.
-- =============================================================

begin;

do $$ begin
  create type public.patient_order_type as enum (
    'lab', 'imaging', 'procedure', 'medication', 'referral', 'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.patient_order_status as enum (
    'draft', 'active', 'completed', 'cancelled'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.patient_orders (
  id             uuid primary key default gen_random_uuid(),
  patient_id     uuid not null references public.patients (id)     on delete cascade,
  encounter_id   uuid references public.encounters (id)            on delete set null,
  appointment_id uuid references public.appointments (id)          on delete set null,

  order_type     public.patient_order_type   not null default 'other',
  status         public.patient_order_status not null default 'draft',

  -- What the doctor actually typed. Kept verbatim so an order always
  -- reads back the way it was written, whatever the parser made of it.
  order_text     text not null,
  -- Best-effort structure pulled out of order_text at entry time.
  item_name      text,
  dose           text,
  route          text,
  frequency      text,
  instructions   text,

  ordered_by     uuid references public.staff (id) on delete set null,
  signed_at      timestamptz,
  signed_by      uuid references public.staff (id) on delete set null,
  completed_at   timestamptz,
  cancelled_at   timestamptz,
  cancelled_by   uuid references public.staff (id) on delete set null,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- A signed order must record who signed it and when; a draft must not
  -- look signed. Keeps "is this order real?" answerable from one column.
  constraint patient_orders_signed_chk check (
    (status = 'draft' and signed_at is null and signed_by is null)
    or (status <> 'draft' and signed_at is not null)
  )
);

create index if not exists patient_orders_patient_idx on public.patient_orders (patient_id, created_at desc);
create index if not exists patient_orders_status_idx  on public.patient_orders (status);
create index if not exists patient_orders_doctor_idx  on public.patient_orders (ordered_by, created_at desc);

drop trigger if exists patient_orders_set_updated_at on public.patient_orders;
create trigger patient_orders_set_updated_at
  before update on public.patient_orders
  for each row execute function app.set_updated_at();

-- =============================================================
-- POLICIES
-- =============================================================

alter table public.patient_orders enable row level security;

-- Drafts are the author's private scratch space -- nobody else sees an
-- order until it's signed. Everything signed is visible to anyone with
-- a care relationship to the patient, plus lab techs and nurses who
-- have to act on it.
drop policy if exists patient_orders_select on public.patient_orders;
create policy patient_orders_select on public.patient_orders
  for select to authenticated
  using (
    ordered_by = app.staff_id()
    or (
      status <> 'draft'
      and (app.can_access_patient(patient_id) or app.has_role('nurse', 'lab_tech'))
    )
  );

drop policy if exists patient_orders_insert on public.patient_orders;
create policy patient_orders_insert on public.patient_orders
  for insert to authenticated
  with check (
    app.has_role('owner', 'admin', 'doctor')
    and ordered_by = app.staff_id()
    and app.can_access_patient(patient_id)
  );

-- The author (or an admin) edits and signs their own orders. Nurses and
-- lab techs may update too -- that's how an active order gets marked
-- completed once the test is drawn or the procedure is done.
drop policy if exists patient_orders_update on public.patient_orders;
create policy patient_orders_update on public.patient_orders
  for update to authenticated
  using (
    app.is_admin()
    or ordered_by = app.staff_id()
    or (status <> 'draft' and app.has_role('nurse', 'lab_tech'))
  )
  with check (
    app.is_admin()
    or ordered_by = app.staff_id()
    or (status <> 'draft' and app.has_role('nurse', 'lab_tech'))
  );

-- Only an unsigned draft can be thrown away. A signed order is part of
-- the record and gets cancelled, not deleted.
drop policy if exists patient_orders_delete on public.patient_orders;
create policy patient_orders_delete on public.patient_orders
  for delete to authenticated
  using (status = 'draft' and (app.is_admin() or ordered_by = app.staff_id()));

grant select, insert, update, delete on public.patient_orders to authenticated;

revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

insert into app.schema_migrations (version, name)
values ('0014', 'patient_orders')
on conflict (version) do nothing;

commit;
