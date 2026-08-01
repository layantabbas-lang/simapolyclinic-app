# =============================================================
# run_migrations.ps1
#
# Applies pending migrations to one clinic database, or to every
# connection string listed in clinics.txt.
#
#   .\run_migrations.ps1 -Conn "postgresql://postgres:pw@db.xxx.supabase.co:5432/postgres"
#   .\run_migrations.ps1 -All
#
# Requires psql on PATH. If you installed Supabase CLI you already
# have it; otherwise install the PostgreSQL client tools.
#
# Migrations are idempotent, so re-running is harmless. The ledger
# in app.schema_migrations is still checked first so you can see at
# a glance what each clinic is on.
# =============================================================
[CmdletBinding(DefaultParameterSetName = 'Single')]
param(
    [Parameter(ParameterSetName = 'Single', Mandatory = $true)]
    [string]$Conn,

    [Parameter(ParameterSetName = 'All', Mandatory = $true)]
    [switch]$All,

    [string]$ClinicsFile = "$PSScriptRoot\clinics.txt"
)

$ErrorActionPreference = 'Stop'
$MigrationsDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'supabase\migrations'

if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
    throw "psql not found on PATH. Install the PostgreSQL client tools first."
}

function Invoke-Migrations {
    param([string]$ConnectionString)

    $label = ($ConnectionString -split '@')[-1] -split ':' | Select-Object -First 1
    Write-Host "=== $label ===" -ForegroundColor Cyan

    # Bootstrap the ledger so the query below never fails on a fresh DB.
    $bootstrap = @"
create schema if not exists app;
create table if not exists app.schema_migrations (
  version text primary key, name text not null,
  applied_at timestamptz not null default now());
"@
    psql $ConnectionString -v ON_ERROR_STOP=1 -q -c $bootstrap | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not reach $label" }

    $applied = @(psql $ConnectionString -At -c "select version from app.schema_migrations")

    Get-ChildItem -Path $MigrationsDir -Filter '*.sql' | Sort-Object Name | ForEach-Object {
        $version = ($_.Name -split '_')[0]

        if ($applied -contains $version) {
            Write-Host "  skip    $($_.Name)" -ForegroundColor DarkGray
            return
        }

        Write-Host "  apply   $($_.Name)" -ForegroundColor Yellow
        psql $ConnectionString -v ON_ERROR_STOP=1 -q -f $_.FullName
        if ($LASTEXITCODE -ne 0) { throw "Migration failed: $($_.Name)" }
    }

    # Fail loudly if any table shipped without RLS.
    $unprotected = psql $ConnectionString -At -c @"
select count(*) from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname='public' and c.relkind='r' and not c.relrowsecurity
"@

    if ($unprotected -ne '0') {
        throw "$unprotected table(s) in public have RLS disabled"
    }

    Write-Host "  ok" -ForegroundColor Green
}

if ($All) {
    if (-not (Test-Path $ClinicsFile)) { throw "Not found: $ClinicsFile" }
    Get-Content $ClinicsFile |
        Where-Object { $_.Trim() -and -not $_.StartsWith('#') } |
        ForEach-Object { Invoke-Migrations -ConnectionString $_.Trim() }
} else {
    Invoke-Migrations -ConnectionString $Conn
}
