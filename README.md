# Polyclinic App

Multi-clinic SaaS for Lebanese polyclinics. One Supabase project per
clinic, so the database itself is the tenant boundary.

Located at `C:\Maleks System\polyclinic app`.

## Current state

The database layer is complete and tested. The application layer is not
started — it's waiting on the SIMA reference files so the interface
matches rather than diverges.

```
polyclinic app/
├── supabase/
│   ├── migrations/       8 migrations, tested on PostgreSQL 16
│   ├── seed_new_clinic.sql
│   ├── rls_test.sql      security regression suite
│   └── supabase_stub.sql local testing only, never run on Supabase
├── scripts/
│   ├── run_migrations.ps1   Windows
│   ├── run_migrations.sh    WSL / Git Bash / CI
│   └── clinics.example.txt
├── docs/
│   └── database.md       schema and security model
├── .env.example
└── .gitignore
```

## Setup

```powershell
cd "C:\Maleks System\polyclinic app"
git init
copy .env.example .env
```

Requires `psql` on PATH. The Supabase CLI bundles it; otherwise install
the PostgreSQL client tools.

## Adding a clinic

```powershell
.\scripts\run_migrations.ps1 -Conn "postgresql://postgres:PW@db.xxx.supabase.co:5432/postgres"
```

Then edit `supabase/seed_new_clinic.sql` with the clinic's details and
run it once in the Supabase SQL editor. The owner signs up with the
seeded email and gets linked automatically.

For a fleet, copy `scripts/clinics.example.txt` to `scripts/clinics.txt`,
add one connection string per line, and run with `-All`. That file is
gitignored because it holds database passwords.

## The one rule

`SUPABASE_SERVICE_ROLE_KEY` bypasses RLS completely. If it ever reaches
the browser, every policy in `supabase/migrations` stops mattering and
any user can read every patient record in that clinic. Server-side only.

## Next

Waiting on SIMA files to build the app layer:

- Tailwind config / theme / global CSS
- App shell (sidebar, top nav, layout wrapper)
- Three representative pages: a list, a form, a detail view
- Shared UI components
- One example of the data-fetching pattern
- Existing DDL for patients / appointments / invoices
- Print templates: invoice, prescription, lab report
- i18n files, if any

The first three matter most. With the DDL I can also say where SIMA's
naming carries over and where a clean break is cheaper.

See `docs/database.md` for the schema and security model.
