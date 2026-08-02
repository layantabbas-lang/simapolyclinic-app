import { isConfigured, supabase } from "./supabaseClient";
import { UserSession } from "./types";

// public.staff.roles is an array of staff_role; the UI (carried over from
// SIMA) only knows admin/doctor/secretary today, so this maps the DB's
// richer role set down to the closest UI-facing equivalent.
export function mapStaffRole(roles: string[] | null | undefined): UserSession["role"] {
  const list = roles || [];
  if (list.includes("owner") || list.includes("admin")) return "admin";
  if (list.includes("doctor") || list.includes("nurse")) return "doctor";
  return "secretary";
}

export async function buildSessionFromAuthUser(authUser: { id: string; email?: string | null }): Promise<UserSession> {
  const { data: staffRow } = await supabase
    .from("staff")
    .select("id, full_name, roles")
    .eq("user_id", authUser.id)
    .maybeSingle();

  return {
    id: authUser.id,
    username: authUser.email || "",
    name: staffRow?.full_name || authUser.email || "Staff",
    email: authUser.email || "",
    role: mapStaffRole(staffRow?.roles),
  };
}

// Restores a UserSession from an existing Supabase Auth session (e.g. on
// page refresh), so the app doesn't bounce back to the login screen just
// because our own React state never persisted — Supabase's own session
// (localStorage-backed) was there the whole time. Mock mode has nothing
// real to restore, so it always starts logged out.
export async function restoreSession(): Promise<UserSession | null> {
  if (!isConfigured) return null;
  const { data } = await supabase.auth.getSession();
  const authUser = data?.session?.user;
  if (!authUser) return null;
  return buildSessionFromAuthUser(authUser);
}
