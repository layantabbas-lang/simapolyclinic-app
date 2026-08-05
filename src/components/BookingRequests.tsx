import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle, Check, CalendarClock, Inbox, Loader2, MessageCircle,
  Phone, Search, UserPlus, UserRound, X,
} from "lucide-react";
import { supabase } from "../supabaseClient";
import { UserSession } from "../types";
import { buildWhatsAppLink, fillTemplate, DEFAULT_WHATSAPP_TEMPLATE } from "../lib/whatsapp";

// Staff queue for patient-submitted appointment requests.
//
// A request is not a booking. Confirming one here is what creates the real
// appointments row -- and because the patient typed their own name, staff
// must match them to a chart (or register them) rather than trusting it.

interface RequestRow {
  id: string;
  full_name: string;
  phone: string;
  email: string | null;
  reason: string | null;
  requested_at: string;
  status: "pending" | "confirmed" | "declined" | "cancelled";
  doctor_id: string | null;
  patient_id: string | null;
  notified_at: string | null;
  created_at: string;
  staff?: { full_name: string } | null;
}

interface PatientLite { id: string; first_name: string; last_name: string; mrn: string; phone: string | null; }

// Clinic time, not the device's -- these hours end up in the message the
// patient is sent, so a staff phone on another timezone must not change them.
const formatSlot = (iso: string, tz?: string | null) =>
  new Date(iso).toLocaleString("en-GB", {
    weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    ...(tz ? { timeZone: tz } : {}),
  });

