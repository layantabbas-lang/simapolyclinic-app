import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle, Calendar, Check, ChevronLeft, ChevronRight, Clock,
  MapPin, Plus, Search, UserRound, X, XCircle,
} from "lucide-react";
import { supabase } from "../supabaseClient";
import { UserSession } from "../types";

interface AppointmentRow {
  id: string;
  patient_id: string;
  doctor_id: string;
  room_id: string | null;
  starts_at: string;
  ends_at: string;
  status: "scheduled" | "confirmed" | "arrived" | "in_progress" | "completed" | "no_show" | "cancelled";
  reason: string | null;
  is_walk_in: boolean;
  patients?: { id: string; first_name: string; last_name: string; mrn: string; phone?: string };
  staff?: { id: string; full_name: string };
  rooms?: { id: string; name: string };
}

interface DoctorRow { id: string; full_name: string; roles: string[]; }
interface RoomRow { id: string; name: string; }
// `id` is the real patients.id uuid from a real Supabase project — absent
// in mock mode, where patient_id falls back to the mrn (see supabaseClient.ts).
interface PatientOption { id?: string; first_name: string; surname: string; mrn: number; phone_number: string; }

const STATUS_STYLES: Record<AppointmentRow["status"], { bg: string; text: string; label: string }> = {
  scheduled:   { bg: "#f4f6f9", text: "#5d6b7c", label: "Scheduled" },
  confirmed:   { bg: "#dee9f3", text: "#2a5178", label: "Confirmed" },
  arrived:     { bg: "#faf3e3", text: "#75581a", label: "Arrived" },
  in_progress: { bg: "#c2d5e7", text: "#12233a", label: "In Progress" },
  completed:   { bg: "#d5e8de", text: "#2c6349", label: "Completed" },
  no_show:     { bg: "#f3dbdb", text: "#96322f", label: "No-Show" },
  cancelled:   { bg: "#dee4eb", text: "#71808f", label: "Cancelled" },
};

const DURATIONS = [15, 20, 30, 45, 60];

// Local date components, not .toISOString() (UTC) — a UTC slice can land
// on the wrong calendar day depending on the browser's timezone offset,
// silently mismatching whatever day is actually selected.
const toDateInputValue = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const formatTime = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const formatDayHeading = (d: Date) => d.toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
const isSameDay = (iso: string, d: Date) => new Date(iso).toDateString() === d.toDateString();

