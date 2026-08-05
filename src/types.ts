export interface Patient {
  mrn: number;
  firstName: string;
  surname: string;
  birthDate: string; // ISO yyyy-mm-dd
  gender: "Male" | "Female";
  phone: string;
  email: string;
  insuranceProvider: string;
}

export interface UserSession {
  // Supabase Auth user id (auth.users.id) -- matches staff.user_id, NOT
  // staff.id itself. Any FK reference to public.staff(id) elsewhere
  // (created_by, doctor_id, received_by, etc.) must use staffId below,
  // not this one -- they are two different columns/values.
  id?: string;
  // public.staff.id -- the actual row to use for any staff(id) foreign key.
  // Undefined if this account has no linked staff row yet (e.g. an
  // Auth user was created but never added to Staff, or not yet linked --
  // see 0008_provisioning.sql).
  staffId?: string;
  username: string;
  name: string;
  email: string;
  role: "admin" | "doctor" | "secretary";
}
