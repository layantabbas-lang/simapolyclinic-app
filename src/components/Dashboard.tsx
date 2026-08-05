import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle, CalendarDays, CalendarSearch, ChevronLeft, ChevronRight, Clock, Search,
  TrendingUp, UserRound, Users, CheckCircle2, XCircle, CalendarClock, X,
} from "lucide-react";
import { supabase } from "../supabaseClient";
import { UserSession } from "../types";

interface ApptRow {
  id: string;
  patient_id: string;
  doctor_id: string;
  starts_at: string;
  ends_at: string;
  status: "scheduled" | "confirmed" | "arrived" | "in_progress" | "completed" | "no_show" | "cancelled";
  reason: string | null;
  patients?: { id: string; first_name: string; last_name: string; mrn: string; phone?: string | null } | null;
  staff?: { id: string; full_name: string } | null;
}

const STATUS_STYLES: Record<ApptRow["status"], { bg: string; text: string; label: string }> = {
  scheduled:   { bg: "#f4f6f9", text: "#5d6b7c", label: "Scheduled" },
  confirmed:   { bg: "#dee9f3", text: "#2a5178", label: "Confirmed" },
  arrived:     { bg: "#faf3e3", text: "#75581a", label: "Arrived" },
  in_progress: { bg: "#c2d5e7", text: "#12233a", label: "In Progress" },
  completed:   { bg: "#d5e8de", text: "#2c6349", label: "Completed" },
  no_show:     { bg: "#f3dbdb", text: "#96322f", label: "No-Show" },
  cancelled:   { bg: "#dee4eb", text: "#71808f", label: "Cancelled" },
};

// Local date parts, never toISOString() -- a UTC slice can land on the
// wrong calendar day depending on the browser's timezone offset.
const dayKey = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const isSameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
const formatTime = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
// A clinic book realistically spans a few years either side of now.
const YEAR_OPTIONS = (() => {
  const y = new Date().getFullYear();
  return Array.from({ length: 11 }, (_, i) => y - 5 + i);
})();

const DRILL_TITLES: Record<string, string> = {
  patients:  "All Patients",
  allVisits: "All Visits",
  upcoming:  "Upcoming Visits",
  today:     "Today's Visits",
  month:     "This Month's Visits",
};

// Monday-first grid covering the whole month plus the leading/trailing days
// needed to fill complete weeks.
function buildMonthGrid(month: Date): Date[] {
  const first = startOfMonth(month);
  // getDay(): 0=Sun..6=Sat -> shift so Monday is column 0
  const lead = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - lead);
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    cells.push(d);
  }
  return cells;
}

type DrillKey = "patients" | "allVisits" | "upcoming" | "today" | "month";

interface DrillPatient {
  id: string; first_name: string; last_name: string; mrn: string;
  phone: string | null; date_of_birth: string | null;
}

