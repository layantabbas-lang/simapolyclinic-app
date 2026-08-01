-- =============================================================
-- 0006_billing.sql
-- Service price list, invoices, payments.
--
-- USD is the functional currency: every amount is stored in USD.
-- LBP is a presentation layer. Each invoice and payment captures
-- the FX rate in force at the moment of the transaction, so an
-- old receipt can always be reprinted with the rate it was issued
-- at rather than today's rate.
--
-- Safe to re-run.
-- =============================================================

begin;

do $$ begin
  create type public.currency as enum ('USD', 'LBP');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.invoice_status as enum
    ('draft', 'issued', 'partially_paid', 'paid', 'void');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.payment_method as enum
    ('cash', 'card', 'omt', 'whish', 'bank_transfer', 'cheque', 'insurance', 'other');
exception when duplicate_object then null; end $$;

-- -------------------------------------------------------------
-- Price list
-- -------------------------------------------------------------
create table if not exists public.services (
  id          uuid primary key default gen_random_uuid(),
  code        text unique,
  name        text not null,
  name_ar     text,
  category    text,
  price_usd   numeric(12,2) not null default 0 check (price_usd >= 0),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists services_active_idx on public.services (is_active) where is_active;

drop trigger if exists services_set_updated_at on public.services;
create trigger services_set_updated_at
  before update on public.services
  for each row execute function app.set_updated_at();

-- -------------------------------------------------------------
-- Invoices
-- -------------------------------------------------------------
create sequence if not exists public.invoice_no_seq start 1;

create table if not exists public.invoices (
  id            uuid primary key default gen_random_uuid(),
  invoice_no    text unique not null,
  patient_id    uuid not null references public.patients (id)   on delete restrict,
  encounter_id  uuid references public.encounters (id)          on delete set null,
  appointment_id uuid references public.appointments (id)       on delete set null,
  status        public.invoice_status not null default 'draft',
  payer_type    public.payer_type not null default 'cash',
  payer_name    text,
  issued_at     timestamptz,
  due_date      date,
  -- LBP per 1 USD, captured at issue time.
  fx_rate_lbp   numeric(14,4),
  subtotal_usd  numeric(12,2) not null default 0,
  discount_usd  numeric(12,2) not null default 0 check (discount_usd >= 0),
  vat_pct       numeric(5,2)  not null default 11,
  vat_usd       numeric(12,2) not null default 0,
  total_usd     numeric(12,2) not null default 0,
  paid_usd      numeric(12,2) not null default 0,
  covered_usd   numeric(12,2) not null default 0,   -- insurer / NSSF portion
  notes         text,
  created_by    uuid references public.staff (id),
  voided_at     timestamptz,
  void_reason   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.invoices
  alter column invoice_no set default
    to_char(now(), 'YYYY') || '-' || lpad(nextval('public.invoice_no_seq')::text, 6, '0');

create index if not exists invoices_patient_idx on public.invoices (patient_id, created_at desc);
create index if not exists invoices_status_idx  on public.invoices (status);
create index if not exists invoices_issued_idx  on public.invoices (issued_at);

drop trigger if exists invoices_set_updated_at on public.invoices;
create trigger invoices_set_updated_at
  before update on public.invoices
  for each row execute function app.set_updated_at();

create table if not exists public.invoice_items (
  id            uuid primary key default gen_random_uuid(),
  invoice_id    uuid not null references public.invoices (id) on delete cascade,
  service_id    uuid references public.services (id),
  description   text not null,
  quantity      numeric(10,2) not null default 1 check (quantity > 0),
  unit_price_usd numeric(12,2) not null default 0,
  discount_usd  numeric(12,2) not null default 0,
  line_total_usd numeric(12,2) generated always as
    (round((quantity * unit_price_usd) - discount_usd, 2)) stored,
  doctor_id     uuid references public.staff (id),
  sort_order    integer not null default 0
);

create index if not exists invoice_items_invoice_idx on public.invoice_items (invoice_id);

-- -------------------------------------------------------------
-- Payments
-- -------------------------------------------------------------
create table if not exists public.payments (
  id              uuid primary key default gen_random_uuid(),
  invoice_id      uuid not null references public.invoices (id) on delete restrict,
  paid_at         timestamptz not null default now(),
  method          public.payment_method not null default 'cash',
  -- What the patient physically handed over:
  amount_original numeric(14,2) not null check (amount_original > 0),
  currency        public.currency not null default 'USD',
  fx_rate_lbp     numeric(14,4),
  -- Normalised value used for all reporting:
  amount_usd      numeric(12,2) not null check (amount_usd > 0),
  reference       text,
  received_by     uuid references public.staff (id),
  notes           text,
  created_at      timestamptz not null default now()
);

create index if not exists payments_invoice_idx on public.payments (invoice_id);
create index if not exists payments_date_idx    on public.payments (paid_at);

-- Keep invoices.paid_usd and status in sync with payments.
create or replace function app.refresh_invoice_totals()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_invoice_id uuid;
  v_paid       numeric(12,2);
  v_total      numeric(12,2);
begin
  v_invoice_id := coalesce(new.invoice_id, old.invoice_id);

  select coalesce(sum(p.amount_usd), 0) into v_paid
  from public.payments p where p.invoice_id = v_invoice_id;

  select i.total_usd into v_total
  from public.invoices i where i.id = v_invoice_id;

  update public.invoices
     set paid_usd = v_paid,
         status = case
                    when status = 'void' then 'void'
                    when v_paid >= coalesce(v_total, 0) and coalesce(v_total, 0) > 0 then 'paid'
                    when v_paid > 0 then 'partially_paid'
                    when status = 'draft' then 'draft'
                    else 'issued'
                  end::public.invoice_status
   where id = v_invoice_id;

  return null;
end;
$$;

drop trigger if exists payments_refresh_invoice on public.payments;
create trigger payments_refresh_invoice
  after insert or update or delete on public.payments
  for each row execute function app.refresh_invoice_totals();

-- =============================================================
-- POLICIES
-- Doctors may read invoices for patients they treat (useful for
-- "what did this visit cost"), but cannot take money.
-- =============================================================

alter table public.services      enable row level security;
alter table public.invoices      enable row level security;
alter table public.invoice_items enable row level security;
alter table public.payments      enable row level security;

drop policy if exists services_select on public.services;
create policy services_select on public.services
  for select to authenticated using (app.is_staff());

drop policy if exists services_write on public.services;
create policy services_write on public.services
  for all to authenticated
  using (app.has_role('owner', 'admin', 'accountant'))
  with check (app.has_role('owner', 'admin', 'accountant'));

drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices
  for select to authenticated
  using (
    app.has_role('owner', 'admin', 'accountant', 'receptionist')
    or app.can_access_patient(patient_id)
  );

drop policy if exists invoices_write on public.invoices;
create policy invoices_write on public.invoices
  for all to authenticated
  using (app.has_role('owner', 'admin', 'accountant', 'receptionist'))
  with check (app.has_role('owner', 'admin', 'accountant', 'receptionist'));

drop policy if exists invoice_items_select on public.invoice_items;
create policy invoice_items_select on public.invoice_items
  for select to authenticated
  using (exists (
    select 1 from public.invoices i
    where i.id = invoice_id
      and (app.has_role('owner', 'admin', 'accountant', 'receptionist')
           or app.can_access_patient(i.patient_id))
  ));

drop policy if exists invoice_items_write on public.invoice_items;
create policy invoice_items_write on public.invoice_items
  for all to authenticated
  using (app.has_role('owner', 'admin', 'accountant', 'receptionist'))
  with check (app.has_role('owner', 'admin', 'accountant', 'receptionist'));

drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments
  for select to authenticated
  using (app.has_role('owner', 'admin', 'accountant', 'receptionist'));

-- Payments are insert-only for cashiers. Corrections are reversals,
-- entered by an admin; nobody edits history at the front desk.
drop policy if exists payments_insert on public.payments;
create policy payments_insert on public.payments
  for insert to authenticated
  with check (app.has_role('owner', 'admin', 'accountant', 'receptionist'));

drop policy if exists payments_admin_update on public.payments;
create policy payments_admin_update on public.payments
  for update to authenticated
  using (app.has_role('owner', 'admin', 'accountant'))
  with check (app.has_role('owner', 'admin', 'accountant'));

grant select, insert, update on public.services      to authenticated;
grant select, insert, update on public.invoices      to authenticated;
grant select, insert, update on public.invoice_items to authenticated;
grant select, insert, update on public.payments      to authenticated;
grant usage on sequence public.invoice_no_seq to authenticated;

revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

insert into app.schema_migrations (version, name)
values ('0006', 'billing')
on conflict (version) do nothing;

commit;
