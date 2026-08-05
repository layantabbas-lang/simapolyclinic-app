import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle, CalendarDays, ChevronLeft, ChevronRight, Clock, Search,
  TrendingUp, UserRound, Users, CheckCircle2, XCircle, CalendarClock,
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

export default function Dashboard({ currentUser }: { currentUser?: UserSession | null }) {
  const [month, setMonth] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [monthAppts, setMonthAppts] = useState<ApptRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [totals, setTotals] = useState({ patients: 0, allVisits: 0, upcoming: 0 });
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<ApptRow[]>([]);
  const [isSearching, setIsSearching] = useState(false);

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

  const patientName = (a: ApptRow) =>
    a.patients ? `${a.patients.first_name || ""} ${a.patients.last_name || ""}`.trim() || "Unknown patient" : "Unknown patient";

  const StatCard = ({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number | string; tone: string }) => (
    <div className="bg-white border border-slate-200 rounded-lg p-3 flex items-center gap-3 shadow-xs">
      <span className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: tone }}>
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-lg font-black text-[#2a5178] leading-none">{value}</div>
        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1 truncate">{label}</div>
      </div>
    </div>
  );

  const ApptLine = ({ a, showDate }: { a: ApptRow; showDate?: boolean }) => {
    const s = STATUS_STYLES[a.status];
    return (
      <div className="border border-slate-200 rounded-lg p-2.5 bg-white flex items-start gap-2.5 hover:border-[#c2d5e7] transition-colors">
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
        <StatCard icon={<Users size={16} color="#2a5178" />}        label="Total Patients"  value={totals.patients}  tone="#dee9f3" />
        <StatCard icon={<CalendarDays size={16} color="#2c6349" />} label="Total Visits"    value={totals.allVisits} tone="#d5e8de" />
        <StatCard icon={<CalendarClock size={16} color="#75581a" />}label="Upcoming"        value={totals.upcoming}  tone="#faf3e3" />
        <StatCard icon={<Clock size={16} color="#12233a" />}        label="Today"           value={todayCount}       tone="#c2d5e7" />
        <StatCard icon={<TrendingUp size={16} color="#5d6b7c" />}   label="This Month"      value={monthCount}       tone="#f4f6f9" />
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
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-black text-[#2a5178] uppercase tracking-wider">
                  {month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
                </span>
                <button
                  onClick={() => { const n = new Date(); setMonth(n); setSelectedDate(n); }}
                  className="text-[9px] font-bold text-[var(--theme-accent)] border border-[#c2d5e7] px-1.5 py-0.5 rounded hover:bg-[#edf3f8] cursor-pointer"
                >
                  Today
                </button>
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
                      onClick={() => setSelectedDate(new Date(d))}
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
    </div>
  );
}