export default function BookingRequests({
  currentUser,
  onCountChange,
}: {
  currentUser?: UserSession | null;
  onCountChange?: (pending: number) => void;
}) {
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"pending" | "handled">("pending");
  const [busyId, setBusyId] = useState<string | null>(null);

  // Confirm flow
  const [confirming, setConfirming] = useState<RequestRow | null>(null);
  const [matches, setMatches] = useState<PatientLite[]>([]);
  const [matchSearch, setMatchSearch] = useState("");
  const [chosenPatient, setChosenPatient] = useState<PatientLite | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [clinic, setClinic] = useState<{ clinic_name: string; phone: string | null; address: string | null; whatsapp_template: string | null; default_country_code: string; default_slot_minutes: number; timezone: string | null } | null>(null);
  const [doctors, setDoctors] = useState<{ id: string; full_name: string }[]>([]);

  const fetchRows = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from("appointment_requests")
        .select("*, staff!doctor_id(full_name)")
        .order("requested_at", { ascending: true });
      if (err) throw err;
      const list = (data as any as RequestRow[]) || [];
      setRows(list);
      onCountChange?.(list.filter(r => r.status === "pending").length);
    } catch (err: any) {
      setError(err.message || "Could not load booking requests.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRows();
    (async () => {
      const { data: cs } = await supabase
        .from("clinic_settings")
        .select("clinic_name, phone, address, whatsapp_template, default_country_code, default_slot_minutes, timezone")
        .limit(1).maybeSingle();
      setClinic(cs as any);
      const { data: st } = await supabase
        .from("staff").select("id, full_name, roles").eq("is_active", true);
      setDoctors(((st as any[]) || []).filter(s => (s.roles || []).includes("doctor")));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pending = useMemo(() => rows.filter(r => r.status === "pending"), [rows]);
  const handled = useMemo(() => rows.filter(r => r.status !== "pending"), [rows]);

  // ── Confirm: find a matching chart first.
  const openConfirm = async (r: RequestRow) => {
    setConfirming(r);
    setChosenPatient(null);
    setConfirmError(null);
    setMatchSearch(r.full_name);
    await searchPatients(r.phone, r.full_name);
  };

  const searchPatients = async (phone: string, name: string) => {
    try {
      const digits = (phone || "").replace(/\D/g, "").replace(/^0+/, "").slice(-8);
      const terms: string[] = [];
      if (digits) terms.push(`phone.ilike.%${digits}%`);
      const first = (name || "").trim().split(/\s+/)[0];
      const last = (name || "").trim().split(/\s+/).slice(-1)[0];
      if (first) terms.push(`first_name.ilike.%${first}%`);
      if (last) terms.push(`last_name.ilike.%${last}%`);
      if (terms.length === 0) { setMatches([]); return; }
      const { data } = await supabase
        .from("patients")
        .select("id, first_name, last_name, mrn, phone")
        .or(terms.join(","))
        .limit(10);
      setMatches((data as PatientLite[]) || []);
    } catch {
      setMatches([]);
    }
  };

  const handleConfirm = async () => {
    if (!confirming) return;
    if (!chosenPatient) { setConfirmError("Pick the patient's chart, or register them first."); return; }
    if (!confirming.doctor_id) { setConfirmError("This request has no doctor attached."); return; }
    if (!currentUser?.staffId) { setConfirmError("Your account isn't linked to a staff record."); return; }

    setSaving(true);
    setConfirmError(null);
    try {
      // Must match the slot length the patient was offered. If this is
      // shorter than the slot, the tail of a real appointment looks free
      // and someone else can book over it.
      const slotMinutes = clinic?.default_slot_minutes || 30;
      const start = new Date(confirming.requested_at);
      const end = new Date(start.getTime() + slotMinutes * 60000);

      const { data: appt, error: apptErr } = await supabase
        .from("appointments")
        .insert([{
          patient_id: chosenPatient.id,
          doctor_id: confirming.doctor_id,
          starts_at: start.toISOString(),
          ends_at: end.toISOString(),
          status: "scheduled",
          reason: confirming.reason,
          created_by: currentUser.staffId,
        }])
        .select()
        .single();
      if (apptErr) throw apptErr;

      const { error: updErr } = await supabase
        .from("appointment_requests")
        .update({
          status: "confirmed",
          patient_id: chosenPatient.id,
          appointment_id: appt.id,
          handled_by: currentUser.staffId,
          handled_at: new Date().toISOString(),
        })
        .eq("id", confirming.id);
      if (updErr) throw updErr;

      setConfirming(null);
      await fetchRows();
    } catch (err: any) {
      // The book has a database-level no-overlap constraint; surface that
      // plainly rather than as a raw Postgres error.
      const msg = String(err.message || "");
      setConfirmError(
        msg.includes("appointments_no_overlap")
          ? "That doctor already has an appointment at this time. Decline this request or agree another time with the patient."
          : msg || "Could not confirm this request."
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDecline = async (r: RequestRow) => {
    const reason = prompt("Why are you declining? (optional — for your records)");
    if (reason === null) return;
    setBusyId(r.id);
    try {
      const { error: err } = await supabase
        .from("appointment_requests")
        .update({
          status: "declined",
          decline_reason: reason.trim() || null,
          handled_by: currentUser?.staffId || null,
          handled_at: new Date().toISOString(),
        })
        .eq("id", r.id);
      if (err) throw err;
      await fetchRows();
    } catch (err: any) {
      setError(err.message || "Could not decline this request.");
    } finally {
      setBusyId(null);
    }
  };

  // ── Manual WhatsApp. Opens the app with the message ready; the staff
  // member presses send. Nothing is sent from here.
  const notifyWhatsApp = async (r: RequestRow) => {
    const doctorName = doctors.find(d => d.id === r.doctor_id)?.full_name || "your doctor";
    const when = new Date(r.requested_at);
    const message = fillTemplate(clinic?.whatsapp_template || DEFAULT_WHATSAPP_TEMPLATE, {
      name: r.full_name,
      date: when.toLocaleDateString("en-GB", {
        weekday: "long", day: "2-digit", month: "long", year: "numeric",
        ...(clinic?.timezone ? { timeZone: clinic.timezone } : {}),
      }),
      time: when.toLocaleTimeString("en-GB", {
        hour: "2-digit", minute: "2-digit",
        ...(clinic?.timezone ? { timeZone: clinic.timezone } : {}),
      }),
      doctor: doctorName,
      clinic: clinic?.clinic_name || "the clinic",
      phone: clinic?.phone || "",
      address: clinic?.address || "",
    });
    const link = buildWhatsAppLink(r.phone, message, clinic?.default_country_code);
    if (!link) {
      setError(`${r.full_name}'s phone number (${r.phone}) isn't a valid number, so WhatsApp can't open.`);
      return;
    }
    window.open(link, "_blank", "noopener,noreferrer");
    // Record that someone reached out -- not that the message was sent,
    // which only the staff member pressing send in WhatsApp can know.
    try {
      await supabase.from("appointment_requests")
        .update({ notified_at: new Date().toISOString() }).eq("id", r.id);
      await fetchRows();
    } catch { /* opening WhatsApp matters more than the bookkeeping */ }
  };

  const Row = ({ r }: { r: RequestRow }) => {
    const isPending = r.status === "pending";
    return (
      <div className={`border rounded-lg p-3 bg-white ${isPending ? "border-amber-200 bg-amber-50/30" : "border-slate-200"}`}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-slate-800">{r.full_name}</span>
              <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${
                r.status === "pending"   ? "bg-amber-100 text-amber-800"
                : r.status === "confirmed" ? "bg-emerald-100 text-emerald-700"
                : "bg-slate-200 text-slate-600"
              }`}>{r.status}</span>
              {r.notified_at && (
                <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-[#dee9f3] text-[#2a5178]">
                  notified
                </span>
              )}
            </div>
            <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-2 flex-wrap">
              <span className="flex items-center gap-1"><Phone size={10} /> {r.phone}</span>
              <span className="flex items-center gap-1"><CalendarClock size={10} /> {formatSlot(r.requested_at, clinic?.timezone)}</span>
              {r.staff?.full_name && <span className="flex items-center gap-1"><UserRound size={10} /> {r.staff.full_name}</span>}
            </div>
            {r.reason && <p className="text-[11px] text-slate-600 mt-1 italic">"{r.reason}"</p>}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {isPending && (
              <>
                <button
                  type="button"
                  onClick={() => openConfirm(r)}
                  disabled={busyId === r.id}
                  className="text-[10px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 px-2.5 py-1.5 rounded flex items-center gap-1 cursor-pointer"
                >
                  <Check size={11} /> Confirm
                </button>
                <button
                  type="button"
                  onClick={() => handleDecline(r)}
                  disabled={busyId === r.id}
                  className="text-[10px] font-bold text-slate-500 border border-slate-200 hover:bg-slate-50 disabled:opacity-50 px-2.5 py-1.5 rounded flex items-center gap-1 cursor-pointer"
                >
                  <X size={11} /> Decline
                </button>
              </>
            )}
            {r.status === "confirmed" && (
              <button
                type="button"
                onClick={() => notifyWhatsApp(r)}
                title="Opens WhatsApp with the message ready — you still press send"
                className="text-[10px] font-bold text-white bg-[#25D366] hover:brightness-95 px-2.5 py-1.5 rounded flex items-center gap-1 cursor-pointer"
              >
                <MessageCircle size={11} /> {r.notified_at ? "Message again" : "Notify by WhatsApp"}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="p-4 max-w-[1100px] mx-auto">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <h2 className="text-sm font-black text-[#2a5178] uppercase tracking-wide">Booking Requests</h2>
          <p className="text-[11px] text-slate-400">
            Patients who asked for a visit online. A request isn't an appointment until you confirm it.
          </p>
        </div>
        <div className="flex gap-1">
          {(["pending", "handled"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded text-[11px] font-bold border cursor-pointer ${
                tab === t
                  ? "bg-[var(--theme-accent)] text-white border-[var(--theme-accent)]"
                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
              }`}
            >
              {t === "pending" ? `Pending (${pending.length})` : `Handled (${handled.length})`}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 text-red-700 text-[11px] font-semibold px-3 py-2 rounded-lg mb-3 flex items-center gap-2">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {isLoading ? (
        <div className="h-32 flex items-center justify-center text-slate-400 text-[11px] gap-2">
          <Loader2 size={15} className="animate-spin" /> Loading requests...
        </div>
      ) : (tab === "pending" ? pending : handled).length === 0 ? (
        <div className="text-center py-12 bg-white border border-slate-200 rounded-lg">
          <Inbox className="h-7 w-7 text-slate-300 mx-auto mb-1.5" />
          <p className="text-[11px] font-bold text-slate-500">
            {tab === "pending" ? "No requests waiting" : "Nothing handled yet"}
          </p>
          <p className="text-[10px] text-slate-400 mt-0.5">
            {tab === "pending" ? "New online booking requests land here." : "Confirmed and declined requests appear here."}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {(tab === "pending" ? pending : handled).map(r => <Row key={r.id} r={r} />)}
        </div>
      )}

      {/* CONFIRM MODAL — match to a chart before creating the appointment */}
      {confirming && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-[9999]">
          <div className="bg-white rounded-xl shadow-2xl border w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b bg-slate-50 flex items-center justify-between shrink-0">
              <div>
                <span className="font-black text-xs text-[#2a5178] uppercase tracking-wide block">Confirm request</span>
                <span className="text-[10px] text-slate-400 font-semibold">
                  {confirming.full_name} · {formatSlot(confirming.requested_at, clinic?.timezone)}
                </span>
              </div>
              <button onClick={() => setConfirming(null)} className="text-slate-400 hover:text-slate-600 cursor-pointer p-1">
                <X size={17} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-[10px] text-amber-800">
                This name was typed by whoever filled the form — it isn't verified. Match it to the
                right chart before confirming, or register them as a new patient first.
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Match to a patient chart
                </label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                  <input
                    value={matchSearch}
                    onChange={e => { setMatchSearch(e.target.value); searchPatients(confirming.phone, e.target.value); }}
                    placeholder="Search by name or phone..."
                    className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)]"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto">
                {matches.length === 0 ? (
                  <div className="text-center py-5 bg-slate-50 border border-slate-200 rounded-lg">
                    <UserPlus className="h-5 w-5 text-slate-300 mx-auto mb-1" />
                    <p className="text-[11px] font-bold text-slate-500">No matching chart</p>
                    <p className="text-[10px] text-slate-400 mt-0.5 px-4">
                      Register them in Patients first, then come back and confirm.
                    </p>
                  </div>
                ) : matches.map(p => {
                  const active = chosenPatient?.id === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setChosenPatient(p)}
                      className={`border rounded-lg p-2.5 flex items-center gap-2.5 text-left cursor-pointer transition-colors ${
                        active ? "border-[var(--theme-accent)] bg-[#edf3f8]" : "border-slate-200 bg-white hover:border-[#c2d5e7]"
                      }`}
                    >
                      <span className="h-7 w-7 rounded-full bg-[#6e9cc9] text-white flex items-center justify-center font-extrabold text-[9px] shrink-0">
                        {`${p.first_name?.[0] || ""}${p.last_name?.[0] || ""}`.toUpperCase()}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-bold text-slate-800 truncate">
                          {`${p.first_name || ""} ${p.last_name || ""}`.trim()}
                        </div>
                        <div className="text-[9px] text-slate-400">MRN {p.mrn}{p.phone ? ` · ${p.phone}` : ""}</div>
                      </div>
                      {active && <Check size={14} className="text-[var(--theme-accent)] shrink-0" />}
                    </button>
                  );
                })}
              </div>

              {confirmError && (
                <div className="bg-red-50 border border-red-100 text-red-700 text-[10px] font-semibold px-2.5 py-2 rounded">
                  {confirmError}
                </div>
              )}
            </div>

            <div className="border-t px-4 py-3 flex items-center justify-end gap-2 shrink-0 bg-slate-50">
              <button onClick={() => setConfirming(null)} className="text-[11px] font-bold text-slate-500 px-3 py-2 cursor-pointer">
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={saving || !chosenPatient}
                className="text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 px-3.5 py-2 rounded-lg flex items-center gap-1.5 cursor-pointer"
              >
                {saving ? <><Loader2 size={12} className="animate-spin" /> Confirming...</> : <><Check size={12} /> Confirm & book</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
