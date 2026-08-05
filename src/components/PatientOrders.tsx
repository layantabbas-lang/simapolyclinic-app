import React, { useState, useEffect, useRef } from "react";
import { Syringe, Check, Trash2, Edit2, X, RotateCcw, FlaskConical, Scan, Stethoscope, Pill, Send, CheckCheck } from "lucide-react";
import { supabase } from "../supabaseClient";
import { UserSession } from "../types";

export type OrderType = "lab" | "imaging" | "procedure" | "medication" | "referral" | "other";
export type OrderStatus = "draft" | "active" | "completed" | "cancelled";

export interface PatientOrder {
  id: string;
  patient_id: string;
  order_type: OrderType;
  status: OrderStatus;
  order_text: string;
  item_name: string | null;
  dose: string | null;
  route: string | null;
  frequency: string | null;
  instructions: string | null;
  ordered_by: string | null;
  signed_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  staff?: { full_name: string } | null;
}

const TYPE_META: Record<OrderType, { label: string; icon: React.ReactNode; cls: string }> = {
  lab:        { label: "Lab",       icon: <FlaskConical size={11} />, cls: "bg-sky-50 text-sky-700 border-sky-200" },
  imaging:    { label: "Imaging",   icon: <Scan size={11} />,         cls: "bg-violet-50 text-violet-700 border-violet-200" },
  procedure:  { label: "Procedure", icon: <Stethoscope size={11} />,  cls: "bg-amber-50 text-amber-700 border-amber-200" },
  medication: { label: "Medication",icon: <Pill size={11} />,         cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  referral:   { label: "Referral",  icon: <Send size={11} />,         cls: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  other:      { label: "Other",     icon: <Syringe size={11} />,      cls: "bg-slate-100 text-slate-600 border-slate-200" },
};

const ROUTE_ALIASES: Record<string, string> = {
  po: "Oral", oral: "Oral", sl: "Sublingual", iv: "IV", im: "IM",
  sc: "Subcutaneous", subq: "Subcutaneous", top: "Topical", topical: "Topical",
  inh: "Inhalation", nasal: "Nasal", pr: "Rectal", pv: "Vaginal",
};

const FREQ_PATTERNS: [RegExp, string][] = [
  [/\bq(\d{1,2})h\b/i, "every $1h"],
  [/\b(bid|twice\s+daily)\b/i, "Twice daily"],
  [/\b(tid|three\s+times\s+daily)\b/i, "Three times daily"],
  [/\b(qid|four\s+times\s+daily)\b/i, "Four times daily"],
  [/\b(qhs|at\s+bedtime)\b/i, "At bedtime"],
  [/\b(prn|as\s+needed)\b/i, "As needed"],
  [/\b(qd|once\s+daily|daily)\b/i, "Once daily"],
];

// Best-effort read of a free-text order. Never rejects input -- whatever it
// can't classify stays as `other` with the raw text intact, so the doctor is
// never blocked by the parser guessing wrong.
export function parseOrderText(raw: string): {
  order_type: OrderType; item_name: string | null; dose: string | null;
  route: string | null; frequency: string | null;
} {
  const text = raw.trim();
  const lower = text.toLowerCase();

  let order_type: OrderType = "other";
  if (/\b(cbc|bmp|cmp|hba1c|lipid|tsh|urinalysis|culture|blood\s+work|panel|level|serum|glucose|creatinine)\b/.test(lower)) {
    order_type = "lab";
  } else if (/\b(x-?ray|xray|ct|mri|ultrasound|u\/s|echo|doppler|mammogram|scan|radiograph)\b/.test(lower)) {
    order_type = "imaging";
  } else if (/\b(refer|referral|consult)\b/.test(lower)) {
    order_type = "referral";
  } else if (/\b(biopsy|excision|suture|injection|aspiration|dressing|ecg|ekg|spirometry)\b/.test(lower)) {
    order_type = "procedure";
  } else if (/\b(mg|mcg|ml|tab|tablet|cap|capsule|syrup|ointment|cream|drops|units?)\b/.test(lower)) {
    order_type = "medication";
  }

  let route: string | null = null;
  for (const [alias, full] of Object.entries(ROUTE_ALIASES)) {
    if (new RegExp(`\\b${alias}\\b`, "i").test(text)) { route = full; break; }
  }

  let frequency: string | null = null;
  for (const [re, label] of FREQ_PATTERNS) {
    const m = text.match(re);
    if (m) { frequency = label.replace("$1", m[1] || ""); break; }
  }

  const doseMatch = text.match(/(\d+(?:\.\d+)?)\s*(mg|mcg|g|ml|tabs?|caps?|units?|puffs?|drops?)\b/i);
  const dose = doseMatch ? `${doseMatch[1]}${doseMatch[2].toLowerCase()}` : null;

  // Item name = the text with the parsed bits stripped off the end.
  let item_name: string | null = text
    .replace(doseMatch ? doseMatch[0] : "", "")
    .replace(/\b(q\d{1,2}h|bid|tid|qid|qhs|qd|prn|po|iv|im|sc|sl)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!item_name) item_name = null;

  return { order_type, item_name, dose, route, frequency };
}

interface Props {
  patientId: string;
  currentUser?: UserSession | null;
  onToast: (msg: string) => void;
}

export default function PatientOrders({ patientId, currentUser, onToast }: Props) {
  const [orders, setOrders] = useState<PatientOrder[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [text, setText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  const drafts = orders.filter(o => o.status === "draft");
  const signed = orders.filter(o => o.status !== "draft");
  const activeCount = orders.filter(o => o.status === "active").length;

  const canOrder = currentUser?.role === "doctor" || currentUser?.role === "admin";

  const fetchOrders = async () => {
    if (!patientId) return;
    setIsLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from("patient_orders")
        .select("*, staff!ordered_by(full_name)")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false });
      if (err) throw err;
      setOrders((data as PatientOrder[]) || []);
    } catch (err: any) {
      setError(err.message || "Could not load orders.");
      setOrders([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchOrders(); /* eslint-disable-next-line */ }, [patientId]);

  const markBusy = (id: string, on: boolean) =>
    setBusyIds(prev => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || isSubmitting) return;
    if (!currentUser?.staffId) {
      setError("Your account isn't linked to a staff record yet, so orders can't be attributed to you. Ask an admin to link it in Staff.");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    const raw = text.trim();
    try {
      const { error: err } = await supabase.from("patient_orders").insert([{
        patient_id: patientId,
        status: "draft",
        order_text: raw,
        ordered_by: currentUser.staffId,
        ...parseOrderText(raw),
      }]);
      if (err) throw err;
      setText("");
      await fetchOrders();
    } catch (err: any) {
      setError(`Could not save this order: ${err.message || "Unknown error"}. Nothing was saved.`);
    } finally {
      setIsSubmitting(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  const handleSaveEdit = async (id: string) => {
    const raw = editingText.trim();
    if (!raw) { setEditingId(null); return; }
    markBusy(id, true);
    try {
      const { error: err } = await supabase
        .from("patient_orders")
        .update({ order_text: raw, ...parseOrderText(raw) })
        .eq("id", id);
      if (err) throw err;
      setEditingId(null);
      await fetchOrders();
    } catch (err: any) {
      onToast(`Could not update this draft: ${err.message}`);
    } finally {
      markBusy(id, false);
    }
  };

  const handleSign = async (ids: string[]) => {
    if (ids.length === 0) return;
    if (!currentUser?.staffId) {
      setError("Your account isn't linked to a staff record, so orders can't be signed.");
      return;
    }
    ids.forEach(id => markBusy(id, true));
    try {
      const { error: err } = await supabase
        .from("patient_orders")
        .update({ status: "active", signed_at: new Date().toISOString(), signed_by: currentUser.staffId })
        .in("id", ids);
      if (err) throw err;
      onToast(ids.length > 1 ? `${ids.length} orders signed.` : "Order signed.");
      await fetchOrders();
    } catch (err: any) {
      onToast(`Could not sign: ${err.message}`);
    } finally {
      ids.forEach(id => markBusy(id, false));
    }
  };

  const handleDiscard = async (id: string) => {
    if (!confirm("Discard this draft? It was never signed, so nothing is kept.")) return;
    markBusy(id, true);
    try {
      const { error: err } = await supabase.from("patient_orders").delete().eq("id", id);
      if (err) throw err;
      await fetchOrders();
    } catch (err: any) {
      onToast(`Could not discard: ${err.message}`);
    } finally {
      markBusy(id, false);
    }
  };

  const handleSetStatus = async (id: string, status: "completed" | "cancelled") => {
    markBusy(id, true);
    try {
      const patch: any = { status };
      if (status === "completed") patch.completed_at = new Date().toISOString();
      if (status === "cancelled") {
        patch.cancelled_at = new Date().toISOString();
        patch.cancelled_by = currentUser?.staffId || null;
      }
      const { error: err } = await supabase.from("patient_orders").update(patch).eq("id", id);
      if (err) throw err;
      onToast(status === "completed" ? "Order marked completed." : "Order cancelled.");
      await fetchOrders();
    } catch (err: any) {
      onToast(`Could not update this order: ${err.message}`);
    } finally {
      markBusy(id, false);
    }
  };

  const renderChips = (o: PatientOrder) => {
    const bits = [o.dose, o.route, o.frequency].filter(Boolean) as string[];
    if (bits.length === 0) return null;
    return (
      <div className="flex flex-wrap gap-1 mt-1">
        {bits.map((b, i) => (
          <span key={i} className="text-[9px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-semibold">{b}</span>
        ))}
      </div>
    );
  };

  const TypeBadge = ({ t }: { t: OrderType }) => (
    <span className={`text-[9px] px-1.5 py-0.5 rounded border font-bold uppercase tracking-wide inline-flex items-center gap-1 ${TYPE_META[t].cls}`}>
      {TYPE_META[t].icon} {TYPE_META[t].label}
    </span>
  );

  return (
    <div className="flex-1 p-4 overflow-y-auto">
      <div className="flex items-center justify-between mb-3 border-b pb-2">
        <div>
          <h4 className="text-xs font-bold text-[#2a5178] uppercase tracking-wider">Orders</h4>
          <p className="text-[10px] text-slate-400 mt-0.5">
            Type an order and hit Enter. It's saved as a draft &mdash; signing is what makes it real.
          </p>
        </div>
        {activeCount > 0 && (
          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded">
            {activeCount} active
          </span>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 text-red-700 text-[10px] font-semibold px-2.5 py-2 rounded mb-3">
          {error}
        </div>
      )}

      {canOrder ? (
        <form onSubmit={handleSubmit} className="mb-4">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder='e.g. "CBC and HbA1c" or "Amoxicillin 500mg PO TID"'
              className="flex-1 px-3 py-2 text-xs border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:bg-white focus:ring-1 focus:ring-[var(--theme-accent)]"
            />
            <button
              type="submit"
              disabled={!text.trim() || isSubmitting}
              className="bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-dark)] disabled:opacity-40 text-white font-bold px-3 py-2 rounded-lg text-[11px] cursor-pointer shrink-0"
            >
              {isSubmitting ? "Adding..." : "Add Draft"}
            </button>
          </div>
          <p className="text-[9px] text-slate-400 mt-1">
            The type, dose, route, and frequency are read from what you type &mdash; correct them by editing the draft.
          </p>
        </form>
      ) : (
        <div className="bg-slate-50 border border-slate-200 text-slate-500 text-[10px] px-2.5 py-2 rounded mb-4">
          Only doctors and admins can write orders. You can see signed orders below.
        </div>
      )}

      {/* DRAFTS */}
      {drafts.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">
              Drafts ({drafts.length}) &mdash; not yet signed
            </span>
            {drafts.length > 1 && (
              <button
                type="button"
                onClick={() => handleSign(drafts.map(d => d.id))}
                className="text-[10px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 px-2 py-1 rounded flex items-center gap-1 cursor-pointer"
              >
                <CheckCheck size={11} /> Sign All ({drafts.length})
              </button>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            {drafts.map(o => (
              <div key={o.id} className="border border-amber-200 bg-amber-50/40 rounded-lg p-2.5">
                {editingId === o.id ? (
                  <div className="flex gap-1.5">
                    <input
                      autoFocus
                      value={editingText}
                      onChange={e => setEditingText(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") handleSaveEdit(o.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      className="flex-1 text-xs border border-slate-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)]"
                    />
                    <button onClick={() => handleSaveEdit(o.id)} className="text-emerald-600 hover:bg-emerald-50 p-1.5 rounded-md cursor-pointer"><Check size={13} /></button>
                    <button onClick={() => setEditingId(null)} className="text-slate-400 hover:bg-slate-100 p-1.5 rounded-md cursor-pointer"><X size={13} /></button>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <TypeBadge t={o.order_type} />
                      <p className="text-[11px] font-semibold text-slate-800 mt-1 break-words">{o.order_text}</p>
                      {renderChips(o)}
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        type="button"
                        title="Sign this order"
                        disabled={busyIds.has(o.id)}
                        onClick={() => handleSign([o.id])}
                        className="text-emerald-600 hover:bg-emerald-100 disabled:opacity-40 p-1.5 rounded cursor-pointer"
                      >
                        <Check size={13} />
                      </button>
                      <button
                        type="button"
                        title="Edit draft"
                        onClick={() => { setEditingId(o.id); setEditingText(o.order_text); }}
                        className="text-slate-400 hover:text-[var(--theme-accent)] p-1.5 rounded cursor-pointer"
                      >
                        <Edit2 size={12} />
                      </button>
                      <button
                        type="button"
                        title="Discard draft"
                        disabled={busyIds.has(o.id)}
                        onClick={() => handleDiscard(o.id)}
                        className="text-slate-400 hover:text-red-500 disabled:opacity-40 p-1.5 rounded cursor-pointer"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SIGNED / HISTORY */}
      <div>
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">
          Signed Orders {signed.length > 0 && `(${signed.length})`}
        </span>

        {isLoading ? (
          <div className="h-24 flex items-center justify-center text-slate-400 text-[11px] gap-2">
            <div className="w-4 h-4 border-2 border-[var(--theme-accent)] border-t-transparent rounded-full animate-spin" />
            Loading orders...
          </div>
        ) : signed.length === 0 ? (
          <div className="text-center p-5 bg-slate-50 border border-slate-200 rounded-lg">
            <Syringe className="h-6 w-6 text-slate-300 mx-auto mb-1" />
            <p className="text-[11px] font-bold text-slate-500">No signed orders yet</p>
            <p className="text-[10px] text-slate-400 mt-0.5">Drafts appear here once you sign them.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {signed.map(o => {
              const isCancelled = o.status === "cancelled";
              const isDone = o.status === "completed";
              return (
                <div
                  key={o.id}
                  className={`border rounded-lg p-2.5 ${
                    isCancelled ? "border-slate-200 bg-slate-50 opacity-60"
                    : isDone ? "border-slate-200 bg-white"
                    : "border-emerald-200 bg-emerald-50/30"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <TypeBadge t={o.order_type} />
                        {isDone && <span className="text-[9px] bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded font-bold uppercase">Completed</span>}
                        {isCancelled && <span className="text-[9px] bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded font-bold uppercase">Cancelled</span>}
                        {!isDone && !isCancelled && <span className="text-[9px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-bold uppercase">Active</span>}
                      </div>
                      <p className={`text-[11px] font-semibold mt-1 break-words ${isCancelled ? "line-through text-slate-500" : "text-slate-800"}`}>
                        {o.order_text}
                      </p>
                      {renderChips(o)}
                      <div className="text-[9px] text-slate-400 mt-1">
                        {o.staff?.full_name || "Unknown"}
                        {o.signed_at && ` · signed ${new Date(o.signed_at).toLocaleDateString("en-GB")}`}
                      </div>
                    </div>

                    {o.status === "active" && (
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          type="button"
                          title="Mark completed"
                          disabled={busyIds.has(o.id)}
                          onClick={() => handleSetStatus(o.id, "completed")}
                          className="text-slate-400 hover:text-emerald-600 disabled:opacity-40 p-1.5 rounded cursor-pointer"
                        >
                          <CheckCheck size={13} />
                        </button>
                        <button
                          type="button"
                          title="Cancel order"
                          disabled={busyIds.has(o.id)}
                          onClick={() => handleSetStatus(o.id, "cancelled")}
                          className="text-slate-400 hover:text-red-500 disabled:opacity-40 p-1.5 rounded cursor-pointer"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    )}
                    {canOrder && (isDone || isCancelled) && (
                      <button
                        type="button"
                        title="Re-order (copies into the box above)"
                        onClick={() => { setText(o.order_text); inputRef.current?.focus(); }}
                        className="text-slate-300 hover:text-[var(--theme-accent)] p-1.5 rounded cursor-pointer shrink-0"
                      >
                        <RotateCcw size={12} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
