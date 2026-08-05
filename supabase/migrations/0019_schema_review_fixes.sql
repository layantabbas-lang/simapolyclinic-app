-- =============================================================
-- 0019_schema_review_fixes.sql
-- Four problems found reviewing the live schema against the app.
--
--   1. note_templates was never created, but three code paths query it
--      -- the whole Template Manager fails on open, and
--      visit_notes.template_id pointed at nothing.
--   2. visit_notes.location_id was integer while doctor_locations.id is
--      uuid, with no FK. Picking a location silently saved nothing.
--   3. Two people could hold the same appointment slot.
--   4. visit_notes.follow_up_date was text, so follow-ups can't be
--      sorted or filtered as dates.
--
-- Safe to re-run.
-- =============================================================

begin;

-- -------------------------------------------------------------
-- 1. Note templates
--
-- id is uuid, not the client-generated "custom-temp-<timestamp>" text
-- the app was sending: visit_notes.template_id is uuid, and a real
-- foreign key between them is only possible if the types match. The
-- app is updated to let the database mint the id.
--
-- created_by references staff(id) like every other authored row here,
-- not auth.users -- see the staffId note in src/types.ts.
-- -------------------------------------------------------------
create table if not exists public.note_templates (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  -- The app encodes "Custom|<Category>|<Icon>" in here. Kept as free
  -- text rather than split into columns so the existing template
  -- picker keeps working unchanged.
  category   text,
  content    text not null,
  created_by uuid references public.staff (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists note_templates_title_idx   on public.note_templates (title);
create index if not exists note_templates_author_idx  on public.note_templates (created_by);

drop trigger if exists note_templates_set_updated_at on public.note_templates;
create trigger note_templates_set_updated_at
  before update on public.note_templates
  for each row execute function app.set_updated_at();

alter table public.note_templates enable row level security;

-- Templates are a shared clinic asset: any staff member can use one.
drop policy if exists note_templates_select on public.note_templates;
create policy note_templates_select on public.note_templates
  for select to authenticated
  using (app.is_staff());

drop policy if exists note_templates_insert on public.note_templates;
create policy note_templates_insert on public.note_templates
  for insert to authenticated
  with check (app.has_role('owner', 'admin', 'doctor', 'nurse'));

-- Only the author or an admin may change or remove one, so a shared
-- template can't be quietly rewritten out from under whoever wrote it.
drop policy if exists note_templates_update on public.note_templates;
create policy note_templates_update on public.note_templates
  for update to authenticated
  using (app.is_admin() or created_by = app.staff_id())
  with check (app.is_admin() or created_by = app.staff_id());

drop policy if exists note_templates_delete on public.note_templates;
create policy note_templates_delete on public.note_templates
  for delete to authenticated
  using (app.is_admin() or created_by = app.staff_id());

grant select, insert, update, delete on public.note_templates to authenticated;

-- Now that the table exists, template_id can actually reference it.
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'visit_notes_template_id_fkey'
      and conrelid = 'public.visit_notes'::regclass
  ) then
    -- Clear anything pointing at a template that never existed.
    update public.visit_notes set template_id = null where template_id is not null;
    alter table public.visit_notes
      add constraint visit_notes_template_id_fkey
      foreign key (template_id) references public.note_templates (id) on delete set null;
  end if;
end $$;

-- -------------------------------------------------------------
-- 2. Note location: integer -> uuid, and a real foreign key.
--
-- Any existing values are meaningless -- they were integers that could
-- never have matched a uuid location -- so they're dropped rather than
-- guessed at.
-- -------------------------------------------------------------
do $$
declare
  v_type text;
begin
  select data_type into v_type
  from information_schema.columns
  where table_schema = 'public' and table_name = 'visit_notes' and column_name = 'location_id';

  if v_type = 'integer' then
    alter table public.visit_notes alter column location_id drop default;
    alter table public.visit_notes
      alter column location_id type uuid using null::uuid;
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'visit_notes_location_id_fkey'
      and conrelid = 'public.visit_notes'::regclass
  ) then
    alter table public.visit_notes
      add constraint visit_notes_location_id_fkey
      foreign key (location_id) references public.doctor_locations (id) on delete set null;
  end if;
end $$;

-- -------------------------------------------------------------
-- 3. One pending request per doctor per slot.
--
-- The booking endpoint checks availability and then inserts, so two
-- submissions landing together could both pass the check. The real
-- calendar was already protected by appointments_no_overlap; this
-- stops the duplicate reaching the queue, where it would only surface
-- as a confusing error when staff confirmed the second one.
-- -------------------------------------------------------------
create unique index if not exists appointment_requests_no_double_pending
  on public.appointment_requests (doctor_id, requested_at)
  where status = 'pending';

-- -------------------------------------------------------------
-- 4. follow_up_date: text -> date.
--
-- Only values already in yyyy-mm-dd survive; anything else becomes
-- null rather than failing the migration or silently misreading a
-- dd/mm/yyyy string as a different day.
-- -------------------------------------------------------------
do $$
declare
  v_type text;
begin
  select data_type into v_type
  from information_schema.columns
  where table_schema = 'public' and table_name = 'visit_notes' and column_name = 'follow_up_date';

  if v_type = 'text' then
    alter table public.visit_notes
      alter column follow_up_date type date
      using case
        when follow_up_date ~ '^\d{4}-\d{2}-\d{2}$' then follow_up_date::date
        else null
      end;
  end if;
end $$;

revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

insert into app.schema_migrations (version, name)
values ('0019', 'schema_review_fixes')
on conflict (version) do nothing;

commit;
