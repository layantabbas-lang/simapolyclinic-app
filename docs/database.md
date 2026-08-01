# SIMA Clinic — database foundation

Supabase schema for a Lebanese polyclinic, one project per clinic.
All 8 migrations verified on PostgreSQL 16: clean install, three
consecutive re-runs, and an RLS enforcement suite.

## Layout

```
migrations/          0001 .. 0008, applied in filename order
seed_new_clinic.sql  run once per clinic, as postgres
run_migrations.sh    applies pending migrations to one or all clinics
rls_test.sql         regression suite for the security model
supabase_stub.sql    local stand-in for Supabase auth, for testing only
```

## Provisioning a new clinic

1. Create the Supabase project.
2. `./run_migrations.sh "postgresql://postgres:PW@db.xxx.supabase.co:5432/postgres"`
3. Edit and run `seed_new_clinic.sql` in the SQL editor — sets the clinic
   name, creates the first owner, loads a starter price list.
4. The owner signs up with the seeded email. Migration 0008 links the
   auth user to the waiting staff row automatically.

For a fleet, put one connection string per line in `clinics.txt` and run
`./run_migrations.sh --all`. The runner aborts if any table in `public`
ends up without RLS.

## Security model

**Invite-only.** An admin creates the staff row first; sign-up only links
to a row that already exists. Someone who signs up uncalled gets an
account with zero roles, and every policy denies them.

**No policy trusts the JWT.** Roles live in `public.staff`, which the
client cannot write. Sign-up metadata is client-controlled and is
therefore never consulted for authorisation.

**Helpers are `security definer` with `search_path = ''`.** This is
load-bearing. It is what stops a policy on `staff` from recursing into
itself when it needs to read `staff`. For the same reason these tables
use `enable row level security` but *not* `force row level security`.

Two consequences worth remembering when you extend this:
- Any type referenced inside such a function must be schema-qualified
  (`public.citext`, `public.invoice_status`). A bare name will not resolve.
- `EXCLUDE` constraints build an index underneath, so a duplicate raises
  `duplicate_table`, not `duplicate_object`. Check `pg_constraint` rather
  than trapping an exception.

**Demographics and clinical data are separate tables** so receptionists
can be granted one and denied the other. Verified: a receptionist sees
the patient registry and invoices, and zero encounters.

**Doctor access** requires an appointment or encounter with that patient,
unless `clinic_settings.doctors_see_all_records` is on. Verified: with it
off each doctor sees only their own encounters; with it on, all.

**`anon` has no grant on anything**, re-revoked at the end of every
migration so a new table can never leak by omission.

**No DELETE policies** on medical data. Soft delete via `deleted_at`.

**Audit log is append-only** — admin SELECT policy, no other policies, fed
by a `security definer` trigger. Note it stores PHI in `old_data`/`new_data`.

## Money

USD is the functional currency; every amount is stored in USD. LBP is
presentation only. Each invoice and payment captures the FX rate in force
at that moment, so an old receipt reprints at the rate it was issued at
rather than today's. Payment methods include OMT and Whish.

`invoices.paid_usd` and `status` are maintained by a trigger on
`payments`. Verified: $30 against a $50 invoice → `partially_paid`;
an LBP payment worth $20 on top → `paid`.

## Running the tests

```bash
psql "$CONN" -f supabase_stub.sql     # local Postgres only, never Supabase
for f in migrations/*.sql; do psql "$CONN" -f "$f"; done
psql "$CONN" -f rls_test.sql
```

Every assertion should print `BLOCKED as expected`. Any line containing
`SECURITY HOLE` is a failure. Re-run this whenever you add a table.

## Known gaps

- No pharmacy inventory, patient portal, or telemedicine — deliberate.
- Lab results reference Supabase Storage paths; bucket policies are not
  in this schema and need their own RLS.
- Nurse access is time-boxed to patients with an appointment in the last
  24h. Widen if your clinics do longer follow-up cycles.
- No break-glass emergency access path. Worth adding, with its own audit
  action, before you sell to anyone doing urgent care.