export default function Appointments({ currentUser }: { currentUser?: UserSession | null }) {
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [doctors, setDoctors] = useState<DoctorRow[]>([]);
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [doctorFilter, setDoctorFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);

  const fetchLookups = async () => {
    try {
      const { data: staffData } = await supabase.from("staff").select("id, full_name, roles").eq("is_active", true);
      setDoctors((staffData || []).filter((s: DoctorRow) => (s.roles || []).includes("doctor")));
      const { data: roomData } = await supabase.from("rooms").select("id, name").eq("is_active", true);
      setRooms(roomData || []);
    } catch (err) {
      console.error("Could not load doctors/rooms:", err);
    }
  };

  const fetchAppointments = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      // Fetched broad and filtered client-side (by day, doctor, status) —
      // same pattern the rest of this app already uses (see
      // docs/sima-interface.md §5/§6) rather than a server-side date-range
      // query, since a full clinic's appointment volume is small enough
      // that this stays cheap.
      const { data, error } = await supabase
        .from("appointments")
        // staff!doctor_id, not a bare staff(...): appointments has two FKs to
        // staff (doctor_id and created_by), so an unqualified embed is
        // ambiguous and PostgREST rejects the whole query with PGRST201 --
        // which showed up as an empty appointment book.
        .select("*, patients(id, first_name, last_name, mrn, phone), staff!doctor_id(id, full_name), rooms(id, name)")
        .order("starts_at");
      if (error) throw error;
      setAppointments(data || []);
    } catch (err: any) {
      // Log and surface the actual message. "Could not load the appointment
      // book" plus an [object Object] in the console says nothing about
      // whether it's permissions, a bad query, or the network.
      console.error("Could not load appointments:", err?.message || err, err);
      setErrorMsg(`Could not load the appointment book: ${err?.message || "unknown error"}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLookups();
    fetchAppointments();
  }, []);

  const dayAppointments = useMemo(() => {
    return appointments
      .filter((a) => isSameDay(a.starts_at, selectedDate))
      .filter((a) => doctorFilter === "all" || a.doctor_id === doctorFilter)
      .filter((a) => statusFilter === "all" || a.status === statusFilter)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  }, [appointments, selectedDate, doctorFilter, statusFilter]);

  const shiftDay = (delta: number) => {
    setSelectedDate((prev) => {
      const next = new Date(prev);
      next.setDate(next.getDate() + delta);
      return next;
    });
  };

  const updateStatus = async (appt: AppointmentRow, status: AppointmentRow["status"]) => {
    try {
      const patch: Record<string, any> = { status };
      if (status === "arrived") patch.arrived_at = new Date().toISOString();
      const { error } = await supabase.from("appointments").update(patch).eq("id", appt.id);
      if (error) throw error;
      fetchAppointments();
    } catch (err) {
      console.error("Could not update appointment status:", err);
    }
  };

  return (
    <div className="p-4 flex flex-col gap-3 max-w-5xl mx-auto w-full">
      {/* Command ribbon — matches the Patients workspace ribbon styling */}
      <div className="bg-[#2a5178] text-white px-4 py-2.5 rounded-lg flex items-center justify-between flex-wrap gap-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-extrabold text-[#edf3f8] uppercase tracking-wider text-[11px] flex items-center gap-1.5">
            <Calendar size={13} className="text-[#c2d5e7]" /> Appointment Book
          </span>
          <div className="flex items-center gap-1 ml-2">
            <button onClick={() => shiftDay(-1)} className="p-1 bg-white/10 hover:bg-white/20 border border-white/20 rounded cursor-pointer">
              <ChevronLeft size={13} />
            </button>
            <span className="font-bold text-[11px] px-1 min-w-[190px] text-center">{formatDayHeading(selectedDate)}</span>
            <button onClick={() => shiftDay(1)} className="p-1 bg-white/10 hover:bg-white/20 border border-white/20 rounded cursor-pointer">
              <ChevronRight size={13} />
            </button>
          </div>
          <button
            onClick={() => setSelectedDate(new Date())}
            className="text-[10px] font-bold bg-white/10 hover:bg-white/20 border border-white/20 rounded px-2 py-1 cursor-pointer"
          >
            Today
          </button>
        </div>
        <button
          onClick={() => setIsNewModalOpen(true)}
          className="bg-[var(--theme-accent)] hover:bg-teal-500 text-white px-2.5 py-1.5 rounded text-[10px] font-bold flex items-center gap-1.5 cursor-pointer transition-all"
        >
          <Plus size={12} /> New Appointment
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={doctorFilter}
          onChange={(e) => setDoctorFilter(e.target.value)}
          className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white"
        >
          <option value="all">All Doctors</option>
          {doctors.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white"
        >
          <option value="all">All Statuses</option>
          {Object.entries(STATUS_STYLES).map(([key, s]) => <option key={key} value={key}>{s.label}</option>)}
        </select>
        <span className="text-[11px] text-slate-400 ml-auto">{dayAppointments.length} appointment{dayAppointments.length === 1 ? "" : "s"}</span>
      </div>

      {/* Day schedule */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-10 text-center text-slate-400 text-xs">Loading appointments...</div>
        ) : errorMsg ? (
          <div className="p-10 text-center text-red-500 text-xs flex flex-col items-center gap-1.5">
            <AlertCircle size={18} /> {errorMsg}
          </div>
        ) : dayAppointments.length === 0 ? (
          <div className="p-10 text-center text-slate-400 text-xs">No appointments booked for this day.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {dayAppointments.map((appt) => {
              const style = STATUS_STYLES[appt.status];
              return (
                <div key={appt.id} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                  <div className="w-24 shrink-0 flex items-center gap-1.5 text-slate-600 font-mono text-[11px]">
                    <Clock size={11} className="text-slate-400" />
                    {formatTime(appt.starts_at)}–{formatTime(appt.ends_at)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-bold text-xs text-slate-800 flex items-center gap-1">
                        <UserRound size={12} className="text-[var(--theme-accent)]" />
                        {appt.patients ? `${appt.patients.first_name} ${appt.patients.last_name}` : "Unknown patient"}
                      </span>
                      {appt.patients?.mrn && <span className="text-[10px] text-slate-400 font-mono">MRN {appt.patients.mrn}</span>}
                      {appt.is_walk_in && <span className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold uppercase">Walk-in</span>}
                    </div>
                    <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5 flex-wrap">
                      <span>{appt.staff?.full_name || "Unassigned"}</span>
                      {appt.rooms && <span className="flex items-center gap-0.5"><MapPin size={10} />{appt.rooms.name}</span>}
                      {appt.reason && <span className="truncate max-w-[220px]">— {appt.reason}</span>}
                    </div>
                  </div>
                  <span
                    className="text-[10px] font-bold px-2 py-1 rounded shrink-0"
                    style={{ background: style.bg, color: style.text }}
                  >
                    {style.label}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    {appt.status === "scheduled" && (
                      <>
                        <button onClick={() => updateStatus(appt, "confirmed")} title="Confirm" className="p-1.5 rounded hover:bg-slate-100 text-[var(--theme-accent)]"><Check size={13} /></button>
                        <button onClick={() => updateStatus(appt, "cancelled")} title="Cancel" className="p-1.5 rounded hover:bg-slate-100 text-red-400"><X size={13} /></button>
                      </>
                    )}
                    {appt.status === "confirmed" && (
                      <>
                        <button onClick={() => updateStatus(appt, "arrived")} title="Mark Arrived" className="p-1.5 rounded hover:bg-slate-100 text-[var(--theme-accent)]"><Check size={13} /></button>
                        <button onClick={() => updateStatus(appt, "no_show")} title="No-Show" className="p-1.5 rounded hover:bg-slate-100 text-red-400"><XCircle size={13} /></button>
                      </>
                    )}
                    {appt.status === "arrived" && (
                      <button onClick={() => updateStatus(appt, "in_progress")} title="Start Visit" className="text-[10px] font-bold px-2 py-1 rounded bg-[var(--theme-accent)] text-white">Start</button>
                    )}
                    {appt.status === "in_progress" && (
                      <button onClick={() => updateStatus(appt, "completed")} title="Complete" className="text-[10px] font-bold px-2 py-1 rounded bg-emerald-600 text-white">Complete</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {isNewModalOpen && (
        <NewAppointmentModal
          defaultDate={selectedDate}
          doctors={doctors}
          rooms={rooms}
          currentUser={currentUser}
          onClose={() => setIsNewModalOpen(false)}
          onCreated={() => { setIsNewModalOpen(false); fetchAppointments(); }}
        />
      )}
    </div>
  );
}

function NewAppointmentModal({
  defaultDate, doctors, rooms, onClose, onCreated,
}: {
  defaultDate: Date;
  doctors: DoctorRow[];
  rooms: RoomRow[];
  currentUser?: UserSession | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [patientSearch, setPatientSearch] = useState("");
  const [patientOptions, setPatientOptions] = useState<PatientOption[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientOption | null>(null);
  const [doctorId, setDoctorId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [date, setDate] = useState(toDateInputValue(defaultDate));
  const [startTime, setStartTime] = useState("09:00");
  const [duration, setDuration] = useState(20);
  const [reason, setReason] = useState("");
  const [isWalkIn, setIsWalkIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("patients").select("*");
      setPatientOptions(data || []);
    })();
  }, []);

  const filteredPatients = useMemo(() => {
    const q = patientSearch.trim().toLowerCase();
    if (!q) return patientOptions.slice(0, 8);
    return patientOptions.filter((p) => {
      const name = `${p.first_name} ${p.surname}`.toLowerCase();
      return name.includes(q) || String(p.mrn).includes(q) || (p.phone_number || "").includes(q);
    }).slice(0, 8);
  }, [patientOptions, patientSearch]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!selectedPatient) { setError("Select a patient first."); return; }
    if (!doctorId) { setError("Select a doctor."); return; }
    if (!date || !startTime) { setError("Set a date and start time."); return; }

    const [hh, mm] = startTime.split(":").map(Number);
    const starts = new Date(`${date}T00:00:00`);
    starts.setHours(hh, mm, 0, 0);
    const ends = new Date(starts.getTime() + duration * 60000);

    setIsSaving(true);
    try {
      const { error: insertError } = await supabase.from("appointments").insert([{
        patient_id: selectedPatient.id || String(selectedPatient.mrn),
        doctor_id: doctorId,
        room_id: roomId || null,
        starts_at: starts.toISOString(),
        ends_at: ends.toISOString(),
        status: "scheduled",
        reason: reason.trim() || null,
        is_walk_in: isWalkIn,
      }]);
      if (insertError) throw insertError;
      onCreated();
    } catch (err: any) {
      setError(err.message || "Could not book the appointment.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-[99999] overflow-y-auto">
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-xl shadow-2xl border w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150 my-8"
      >
        <div className="px-5 py-4 border-b bg-slate-50 flex justify-between items-center">
          <span className="font-bold text-xs text-slate-800 uppercase tracking-wide flex items-center gap-2">
            <Calendar size={14} className="text-[var(--theme-accent)]" /> New Appointment
          </span>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
        </div>

        <div className="p-5 flex flex-col gap-3 text-xs max-h-[75vh] overflow-y-auto">
          {error && (
            <div className="bg-red-50 border border-red-100 text-red-600 text-[10px] font-semibold px-2.5 py-1.5 rounded">{error}</div>
          )}

          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Patient</label>
            {selectedPatient ? (
              <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
                <span className="font-bold text-slate-800">{selectedPatient.first_name} {selectedPatient.surname}</span>
                <button type="button" onClick={() => setSelectedPatient(null)} className="text-[10px] font-bold text-[var(--theme-accent)]">Change</button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="text"
                    value={patientSearch}
                    onChange={(e) => setPatientSearch(e.target.value)}
                    placeholder="Search by name, MRN, or phone..."
                    className="w-full pl-8.5 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-teal-500"
                  />
                </div>
                <div className="max-h-32 overflow-y-auto border border-slate-100 rounded-lg mt-1.5 divide-y divide-slate-100">
                  {filteredPatients.length === 0 ? (
                    <div className="p-2.5 text-center text-slate-400 text-[11px]">No matching patient.</div>
                  ) : (
                    filteredPatients.map((p) => (
                      <button
                        key={p.mrn}
                        type="button"
                        onClick={() => setSelectedPatient(p)}
                        className="w-full text-left p-2 hover:bg-slate-50 flex items-center justify-between gap-2"
                      >
                        <span className="font-semibold text-slate-700">{p.first_name} {p.surname}</span>
                        <span className="text-[10px] text-slate-400 font-mono">MRN {p.mrn}</span>
                      </button>
                    ))
                  )}
                </div>
              </>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Doctor</label>
              <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2">
                <option value="">Select...</option>
                {doctors.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Room</label>
              <select value={roomId} onChange={(e) => setRoomId(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2">
                <option value="">Unassigned</option>
                {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Date</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2" />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Start</label>
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2" />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Duration</label>
            <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2">
              {DURATIONS.map((d) => <option key={d} value={d}>{d} minutes</option>)}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Reason (optional)</label>
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Annual physical, follow-up..."
              className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:bg-white focus:ring-1 focus:ring-teal-500"
            />
          </div>

          <label className="flex items-center gap-2 text-slate-600">
            <input type="checkbox" checked={isWalkIn} onChange={(e) => setIsWalkIn(e.target.checked)} />
            Walk-in (no prior booking)
          </label>

          <button
            type="submit"
            disabled={isSaving}
            className="mt-1 bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-dark)] disabled:opacity-60 text-white font-bold px-4 py-2 rounded-lg text-xs self-start flex items-center gap-1.5"
          >
            <Check size={12} /> {isSaving ? "Booking..." : "Book Appointment"}
          </button>
        </div>
      </form>
    </div>
  );
}