export default function Dashboard({
  currentUser,
  onOpenPatient,
}: {
  currentUser?: UserSession | null;
  // Hands a patient id up to App, which switches to Patients and opens
  // that chart. Optional so the Dashboard still renders standalone.
  onOpenPatient?: (patientId: string) => void;
}) {
  const [month, setMonth] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [dateInput, setDateInput] = useState(() => dayKey(new Date()));
  const [isJumpOpen, setIsJumpOpen] = useState(false);
  const [monthAppts, setMonthAppts] = useState<ApptRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [totals, setTotals] = useState({ patients: 0, allVisits: 0, upcoming: 0 });
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<ApptRow[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Drill-down opened by clicking a stat card.
  const [drill, setDrill] = useState<DrillKey | null>(null);
  const [drillPatients, setDrillPatients] = useState<DrillPatient[]>([]);
  const [drillVisits, setDrillVisits] = useState<ApptRow[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillError, setDrillError] = useState<string | null>(null);

  // ── Month's appointments (drives both the calendar dots and the day list)
  const fetchMonth = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const { data, error } = await supabase
        .from("appointments")
        .select("id, patient_id, doctor_id, starts_at, ends_at, status, reason, patients(id, first_name, last_name, mrn, phone), staff!doctor_id(id, full_name)")
        .gte("starts_at", startOfMonth(month).toISOString())
        .lte("starts_at", endOfMonth(month).toISOString())
        .order("starts_at", { ascending: true });
      if (error) throw error;
      setMonthAppts((data as any as ApptRow[]) || []);
    } catch (err: any) {
      setErrorMsg(err.message || "Could not load the calendar.");
      setMonthAppts([]);
    } finally {
      setIsLoading(false);
    }
  };

  // ── Clinic-wide counters. head:true asks Postgres for the count only, so
  // these stay cheap as the book grows instead of pulling every row back.
  const fetchTotals = async () => {
    try {
      const nowIso = new Date().toISOString();
      const [patients, visits, upcoming] = await Promise.all([
        supabase.from("patients").select("id", { count: "exact", head: true }),
        supabase.from("appointments").select("id", { count: "exact", head: true }),
        supabase.from("appointments").select("id", { count: "exact", head: true })
          .gte("starts_at", nowIso)
          .not("status", "in", '("cancelled","no_show")'),
      ]);
      setTotals({
        patients: patients.count || 0,
        allVisits: visits.count || 0,
        upcoming: upcoming.count || 0,
      });
    } catch (err) {
      console.warn("Could not load dashboard totals:", err);
    }
  };

  useEffect(() => { fetchMonth(); /* eslint-disable-next-line */ }, [month]);
  useEffect(() => { fetchTotals(); }, []);

  // ── Drill-down: load whatever list sits behind the clicked stat.
  const openDrill = async (key: DrillKey) => {
    setDrill(key);
    setDrillLoading(true);
    setDrillError(null);
    setDrillPatients([]);
    setDrillVisits([]);
    try {
      if (key === "patients") {
        const { data, error } = await supabase
          .from("patients")
          .select("id, first_name, last_name, mrn, phone, date_of_birth")
          .order("last_name", { ascending: true })
          .limit(500);
        if (error) throw error;
        setDrillPatients((data as DrillPatient[]) || []);
      } else {
        const sel = "id, patient_id, doctor_id, starts_at, ends_at, status, reason, patients(id, first_name, last_name, mrn, phone), staff!doctor_id(id, full_name)";
        let q = supabase.from("appointments").select(sel);
        const now = new Date();
        if (key === "upcoming") {
          q = q.gte("starts_at", now.toISOString())
               .not("status", "in", '("cancelled","no_show")')
               .order("starts_at", { ascending: true });
        } else if (key === "today") {
          const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          const to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
          q = q.gte("starts_at", from.toISOString()).lte("starts_at", to.toISOString())
               .order("starts_at", { ascending: true });
        } else if (key === "month") {
          q = q.gte("starts_at", startOfMonth(month).toISOString())
               .lte("starts_at", endOfMonth(month).toISOString())
               .order("starts_at", { ascending: true });
        } else {
          q = q.order("starts_at", { ascending: false });
        }
        const { data, error } = await q.limit(500);
        if (error) throw error;
        setDrillVisits((data as any as ApptRow[]) || []);
      }
    } catch (err: any) {
      setDrillError(err.message || "Could not load this list.");
    } finally {
      setDrillLoading(false);
    }
  };

  const openChart = (patientId?: string | null) => {
    if (!patientId) return;
    onOpenPatient?.(patientId);
  };

  // ── Search across the whole book, not just the visible month.
  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) { setSearchResults([]); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      setIsSearching(true);
      try {
        const { data, error } = await supabase
          .from("appointments")
          .select("id, patient_id, doctor_id, starts_at, ends_at, status, reason, patients!inner(id, first_name, last_name, mrn, phone), staff!doctor_id(id, full_name)")
          .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,mrn.ilike.%${q}%`, { referencedTable: "patients" })
          .order("starts_at", { ascending: false })
          .limit(25);
        if (error) throw error;
        if (!cancelled) setSearchResults((data as any as ApptRow[]) || []);
      } catch (err) {
        if (!cancelled) setSearchResults([]);
      } finally {
        if (!cancelled) setIsSearching(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [search]);

  const countsByDay = useMemo(() => {
    const m: Record<string, number> = {};
    for (const a of monthAppts) {
      if (a.status === "cancelled") continue;
      const k = dayKey(new Date(a.starts_at));
      m[k] = (m[k] || 0) + 1;
    }
    return m;
  }, [monthAppts]);

  const dayAppts = useMemo(
    () => monthAppts.filter(a => isSameDay(new Date(a.starts_at), selectedDate)),
    [monthAppts, selectedDate]
  );

  const todayCount = countsByDay[dayKey(new Date())] || 0;
  const monthCount = monthAppts.filter(a => a.status !== "cancelled").length;
  const grid = useMemo(() => buildMonthGrid(month), [month]);
  const today = new Date();

  const shiftMonth = (delta: number) => {
    const next = new Date(month.getFullYear(), month.getMonth() + delta, 1);
    setMonth(next);
  };

  // Jump straight to any date instead of walking there a month at a time.
  //
  // The text lives in its own state rather than being derived from
  // selectedDate on every render. A native date input fires onChange on
  // each keystroke in the year box, so typing "2027" arrives as 0002,
  // 0020, 0202, 2027 -- and a controlled value fed back from state
  // overwrites the half-typed year mid-keystroke, which is how this
  // ended up sitting on year 1902.
  //
  // Split the yyyy-mm-dd parts by hand rather than new Date(value): that
  // parses as UTC midnight, which lands on the previous day for anyone
  // west of GMT -- so picking the 5th would select the 4th.
  const jumpToDate = (value: string) => {
    setDateInput(value);
    const [y, m, d] = value.split("-").map(Number);
    if (!y || !m || !d) return;
    // Only commit once the year is a real one. Anything outside this is a
    // partially typed year, not somewhere the user means to go.
    if (y < 2000 || y > 2100) return;
    setMonth(new Date(y, m - 1, 1));
    setSelectedDate(new Date(y, m - 1, d));
  };

  const goToToday = () => {
    const now = new Date();
    setMonth(new Date(now.getFullYear(), now.getMonth(), 1));
    setSelectedDate(now);
    setDateInput(dayKey(now));
  };

  // Keep the box in step when the date changes from anywhere else (a day
  // cell, Today, the month arrows) -- but never mid-typing, since that's
  // the fight described in jumpToDate.
  const selectDay = (d: Date) => {
    setSelectedDate(d);
    setDateInput(dayKey(d));
  };

  const patientName = (a: ApptRow) =>
    a.patients ? `${a.patients.first_name || ""} ${a.patients.last_name || ""}`.trim() || "Unknown patient" : "Unknown patient";

  const StatCard = ({ icon, label, value, tone, drillKey }: {
    icon: React.ReactNode; label: string; value: number | string; tone: string; drillKey: DrillKey;
  }) => (
    <button
      type="button"
      onClick={() => openDrill(drillKey)}
      title={`See the ${label.toLowerCase()} list`}
      className="bg-white border border-slate-200 rounded-lg p-3 flex items-center gap-3 shadow-xs text-left cursor-pointer hover:border-[var(--theme-accent)] hover:shadow-sm transition-all group"
    >
      <span className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: tone }}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-lg font-black text-[#2a5178] leading-none">{value}</div>
        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1 truncate">{label}</div>
      </div>
      <ChevronRight size={13} className="text-slate-300 group-hover:text-[var(--theme-accent)] shrink-0" />
    </button>
  );

  const ApptLine = ({ a, showDate }: { a: ApptRow; showDate?: boolean }) => {
    const s = STATUS_STYLES[a.status];
    return (
      <div
        onClick={() => openChart(a.patients?.id || a.patient_id)}
        title="Open this patient's chart"
        className="border border-slate-200 rounded-lg p-2.5 bg-white flex items-start gap-2.5 hover:border-[var(--theme-accent)] hover:bg-[#f8fbfd] transition-colors cursor-pointer"
      >
        <div className="text-center shrink-0 w-11">
          <div className="text-[11px] font-black text-[#2a5178] leading-tight">{formatTime(a.starts_at)}</div>
          {showDate && (
            <div className="text-[8px] text-slate-400 font-semibold mt-0.5">
              {new Date(a.starts_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-bold text-slate-800 truncate">{patientName(a)}</div>
          <div className="text-[9px] text-slate-400 truncate">
            {a.patients?.mrn ? `MRN ${a.patients.mrn}` : ""}
            {a.staff?.full_name ? ` · ${a.staff.full_name}` : ""}
          </div>
          {a.reason && <div className="text-[9px] text-slate-500 truncate mt-0.5">{a.reason}</div>}
        </div>
        <span
          className="text-[8px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded shrink-0"
          style={{ background: s.bg, color: s.text }}
        >
          {s.label}
        </span>
      </div>
    );
  };

  return (
    <div className="p-4 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <h2 className="text-sm font-black text-[#2a5178] uppercase tracking-wide">Dashboard</h2>
          <p className="text-[11px] text-slate-400">
            {currentUser?.name ? `Welcome back, ${currentUser.name}.` : ""} Here's the clinic at a glance.
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search visits by patient name or MRN..."
            className="w-full pl-8 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)]"
          />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5 mb-3">
        <StatCard drillKey="patients"  icon={<Users size={16} color="#2a5178" />}        label="Total Patients" value={totals.patients}  tone="#dee9f3" />
        <StatCard drillKey="allVisits" icon={<CalendarDays size={16} color="#2c6349" />} label="Total Visits"   value={totals.allVisits} tone="#d5e8de" />
        <StatCard drillKey="upcoming"  icon={<CalendarClock size={16} color="#75581a" />}label="Upcoming"       value={totals.upcoming}  tone="#faf3e3" />
        <StatCard drillKey="today"     icon={<Clock size={16} color="#12233a" />}        label="Today"          value={todayCount}       tone="#c2d5e7" />
        <StatCard drillKey="month"     icon={<TrendingUp size={16} color="#5d6b7c" />}   label="This Month"     value={monthCount}       tone="#f4f6f9" />
      </div>

      {errorMsg && (
        <div className="bg-red-50 border border-red-100 text-red-700 text-[11px] font-semibold px-3 py-2 rounded-lg mb-3 flex items-center gap-2">
          <AlertCircle size={14} /> {errorMsg}
        </div>
      )}

      {/* Search results replace the calendar/day split while a query is active */}
      {search.trim().length >= 2 ? (
        <div className="bg-white border border-slate-200 rounded-lg shadow-xs overflow-hidden">
          <div className="bg-slate-100 border-b px-3 py-2 flex items-center justify-between">
            <span className="text-[10px] font-bold text-[#2a5178] uppercase tracking-wider">
              Search results for "{search.trim()}"
            </span>
            <button onClick={() => setSearch("")} className="text-[10px] font-bold text-slate-400 hover:text-slate-600 cursor-pointer">
              Clear
            </button>
          </div>
          <div className="p-3 flex flex-col gap-1.5 max-h-[62vh] overflow-y-auto">
            {isSearching ? (
              <div className="h-24 flex items-center justify-center text-slate-400 text-[11px] gap-2">
                <div className="w-4 h-4 border-2 border-[var(--theme-accent)] border-t-transparent rounded-full animate-spin" />
                Searching...
              </div>
            ) : searchResults.length === 0 ? (
              <div className="text-center py-8 text-slate-400">
                <Search className="h-6 w-6 mx-auto mb-1.5 text-slate-300" />
                <p className="text-[11px] font-bold">No visits match "{search.trim()}"</p>
              </div>
            ) : (
              searchResults.map(a => <ApptLine key={a.id} a={a} showDate />)
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-12 gap-3">
          {/* CALENDAR */}
          <div className="col-span-12 lg:col-span-7 bg-white border border-slate-200 rounded-lg shadow-xs overflow-hidden">
            <div className="bg-slate-100 border-b px-3 py-2 flex items-center justify-between">
              <button onClick={() => shiftMonth(-1)} className="p-1 rounded hover:bg-white text-slate-500 cursor-pointer">
                <ChevronLeft size={15} />
              </button>
              <div className="flex items-center gap-2 flex-wrap justify-center">
                <span className="text-[11px] font-black text-[#2a5178] uppercase tracking-wider">
                  {month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
                </span>
                <button
                  onClick={goToToday}
                  className="text-[9px] font-bold text-[var(--theme-accent)] border border-[#c2d5e7] px-1.5 py-0.5 rounded hover:bg-[#edf3f8] cursor-pointer"
                >
                  Today
                </button>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setIsJumpOpen(v => !v)}
                    title="Go to a specific month or date"
                    className={`text-[9px] font-bold border px-1.5 py-0.5 rounded cursor-pointer flex items-center gap-1 ${
                      isJumpOpen
                        ? "bg-[var(--theme-accent)] text-white border-[var(--theme-accent)]"
                        : "text-[var(--theme-accent)] border-[#c2d5e7] hover:bg-[#edf3f8]"
                    }`}
                  >
                    <CalendarSearch size={11} /> Go to date
                  </button>

                  {isJumpOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setIsJumpOpen(false)} />
                      <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 z-50 bg-white border border-slate-200 rounded-lg shadow-xl p-2.5 w-56 flex flex-col gap-2">
                        <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">
                          Jump to month
                        </div>
                        <div className="flex gap-1.5">
                          <select
                            value={month.getMonth()}
                            onChange={e => setMonth(new Date(month.getFullYear(), Number(e.target.value), 1))}
                            className="flex-1 text-[10px] font-semibold border border-slate-200 rounded px-1.5 py-1 bg-white cursor-pointer focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)]"
                          >
                            {MONTH_NAMES.map((name, i) => (
                              <option key={name} value={i}>{name}</option>
                            ))}
                          </select>
                          <select
                            value={month.getFullYear()}
                            onChange={e => setMonth(new Date(Number(e.target.value), month.getMonth(), 1))}
                            className="w-20 text-[10px] font-semibold border border-slate-200 rounded px-1.5 py-1 bg-white cursor-pointer focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)]"
                          >
                            {YEAR_OPTIONS.map(y => (
                              <option key={y} value={y}>{y}</option>
                            ))}
                          </select>
                        </div>

                        <div className="border-t border-slate-100 pt-2">
                          <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                            Or an exact date
                          </div>
                          <div className="flex gap-1.5">
                            <input
                              type="date"
                              min="2000-01-01"
                              max="2100-12-31"
                              value={dateInput}
                              onChange={e => setDateInput(e.target.value)}
                              className="flex-1 text-[10px] font-semibold border border-slate-200 rounded px-1.5 py-1 bg-white cursor-pointer focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)]"
                            />
                            <button
                              type="button"
                              onClick={() => { jumpToDate(dateInput); setIsJumpOpen(false); }}
                              className="text-[10px] font-bold text-white bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-dark)] px-2 rounded cursor-pointer"
                            >
                              Go
                            </button>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
              <button onClick={() => shiftMonth(1)} className="p-1 rounded hover:bg-white text-slate-500 cursor-pointer">
                <ChevronRight size={15} />
              </button>
            </div>

            <div className="p-2.5">
              <div className="grid grid-cols-7 gap-1 mb-1">
                {WEEKDAYS.map(d => (
                  <div key={d} className="text-center text-[9px] font-bold text-slate-400 uppercase tracking-wider py-1">{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {grid.map((d, i) => {
                  const inMonth = d.getMonth() === month.getMonth();
                  const count = countsByDay[dayKey(d)] || 0;
                  const isToday = isSameDay(d, today);
                  const isSelected = isSameDay(d, selectedDate);
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => selectDay(new Date(d))}
                      className={`aspect-square rounded-md flex flex-col items-center justify-center gap-0.5 border transition-all cursor-pointer ${
                        isSelected
                          ? "bg-[var(--theme-accent)] text-white border-[var(--theme-accent)] shadow-xs"
                          : isToday
                          ? "bg-[#edf3f8] border-[#c2d5e7] text-[#2a5178]"
                          : inMonth
                          ? "bg-white border-slate-100 text-slate-700 hover:border-[#c2d5e7]"
                          : "bg-slate-50/60 border-transparent text-slate-300"
                      }`}
                    >
                      <span className={`text-[11px] ${isToday || isSelected ? "font-black" : "font-semibold"}`}>
                        {d.getDate()}
                      </span>
                      {count > 0 && (
                        <span
                          className={`text-[8px] font-bold px-1 rounded-full leading-tight ${
                            isSelected ? "bg-white/25 text-white" : "bg-[#dee9f3] text-[#2a5178]"
                          }`}
                        >
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="text-[9px] text-slate-400 mt-2 text-center">
                The number on a day is how many visits are booked. Click a day to see them.
              </p>
            </div>
          </div>

          {/* VISITS FOR THE SELECTED DAY */}
          <div className="col-span-12 lg:col-span-5 bg-white border border-slate-200 rounded-lg shadow-xs overflow-hidden flex flex-col">
            <div className="bg-slate-100 border-b px-3 py-2 flex items-center justify-between shrink-0">
              <div>
                <span className="text-[10px] font-black text-[#2a5178] uppercase tracking-wider block">
                  {isSameDay(selectedDate, today) ? "Today's Visits" : "Visits"}
                </span>
                <span className="text-[9px] text-slate-400 font-semibold">
                  {selectedDate.toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "long" })}
                </span>
              </div>
              <span className="text-[10px] font-bold text-[#2a5178] bg-[#dee9f3] px-2 py-1 rounded shrink-0">
                {dayAppts.length}
              </span>
            </div>

            <div className="flex-1 p-2.5 flex flex-col gap-1.5 overflow-y-auto max-h-[52vh]">
              {isLoading ? (
                <div className="h-24 flex items-center justify-center text-slate-400 text-[11px] gap-2">
                  <div className="w-4 h-4 border-2 border-[var(--theme-accent)] border-t-transparent rounded-full animate-spin" />
                  Loading...
                </div>
              ) : dayAppts.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center py-8 text-slate-400">
                  <CalendarDays className="h-7 w-7 mb-1.5 text-slate-300" />
                  <p className="text-[11px] font-bold text-slate-500">No visits booked</p>
                  <p className="text-[10px] mt-0.5">Nothing scheduled for this day.</p>
                </div>
              ) : (
                dayAppts.map(a => <ApptLine key={a.id} a={a} />)
              )}
            </div>

            {dayAppts.length > 0 && (
              <div className="border-t bg-slate-50 px-3 py-2 flex items-center gap-3 text-[9px] font-bold shrink-0">
                <span className="flex items-center gap-1 text-emerald-700">
                  <CheckCircle2 size={11} /> {dayAppts.filter(a => a.status === "completed").length} done
                </span>
                <span className="flex items-center gap-1 text-[#2a5178]">
                  <UserRound size={11} /> {dayAppts.filter(a => ["scheduled", "confirmed", "arrived", "in_progress"].includes(a.status)).length} open
                </span>
                <span className="flex items-center gap-1 text-slate-400">
                  <XCircle size={11} /> {dayAppts.filter(a => ["cancelled", "no_show"].includes(a.status)).length} cancelled
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* DRILL-DOWN: the list behind whichever stat was clicked */}
      {drill && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-[9999]">
          <div className="bg-white rounded-xl shadow-2xl border w-full max-w-2xl max-h-[82vh] flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b bg-slate-50 flex items-center justify-between shrink-0">
              <div>
                <span className="font-black text-xs text-[#2a5178] uppercase tracking-wide block">
                  {DRILL_TITLES[drill]}
                </span>
                <span className="text-[10px] text-slate-400 font-semibold">
                  {drill === "patients"
                    ? `${drillPatients.length} patient${drillPatients.length === 1 ? "" : "s"} · click one to open their chart`
                    : `${drillVisits.length} visit${drillVisits.length === 1 ? "" : "s"} · click one to open that patient's chart`}
                </span>
              </div>
              <button onClick={() => setDrill(null)} className="text-slate-400 hover:text-slate-600 cursor-pointer p-1">
                <X size={17} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-1.5">
              {drillLoading ? (
                <div className="h-32 flex items-center justify-center text-slate-400 text-[11px] gap-2">
                  <div className="w-4 h-4 border-2 border-[var(--theme-accent)] border-t-transparent rounded-full animate-spin" />
                  Loading...
                </div>
              ) : drillError ? (
                <div className="bg-red-50 border border-red-100 text-red-700 text-[11px] font-semibold px-3 py-2 rounded-lg flex items-center gap-2">
                  <AlertCircle size={14} /> {drillError}
                </div>
              ) : drill === "patients" ? (
                drillPatients.length === 0 ? (
                  <div className="text-center py-10 text-slate-400">
                    <Users className="h-7 w-7 mx-auto mb-1.5 text-slate-300" />
                    <p className="text-[11px] font-bold">No patients registered yet</p>
                  </div>
                ) : (
                  drillPatients.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => openChart(p.id)}
                      className="border border-slate-200 rounded-lg p-2.5 bg-white flex items-center gap-2.5 hover:border-[var(--theme-accent)] hover:bg-[#f8fbfd] transition-colors cursor-pointer text-left"
                    >
                      <span className="h-8 w-8 rounded-full bg-[#6e9cc9] text-white flex items-center justify-center font-extrabold text-[10px] shrink-0">
                        {`${p.first_name?.[0] || ""}${p.last_name?.[0] || ""}`.toUpperCase() || "?"}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-bold text-slate-800 truncate">
                          {`${p.first_name || ""} ${p.last_name || ""}`.trim() || "Unnamed patient"}
                        </div>
                        <div className="text-[9px] text-slate-400 truncate">
                          MRN {p.mrn || "--"}
                          {p.date_of_birth && ` · ${new Date(p.date_of_birth).toLocaleDateString("en-GB")}`}
                          {p.phone && ` · ${p.phone}`}
                        </div>
                      </div>
                      <ChevronRight size={13} className="text-slate-300 shrink-0" />
                    </button>
                  ))
                )
              ) : drillVisits.length === 0 ? (
                <div className="text-center py-10 text-slate-400">
                  <CalendarDays className="h-7 w-7 mx-auto mb-1.5 text-slate-300" />
                  <p className="text-[11px] font-bold">No visits in this list</p>
                </div>
              ) : (
                drillVisits.map(a => <ApptLine key={a.id} a={a} showDate />)
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
