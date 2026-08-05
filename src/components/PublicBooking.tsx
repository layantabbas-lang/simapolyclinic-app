import { useEffect, useState } from "react";
import { CalendarDays, Check, ChevronLeft, ChevronRight, Clock, Loader2, MapPin, Phone, Stethoscope, UserRound } from "lucide-react";

// Patient-facing "request a visit" page. Renders before the staff sign-in
// gate (see App.tsx) so it needs no login.
//
// It talks only to /api/book -- never to Supabase directly -- so the
// anon key grants it nothing and every rule lives server-side.

interface Doctor { id: string; name: string; specialty: string | null; }
interface Slot { start: string; end: string; }
interface Clinic { name: string | null; phone: string | null; address: string | null; }

const toDateInput = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const formatLongDate = (d: Date) =>
  d.toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });

export default function PublicBooking() {
  const [clinic, setClinic] = useState<Clinic | null>(null);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [doctorId, setDoctorId] = useState("");
  const [date, setDate] = useState(() => toDateInput(new Date()));
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");

  const [loadingDoctors, setLoadingDoctors] = useState(true);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [unavailable, setUnavailable] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/book");
        const j = await r.json();
        if (!r.ok) { setUnavailable(j.error || "Online booking isn't available right now."); return; }
        setClinic(j.clinic || null);
        setDoctors(j.doctors || []);
        if ((j.doctors || []).length === 1) setDoctorId(j.doctors[0].id);
      } catch {
        setUnavailable("Couldn't reach the clinic. Please try again, or call us.");
      } finally {
        setLoadingDoctors(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!doctorId || !date) { setSlots([]); return; }
    let cancelled = false;
    (async () => {
      setLoadingSlots(true);
      setSelectedSlot(null);
      setError(null);
      try {
        const r = await fetch(`/api/book?doctor_id=${encodeURIComponent(doctorId)}&date=${encodeURIComponent(date)}`);
        const j = await r.json();
        if (!cancelled) setSlots(r.ok ? (j.slots || []) : []);
      } catch {
        if (!cancelled) setSlots([]);
      } finally {
        if (!cancelled) setLoadingSlots(false);
      }
    })();
    return () => { cancelled = true; };
  }, [doctorId, date]);

  const shiftDate = (delta: number) => {
    const d = new Date(date + "T00:00:00");
    d.setDate(d.getDate() + delta);
    const todayKey = toDateInput(new Date());
    const next = toDateInput(d);
    if (next < todayKey) return; // no booking into the past
    setDate(next);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!fullName.trim()) { setError("Please enter your full name."); return; }
    if (!phone.trim()) { setError("Please enter your phone number."); return; }
    if (!selectedSlot) { setError("Please choose an appointment time."); return; }

    setSubmitting(true);
    try {
      const r = await fetch("/api/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: fullName.trim(),
          phone: phone.trim(),
          email: email.trim(),
          reason: reason.trim(),
          doctor_id: doctorId || null,
          requested_at: selectedSlot,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        setError(j.error || "Couldn't send your request. Please try again.");
        // The slot may have gone in the meantime -- refresh the list.
        if (r.status === 409 && doctorId) {
          const rr = await fetch(`/api/book?doctor_id=${encodeURIComponent(doctorId)}&date=${encodeURIComponent(date)}`);
          const jj = await rr.json();
          setSlots(rr.ok ? (jj.slots || []) : []);
          setSelectedSlot(null);
        }
        return;
      }
      setDone(true);
    } catch {
      setError("Couldn't reach the clinic. Please try again, or call us.");
    } finally {
      setSubmitting(false);
    }
  };

  const clinicName = clinic?.name || "Our Clinic";
  const selectedDoctor = doctors.find(d => d.id === doctorId);

  const Shell = ({ children }: { children: React.ReactNode }) => (
    <div className="min-h-screen bg-[#eef3f8] flex flex-col">
      <header className="bg-[#2a5178] text-white px-5 py-4">
        <h1 className="text-base font-black tracking-tight">{clinicName}</h1>
        <p className="text-[11px] text-[#c2d5e7]">Request an appointment</p>
      </header>
      <main className="flex-1 p-4 flex justify-center">
        <div className="w-full max-w-lg">{children}</div>
      </main>
      {(clinic?.phone || clinic?.address) && (
        <footer className="px-5 py-3 text-[11px] text-slate-500 bg-white border-t flex flex-wrap gap-x-4 gap-y-1 justify-center">
          {clinic?.phone && <span className="flex items-center gap-1"><Phone size={11} /> {clinic.phone}</span>}
          {clinic?.address && <span className="flex items-center gap-1"><MapPin size={11} /> {clinic.address}</span>}
        </footer>
      )}
    </div>
  );

  if (unavailable) {
    return (
      <Shell>
        <div className="bg-white rounded-xl border border-slate-200 p-6 text-center shadow-sm">
          <p className="text-sm font-bold text-slate-700">{unavailable}</p>
          {clinic?.phone && <p className="text-xs text-slate-500 mt-2">Call us on {clinic.phone}</p>}
        </div>
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell>
        <div className="bg-white rounded-xl border border-slate-200 p-6 text-center shadow-sm">
          <span className="h-12 w-12 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center mx-auto mb-3">
            <Check className="text-emerald-600" size={22} />
          </span>
          <h2 className="text-sm font-black text-[#2a5178]">Request received</h2>
          <p className="text-xs text-slate-600 mt-2 leading-relaxed">
            Thank you, {fullName.split(" ")[0]}. The clinic will contact you on{" "}
            <strong className="text-slate-800">{phone}</strong> to confirm your appointment.
          </p>
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mt-4 text-left">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">You asked for</div>
            <div className="text-xs font-bold text-slate-800">
              {selectedSlot && new Date(selectedSlot).toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "long" })}
              {selectedSlot && ` at ${formatTime(selectedSlot)}`}
            </div>
            {selectedDoctor && <div className="text-[11px] text-slate-500 mt-0.5">with {selectedDoctor.name}</div>}
          </div>
          <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 mt-3">
            This is a request, not a confirmed booking. Your appointment is set once the clinic confirms it with you.
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {/* 1. Doctor */}
        <section className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
            <Stethoscope size={12} className="text-[#2a5178]" /> Choose a doctor
          </label>
          {loadingDoctors ? (
            <div className="h-9 flex items-center text-xs text-slate-400 gap-2">
              <Loader2 size={13} className="animate-spin" /> Loading...
            </div>
          ) : doctors.length === 0 ? (
            <p className="text-xs text-slate-500">
              No doctors are available for online booking yet. Please call the clinic.
            </p>
          ) : (
            <select
              value={doctorId}
              onChange={e => setDoctorId(e.target.value)}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 bg-white focus:outline-none focus:ring-1 focus:ring-[#2a5178]"
            >
              <option value="">-- select --</option>
              {doctors.map(d => (
                <option key={d.id} value={d.id}>
                  {d.name}{d.specialty ? ` — ${d.specialty}` : ""}
                </option>
              ))}
            </select>
          )}
        </section>

        {/* 2. Day + slots */}
        {doctorId && (
          <section className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
            <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
              <CalendarDays size={12} className="text-[#2a5178]" /> Choose a time
            </label>

            <div className="flex items-center justify-between gap-2 mb-3">
              <button type="button" onClick={() => shiftDate(-1)}
                className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 cursor-pointer">
                <ChevronLeft size={15} />
              </button>
              <input
                type="date"
                value={date}
                min={toDateInput(new Date())}
                onChange={e => e.target.value && setDate(e.target.value)}
                className="flex-1 text-center text-xs font-bold text-[#2a5178] border border-slate-200 rounded-lg px-2 py-2 cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#2a5178]"
              />
              <button type="button" onClick={() => shiftDate(1)}
                className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 cursor-pointer">
                <ChevronRight size={15} />
              </button>
            </div>
            <p className="text-[10px] text-slate-400 text-center -mt-2 mb-2">
              {formatLongDate(new Date(date + "T00:00:00"))}
            </p>

            {loadingSlots ? (
              <div className="h-16 flex items-center justify-center text-xs text-slate-400 gap-2">
                <Loader2 size={13} className="animate-spin" /> Checking availability...
              </div>
            ) : slots.length === 0 ? (
              <div className="text-center py-5 bg-slate-50 border border-slate-200 rounded-lg">
                <Clock className="h-5 w-5 text-slate-300 mx-auto mb-1" />
                <p className="text-xs font-bold text-slate-500">No times available this day</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Try another date.</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
                {slots.map(s => {
                  const active = selectedSlot === s.start;
                  return (
                    <button
                      key={s.start}
                      type="button"
                      onClick={() => setSelectedSlot(s.start)}
                      className={`py-2 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                        active
                          ? "bg-[#2a5178] text-white border-[#2a5178]"
                          : "bg-white text-slate-700 border-slate-200 hover:border-[#2a5178]"
                      }`}
                    >
                      {formatTime(s.start)}
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* 3. Contact details */}
        {selectedSlot && (
          <section className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex flex-col gap-2.5">
            <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              <UserRound size={12} className="text-[#2a5178]" /> Your details
            </label>
            <input
              value={fullName} onChange={e => setFullName(e.target.value)}
              placeholder="Full name" autoComplete="name"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-[#2a5178]"
            />
            <input
              value={phone} onChange={e => setPhone(e.target.value)}
              placeholder="Phone number" type="tel" autoComplete="tel" inputMode="tel"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-[#2a5178]"
            />
            <input
              value={email} onChange={e => setEmail(e.target.value)}
              placeholder="Email (optional)" type="email" autoComplete="email"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-[#2a5178]"
            />
            <textarea
              value={reason} onChange={e => setReason(e.target.value)}
              rows={2} maxLength={500}
              placeholder="Reason for the visit (optional)"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-[#2a5178] resize-none"
            />
            <p className="text-[10px] text-slate-400">
              Please don't include medical details here — you can discuss those at your visit.
            </p>
          </section>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-semibold px-3 py-2.5 rounded-lg">
            {error}
          </div>
        )}

        {selectedSlot && (
          <button
            type="submit"
            disabled={submitting}
            className="bg-[#2a5178] hover:bg-[#1d3a57] disabled:opacity-50 text-white font-bold px-4 py-3 rounded-xl text-sm cursor-pointer flex items-center justify-center gap-2 shadow-sm"
          >
            {submitting ? <><Loader2 size={15} className="animate-spin" /> Sending...</> : "Request this appointment"}
          </button>
        )}

        <p className="text-[10px] text-slate-400 text-center px-4">
          Sending a request doesn't book the appointment. The clinic will contact you to confirm.
        </p>
      </form>
    </Shell>
  );
}
