-- =============================================================
-- 0008_provisioning.sql
-- Invite-only staff onboarding.
--
-- An admin creates the staff row first (with an email, no user_id).
-- When that person signs up, this trigger links their auth user to
-- the waiting row. If no row is waiting, they get an account with
-- zero roles and every policy denies them.
--
-- This is why no policy anywhere uses auth.jwt() claims: the client
-- controls sign-up metadata, but it does not control this table.
--
-- Safe to re-run.
-- =============================================================

begin;

create or replace function app.link_staff_on_signup()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.staff s
     set user_id = new.id,
         updated_at = now()
   -- citext must be schema-qualified: search_path is empty inside
   -- this function, so a bare type name will not resolve.
   where s.email = new.email::public.citext
     and s.user_id is null
     and s.is_active;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.link_staff_on_signup();

-- Convenience view for the app's "who am I" call.
create or replace view public.me
with (security_invoker = true)
as
  select s.id, s.full_name, s.full_name_ar, s.roles, s.specialty, s.is_active
  from public.staff s
  where s.user_id = (select auth.uid());

grant select on public.me to authenticated;

revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

insert into app.schema_migrations (version, name)
values ('0008', 'provisioning')
on conflict (version) do nothing;

commit;
