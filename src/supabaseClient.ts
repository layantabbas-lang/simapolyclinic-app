import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL;
const supabaseAnonKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY;

export const isConfigured = !!supabaseUrl && !!supabaseAnonKey;

// Real client, initialized safely only if the parameters exist
const realClient = isConfigured 
  ? createClient(supabaseUrl, supabaseAnonKey) 
  : null;

// Seed data so the interface has something to show in mock mode, before a
// real Supabase project exists. Shaped to match supabase/migrations/0003_patients.sql
// (and SIMA's own patients columns, which the same fetchPatients() mapping
// code reads defensively either way).
// No separate `id` field on purpose — PatientsDirectory.tsx (carried over
// from SIMA) displays the MRN badge via formatMRNDisplay(selectedPatient.id),
// and its own mapping falls back to `id = String(mrn)` when no id column
// exists. Adding a distinct mock id would show that id instead of the MRN.
const MOCK_PATIENTS_TABLE = [
  { mrn: 100234, first_name: "Layan", father_name: "Tarek", surname: "Abbas", birth_date: "1994-03-12", gender: "Female", phone_number: "+961 3 112 233", email: "layan.abbas@example.com", insurance_provider: "NSSF" },
  { mrn: 100235, first_name: "Karim", father_name: "Elie", surname: "Haddad", birth_date: "1988-07-02", gender: "Male", phone_number: "+961 70 445 566", email: "karim.haddad@example.com", insurance_provider: "Bankers Assurance" },
  { mrn: 100236, first_name: "Maya", father_name: "Georges", surname: "Khalil", birth_date: "2001-11-25", gender: "Female", phone_number: "+961 76 998 112", email: "maya.khalil@example.com", insurance_provider: null },
  { mrn: 100237, first_name: "Fadi", father_name: "Nabil", surname: "Nassar", birth_date: "1975-01-30", gender: "Male", phone_number: "+961 3 220 019", email: "fadi.nassar@example.com", insurance_provider: "NSSF" },
  { mrn: 100238, first_name: "Rana", father_name: "Wissam", surname: "Saade", birth_date: "1990-09-08", gender: "Female", phone_number: "+961 71 334 452", email: "rana.saade@example.com", insurance_provider: "MedNet" },
  { mrn: 100239, first_name: "Tarek", father_name: "Antoine", surname: "Yazbek", birth_date: "1966-05-19", gender: "Male", phone_number: "+961 3 887 662", email: "tarek.yazbek@example.com", insurance_provider: null },
];

// Shaped to match supabase/migrations/0002_staff_and_roles.sql (staff.roles
// is an array) and 0004_scheduling.sql (rooms).
const MOCK_STAFF_TABLE = [
  { id: "s-1", full_name: "Dr. Rima Sarkis", roles: ["doctor", "owner"], specialty: "Internal Medicine", is_active: true },
  { id: "s-2", full_name: "Dr. Walid Fares", roles: ["doctor"], specialty: "Pediatrics", is_active: true },
  { id: "s-3", full_name: "Nadine Chami", roles: ["receptionist"], specialty: null, is_active: true },
];

const MOCK_ROOMS_TABLE = [
  { id: "r-1", name: "Room 1", floor: "Ground", is_active: true },
  { id: "r-2", name: "Room 2", floor: "Ground", is_active: true },
];

// Appointments carry their joined patient/doctor/room inline, the same
// shape a real `.select("*, patients(...), staff(...), rooms(...)")` would
// return — the mock has no real join engine, so the relation is baked into
// the seed row instead. Times are relative to "today" so the default day
// view always has something to show, whatever day this is opened.
const todayAt = (hour: number, minute: number) => {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};
const MOCK_APPOINTMENTS_TABLE = [
  {
    id: "a-1", patient_id: "100234", doctor_id: "s-1", room_id: "r-1",
    starts_at: todayAt(9, 0), ends_at: todayAt(9, 20), status: "confirmed",
    reason: "Follow-up — blood pressure check", notes: null, is_walk_in: false,
    patients: { id: "100234", first_name: "Layan", last_name: "Abbas", mrn: "P100234", phone: "+961 3 112 233" },
    staff: { id: "s-1", full_name: "Dr. Rima Sarkis" },
    rooms: { id: "r-1", name: "Room 1" },
  },
  {
    id: "a-2", patient_id: "100235", doctor_id: "s-1", room_id: "r-1",
    starts_at: todayAt(9, 30), ends_at: todayAt(9, 50), status: "scheduled",
    reason: "Annual physical", notes: null, is_walk_in: false,
    patients: { id: "100235", first_name: "Karim", last_name: "Haddad", mrn: "P100235", phone: "+961 70 445 566" },
    staff: { id: "s-1", full_name: "Dr. Rima Sarkis" },
    rooms: { id: "r-1", name: "Room 1" },
  },
  {
    id: "a-3", patient_id: "100237", doctor_id: "s-2", room_id: "r-2",
    starts_at: todayAt(10, 0), ends_at: todayAt(10, 20), status: "arrived",
    reason: "Vaccination", notes: null, is_walk_in: true,
    patients: { id: "100237", first_name: "Fadi", last_name: "Nassar", mrn: "P100237", phone: "+961 3 220 019" },
    staff: { id: "s-2", full_name: "Dr. Walid Fares" },
    rooms: { id: "r-2", name: "Room 2" },
  },
];

// Real supabase-js query builders are chainable to arbitrary depth
// (.select().order().eq().limit(), .insert().select().single(), etc.) and
// only resolve once awaited. A flat mock that only implements one or two
// methods breaks the moment real SIMA code chains a method our mock
// doesn't have ("...select(...).order is not a function"). So instead:
// any property access that isn't `then` returns a function that re-wraps
// the same eventual result, so any chain of any length just works, and
// `await` resolves it via `then`.
function makeChainable(result: { data: any; error: any }): any {
  return new Proxy(
    { then: (resolve: any, reject?: any) => Promise.resolve(result).then(resolve, reject) },
    {
      get(target, prop) {
        if (prop === "then") return target.then;
        // .single()/.maybeSingle() unwrap an array to its first row (or
        // null) instead of returning the array itself — real supabase-js
        // does the same, and skipping it means `data` stays an array,
        // which is truthy even when empty ([] || null -> [], not null).
        if (prop === "single" || prop === "maybeSingle") {
          return (..._args: any[]) =>
            makeChainable({
              data: Array.isArray(result.data) ? result.data[0] ?? null : result.data,
              error: result.error,
            });
        }
        return (..._args: any[]) => makeChainable(result);
      },
    }
  );
}

// Mock chain to support safe code execution if Supabase is not connected yet
const MOCK_TABLES: Record<string, any[]> = {
  patients: MOCK_PATIENTS_TABLE,
  staff: MOCK_STAFF_TABLE,
  rooms: MOCK_ROOMS_TABLE,
  appointments: MOCK_APPOINTMENTS_TABLE,
};

// Bakes the same {patients, staff, rooms} embed a real Supabase
// `.select("*, patients(...), staff(...), rooms(...)")` would return, so
// appointments created/updated in mock mode look identical to seeded ones.
function embedAppointmentJoins(row: any) {
  const patientRow = MOCK_PATIENTS_TABLE.find((p) => String(p.mrn) === String(row.patient_id));
  const staffRow = MOCK_STAFF_TABLE.find((s) => s.id === row.doctor_id);
  const roomRow = MOCK_ROOMS_TABLE.find((r) => r.id === row.room_id);
  if (patientRow) {
    row.patients = { id: String(patientRow.mrn), first_name: patientRow.first_name, last_name: patientRow.surname, mrn: `P${patientRow.mrn}`, phone: patientRow.phone_number };
  }
  if (staffRow) row.staff = { id: staffRow.id, full_name: staffRow.full_name };
  if (roomRow) row.rooms = { id: roomRow.id, name: roomRow.name };
  return row;
}

const createMockChain = (table?: string) => {
  const rows = (table && MOCK_TABLES[table]) || [];
  return {
    select: (_columns?: string) => makeChainable({ data: rows, error: null }),
    insert: (payload: any) => {
      console.warn("Supabase is not configured. Simulating data persistence locally. Payload:", payload);
      const mockData = Array.isArray(payload)
        ? payload.map((p, i) => ({ id: `mock-db-${Date.now()}-${i}`, ...p }))
        : [{ id: `mock-db-${Date.now()}`, ...payload }];
      if (table === "appointments") {
        mockData.forEach((row: any) => {
          embedAppointmentJoins(row);
          MOCK_APPOINTMENTS_TABLE.push(row);
        });
      }
      return makeChainable({ data: mockData, error: null });
    },
    // Only .eq(column, value) actually mutates the seed data — enough for
    // the status-update actions (mark arrived/completed/cancel) the
    // Appointments page uses. Anything chained past .eq() (e.g. a second
    // .eq()) is a no-op filter, same generic passthrough as everywhere else.
    update: (payload: any) => {
      const chain: any = {
        eq: (column: string, value: any) => {
          const idx = rows.findIndex((r) => r[column] === value);
          if (idx !== -1) {
            Object.assign(rows[idx], payload);
            if (table === "appointments") embedAppointmentJoins(rows[idx]);
          }
          return makeChainable({ data: idx !== -1 ? [rows[idx]] : [], error: null });
        },
      };
      return new Proxy(chain, {
        get(target, prop) {
          if (prop in target) return target[prop];
          return (..._args: any[]) => makeChainable({ data: null, error: null });
        },
      });
    },
    delete: () => makeChainable({ data: null, error: null }),
    upsert: (payload: any) => makeChainable({ data: Array.isArray(payload) ? payload : [payload], error: null }),
  };
};

// Realtime subscriptions (supabase.channel(...).on(...).subscribe()) have
// nothing to connect to in mock mode — .on()/.subscribe() just return the
// same no-op channel object, and events never fire.
function createMockChannel() {
  const channel: any = {
    on: () => channel,
    subscribe: () => channel,
  };
  return channel;
}

export const supabase = isConfigured && realClient ? realClient : {
  from: (table: string) => {
    console.warn(`Supabase URL/Key is missing. Operations on table "${table}" are running in local-only mock sandbox mode.`);
    return createMockChain(table);
  },
  channel: (_name: string) => createMockChannel(),
  removeChannel: (_channel: any) => {},
} as any;

// fetch() wrapper that attaches the signed-in user's Supabase access token
// as a Bearer header. Server endpoints that handle PHI (e.g. /api/analyze)
// require it. Falls back to a plain fetch when no session is available.
export async function authedFetch(input: string, init: RequestInit = {}) {
  let token: string | undefined;
  try {
    const { data } = await (supabase as any).auth.getSession();
    token = data?.session?.access_token;
  } catch {
    // mock / unconfigured mode -- no auth token available
  }
  const headers = new Headers(init.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}
