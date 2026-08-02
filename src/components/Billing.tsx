import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle, Banknote, Check, DollarSign, FileText, Plus, Receipt, Search, X,
} from "lucide-react";
import { supabase } from "../supabaseClient";
import { UserSession } from "../types";

interface ServiceRow { id: string; code: string | null; name: string; category: string | null; price_usd: number; }
// `id` is the real patients.id uuid from a real Supabase project — absent
// in mock mode, where patient_id falls back to the mrn (see supabaseClient.ts).
interface PatientOption { id?: string; first_name: string; surname: string; mrn: number; }
interface InvoiceRow {
  id: string;
  invoice_no: string;
  patient_id: string;
  status: "draft" | "issued" | "partially_paid" | "paid" | "void";
  payer_type: string;
  subtotal_usd: number;
  discount_usd: number;
  vat_pct: number;
  vat_usd: number;
  total_usd: number;
  paid_usd: number;
  issued_at: string | null;
  created_at: string;
  notes: string | null;
  patients?: { id: string; first_name: string; last_name: string; mrn: string };
}
interface InvoiceItemRow {
  id: string; invoice_id: string; service_id: string | null; description: string;
  quantity: number; unit_price_usd: number; discount_usd: number; line_total_usd: number;
}
interface PaymentRow {
  id: string; invoice_id: string; paid_at: string; method: string; amount_usd: number; reference: string | null;
}

const STATUS_STYLES: Record<InvoiceRow["status"], { bg: string; text: string; label: string }> = {
  draft:           { bg: "#f4f6f9", text: "#5d6b7c", label: "Draft" },
  issued:          { bg: "#dee9f3", text: "#2a5178", label: "Issued" },
  partially_paid:  { bg: "#faf3e3", text: "#75581a", label: "Partially Paid" },
  paid:            { bg: "#d5e8de", text: "#2c6349", label: "Paid" },
  void:             { bg: "#f3dbdb", text: "#96322f", label: "Void" },
};

const PAYMENT_METHODS = ["cash", "card", "omt", "whish", "bank_transfer", "cheque", "insurance", "other"];

const formatUsd = (n: number) => `$${(n ?? 0).toFixed(2)}`;
const formatDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB") : "—");

export default function Billing({ currentUser }: { currentUser?: UserSession | null }) {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceRow | null>(null);

  const fetchInvoices = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const { data, error } = await supabase
        .from("invoices")
        .select("*, patients(id, first_name, last_name, mrn)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setInvoices(data || []);
    } catch (err) {
      console.error("Could not load invoices:", err);
      setErrorMsg("Could not load invoices.");
    } finally {
      setIsLoading(false);
    }
  };

  const fetchServices = async () => {
    try {
      const { data } = await supabase.from("services").select("id, code, name, category, price_usd").eq("is_active", true).order("category");
      setServices(data || []);
    } catch (err) {
      console.error("Could not load services:", err);
    }
  };

  useEffect(() => {
    fetchInvoices();
    fetchServices();
  }, []);

  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => statusFilter === "all" || inv.status === statusFilter);
  }, [invoices, statusFilter]);

  const totals = useMemo(() => {
    const outstanding = filteredInvoices.reduce((sum, inv) => sum + (inv.total_usd - inv.paid_usd), 0);
    const collected = filteredInvoices.reduce((sum, inv) => sum + inv.paid_usd, 0);
    return { outstanding, collected };
  }, [filteredInvoices]);

  return (
    <div className="p-4 flex flex-col gap-3 max-w-5xl mx-auto w-full">
      {/* Command ribbon */}
      <div className="bg-[#2a5178] text-white px-4 py-2.5 rounded-lg flex items-center justify-between flex-wrap gap-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-extrabold text-[#edf3f8] uppercase tracking-wider text-[11px] flex items-center gap-1.5">
            <Receipt size={13} className="text-[#c2d5e7]" /> Billing
          </span>
          <span className="text-[10px] text-[#c2d5e7] ml-2 flex items-center gap-1">
            <DollarSign size={11} /> {formatUsd(totals.collected)} collected · {formatUsd(totals.outstanding)} outstanding
          </span>
        </div>
        <button
          onClick={() => setIsNewModalOpen(true)}
          className="bg-[var(--theme-accent)] hover:bg-teal-500 text-white px-2.5 py-1.5 rounded text-[10px] font-bold flex items-center gap-1.5 cursor-pointer transition-all"
        >
          <Plus size={12} /> New Invoice
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white"
        >
          <option value="all">All Statuses</option>
          {Object.entries(STATUS_STYLES).map(([key, s]) => <option key={key} value={key}>{s.label}</option>)}
        </select>
        <span className="text-[11px] text-slate-400 ml-auto">{filteredInvoices.length} invoice{filteredInvoices.length === 1 ? "" : "s"}</span>
      </div>

      {/* Invoice list */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-10 text-center text-slate-400 text-xs">Loading invoices...</div>
        ) : errorMsg ? (
          <div className="p-10 text-center text-red-500 text-xs flex flex-col items-center gap-1.5">
            <AlertCircle size={18} /> {errorMsg}
          </div>
        ) : filteredInvoices.length === 0 ? (
          <div className="p-10 text-center text-slate-400 text-xs">No invoices yet.</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2.5 font-semibold">Invoice #</th>
                <th className="px-4 py-2.5 font-semibold">Patient</th>
                <th className="px-4 py-2.5 font-semibold">Date</th>
                <th className="px-4 py-2.5 font-semibold text-right">Total</th>
                <th className="px-4 py-2.5 font-semibold text-right">Paid</th>
                <th className="px-4 py-2.5 font-semibold text-right">Balance</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredInvoices.map((inv) => {
                const style = STATUS_STYLES[inv.status];
                return (
                  <tr key={inv.id} onClick={() => setSelectedInvoice(inv)} className="hover:bg-slate-50 cursor-pointer">
                    <td className="px-4 py-2.5 font-mono text-slate-500">{inv.invoice_no}</td>
                    <td className="px-4 py-2.5 font-semibold text-slate-800">{inv.patients ? `${inv.patients.first_name} ${inv.patients.last_name}` : "—"}</td>
                    <td className="px-4 py-2.5 text-slate-500">{formatDate(inv.issued_at || inv.created_at)}</td>
                    <td className="px-4 py-2.5 text-right text-slate-700">{formatUsd(inv.total_usd)}</td>
                    <td className="px-4 py-2.5 text-right text-slate-700">{formatUsd(inv.paid_usd)}</td>
                    <td className="px-4 py-2.5 text-right font-bold" style={{ color: inv.total_usd - inv.paid_usd > 0 ? "#96322f" : "#2c6349" }}>
                      {formatUsd(inv.total_usd - inv.paid_usd)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="text-[10px] font-bold px-2 py-1 rounded" style={{ background: style.bg, color: style.text }}>{style.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {isNewModalOpen && (
        <NewInvoiceModal
          services={services}
          onClose={() => setIsNewModalOpen(false)}
          onCreated={() => { setIsNewModalOpen(false); fetchInvoices(); }}
        />
      )}

      {selectedInvoice && (
        <InvoiceDetailModal
          invoice={selectedInvoice}
          currentUser={currentUser}
          onClose={() => setSelectedInvoice(null)}
          onChanged={() => { fetchInvoices(); setSelectedInvoice(null); }}
        />
      )}
    </div>
  );
}

interface LineItemDraft { serviceId: string | null; description: string; quantity: number; unitPrice: number; }

function NewInvoiceModal({ services, onClose, onCreated }: { services: ServiceRow[]; onClose: () => void; onCreated: () => void }) {
  const [patientSearch, setPatientSearch] = useState("");
  const [patientOptions, setPatientOptions] = useState<PatientOption[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientOption | null>(null);
  const [items, setItems] = useState<LineItemDraft[]>([{ serviceId: null, description: "", quantity: 1, unitPrice: 0 }]);
  const [discount, setDiscount] = useState(0);
  const [vatPct, setVatPct] = useState(11);
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
      return name.includes(q) || String(p.mrn).includes(q);
    }).slice(0, 8);
  }, [patientOptions, patientSearch]);

  const subtotal = items.reduce((sum, it) => sum + it.quantity * it.unitPrice, 0);
  const vatUsd = Math.max(0, (subtotal - discount) * (vatPct / 100));
  const total = Math.max(0, subtotal - discount) + vatUsd;

  const updateItem = (idx: number, patch: Partial<LineItemDraft>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const applyService = (idx: number, serviceId: string) => {
    const svc = services.find((s) => s.id === serviceId);
    updateItem(idx, { serviceId, description: svc?.name || "", unitPrice: svc?.price_usd ?? 0 });
  };

  const addItem = () => setItems((prev) => [...prev, { serviceId: null, description: "", quantity: 1, unitPrice: 0 }]);
  const removeItem = (idx: number) => setItems((prev) => prev.filter((_, i) => i !== idx));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!selectedPatient) { setError("Select a patient first."); return; }
    const validItems = items.filter((it) => it.description.trim() && it.quantity > 0);
    if (validItems.length === 0) { setError("Add at least one line item."); return; }

    setIsSaving(true);
    try {
      const { data: invoiceRows, error: invoiceError } = await supabase.from("invoices").insert([{
        patient_id: selectedPatient.id || String(selectedPatient.mrn),
        status: "issued",
        payer_type: "cash",
        issued_at: new Date().toISOString(),
        subtotal_usd: Math.round(subtotal * 100) / 100,
        discount_usd: Math.round(discount * 100) / 100,
        vat_pct: vatPct,
        vat_usd: Math.round(vatUsd * 100) / 100,
        total_usd: Math.round(total * 100) / 100,
      }]).select();
      if (invoiceError) throw invoiceError;
      const invoice = invoiceRows?.[0];
      if (!invoice) throw new Error("Could not create the invoice.");

      const { error: itemsError } = await supabase.from("invoice_items").insert(
        validItems.map((it, i) => ({
          invoice_id: invoice.id,
          service_id: it.serviceId,
          description: it.description.trim(),
          quantity: it.quantity,
          unit_price_usd: it.unitPrice,
          discount_usd: 0,
          sort_order: i,
        }))
      );
      if (itemsError) throw itemsError;
      onCreated();
    } catch (err: any) {
      setError(err.message || "Could not create the invoice.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-[99999] overflow-y-auto">
      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-2xl border w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150 my-8">
        <div className="px-5 py-4 border-b bg-slate-50 flex justify-between items-center">
          <span className="font-bold text-xs text-slate-800 uppercase tracking-wide flex items-center gap-2">
            <FileText size={14} className="text-[var(--theme-accent)]" /> New Invoice
          </span>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
        </div>

        <div className="p-5 flex flex-col gap-3 text-xs max-h-[75vh] overflow-y-auto">
          {error && <div className="bg-red-50 border border-red-100 text-red-600 text-[10px] font-semibold px-2.5 py-1.5 rounded">{error}</div>}

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
                    placeholder="Search by name or MRN..."
                    className="w-full pl-8.5 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-teal-500"
                  />
                </div>
                <div className="max-h-28 overflow-y-auto border border-slate-100 rounded-lg mt-1.5 divide-y divide-slate-100">
                  {filteredPatients.length === 0 ? (
                    <div className="p-2.5 text-center text-slate-400 text-[11px]">No matching patient.</div>
                  ) : (
                    filteredPatients.map((p) => (
                      <button key={p.mrn} type="button" onClick={() => setSelectedPatient(p)} className="w-full text-left p-2 hover:bg-slate-50 flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-700">{p.first_name} {p.surname}</span>
                        <span className="text-[10px] text-slate-400 font-mono">MRN {p.mrn}</span>
                      </button>
                    ))
                  )}
                </div>
              </>
            )}
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Line Items</label>
            <div className="flex flex-col gap-2">
              {items.map((item, idx) => (
                <div key={idx} className="flex items-center gap-1.5">
                  <select
                    value={item.serviceId || ""}
                    onChange={(e) => (e.target.value ? applyService(idx, e.target.value) : updateItem(idx, { serviceId: null }))}
                    className="w-28 border border-slate-200 rounded-md px-1.5 py-1.5 bg-slate-50 text-[10px]"
                  >
                    <option value="">Custom</option>
                    {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <input
                    value={item.description}
                    onChange={(e) => updateItem(idx, { description: e.target.value })}
                    placeholder="Description"
                    className="flex-1 border border-slate-200 rounded-md px-2 py-1.5 bg-slate-50 text-[11px]"
                  />
                  <input
                    type="number"
                    min={0.01}
                    step="any"
                    value={item.quantity}
                    onChange={(e) => updateItem(idx, { quantity: Number(e.target.value) || 0 })}
                    className="w-12 border border-slate-200 rounded-md px-1.5 py-1.5 bg-slate-50 text-[11px] text-center"
                    title="Quantity"
                  />
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={item.unitPrice}
                    onChange={(e) => updateItem(idx, { unitPrice: Number(e.target.value) || 0 })}
                    className="w-16 border border-slate-200 rounded-md px-1.5 py-1.5 bg-slate-50 text-[11px] text-right"
                    title="Unit price (USD)"
                  />
                  <button type="button" onClick={() => removeItem(idx)} disabled={items.length === 1} className="text-slate-300 hover:text-red-400 disabled:opacity-30">
                    <X size={13} />
                  </button>
                </div>
              ))}
              <button type="button" onClick={addItem} className="self-start text-[10px] font-bold flex items-center gap-1" style={{ color: "var(--theme-accent)" }}>
                <Plus size={11} /> Add line
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Discount (USD)</span>
              <input type="number" min={0} step="any" value={discount} onChange={(e) => setDiscount(Number(e.target.value) || 0)} className="border border-slate-200 rounded-md px-2 py-1.5 bg-slate-50 text-[11px]" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">VAT %</span>
              <input type="number" min={0} step="any" value={vatPct} onChange={(e) => setVatPct(Number(e.target.value) || 0)} className="border border-slate-200 rounded-md px-2 py-1.5 bg-slate-50 text-[11px]" />
            </label>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 flex flex-col gap-1 text-[11px]">
            <div className="flex justify-between text-slate-500"><span>Subtotal</span><span>{formatUsd(subtotal)}</span></div>
            <div className="flex justify-between text-slate-500"><span>Discount</span><span>-{formatUsd(discount)}</span></div>
            <div className="flex justify-between text-slate-500"><span>VAT ({vatPct}%)</span><span>{formatUsd(vatUsd)}</span></div>
            <div className="flex justify-between font-bold text-slate-800 pt-1 border-t border-slate-200"><span>Total</span><span>{formatUsd(total)}</span></div>
          </div>

          <button
            type="submit"
            disabled={isSaving}
            className="bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-dark)] disabled:opacity-60 text-white font-bold px-4 py-2 rounded-lg text-xs self-start flex items-center gap-1.5"
          >
            <Check size={12} /> {isSaving ? "Creating..." : "Create Invoice"}
          </button>
        </div>
      </form>
    </div>
  );
}

function InvoiceDetailModal({
  invoice, currentUser, onClose, onChanged,
}: {
  invoice: InvoiceRow;
  currentUser?: UserSession | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [items, setItems] = useState<InvoiceItemRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [amount, setAmount] = useState<number>(Math.max(0, invoice.total_usd - invoice.paid_usd));
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      const [{ data: itemRows }, { data: paymentRows }] = await Promise.all([
        supabase.from("invoice_items").select("*").eq("invoice_id", invoice.id).order("sort_order"),
        supabase.from("payments").select("*").eq("invoice_id", invoice.id).order("paid_at"),
      ]);
      setItems((itemRows || []).filter((it: InvoiceItemRow) => it.invoice_id === invoice.id));
      setPayments((paymentRows || []).filter((p: PaymentRow) => p.invoice_id === invoice.id));
      setIsLoading(false);
    })();
  }, [invoice.id]);

  const balance = Math.max(0, invoice.total_usd - invoice.paid_usd);
  const style = STATUS_STYLES[invoice.status];

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (amount <= 0) { setError("Enter a payment amount greater than zero."); return; }
    setIsSaving(true);
    try {
      const { error: payError } = await supabase.from("payments").insert([{
        invoice_id: invoice.id,
        method,
        amount_original: amount,
        currency: "USD",
        amount_usd: amount,
        reference: reference.trim() || null,
        received_by: currentUser?.id || null,
      }]);
      if (payError) throw payError;
      onChanged();
    } catch (err: any) {
      setError(err.message || "Could not record the payment.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-[99999] overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl border w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150 my-8">
        <div className="px-5 py-4 border-b bg-slate-50 flex justify-between items-center">
          <div>
            <span className="font-bold text-xs text-slate-800 uppercase tracking-wide flex items-center gap-2">
              <Receipt size={14} className="text-[var(--theme-accent)]" /> {invoice.invoice_no}
            </span>
            <div className="text-[10px] text-slate-400 mt-0.5">{invoice.patients ? `${invoice.patients.first_name} ${invoice.patients.last_name}` : "—"} · MRN {invoice.patients?.mrn}</div>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
        </div>

        <div className="p-5 flex flex-col gap-4 text-xs max-h-[75vh] overflow-y-auto">
          <span className="self-start text-[10px] font-bold px-2 py-1 rounded" style={{ background: style.bg, color: style.text }}>{style.label}</span>

          {isLoading ? (
            <div className="text-center text-slate-400 py-4">Loading...</div>
          ) : (
            <>
              <div>
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Line Items</div>
                <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
                  {items.map((it) => (
                    <div key={it.id} className="flex justify-between px-3 py-2">
                      <span className="text-slate-600">{it.description} <span className="text-slate-400">&times;{it.quantity}</span></span>
                      <span className="font-semibold text-slate-700">{formatUsd(it.line_total_usd)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 flex flex-col gap-1">
                <div className="flex justify-between text-slate-500"><span>Subtotal</span><span>{formatUsd(invoice.subtotal_usd)}</span></div>
                <div className="flex justify-between text-slate-500"><span>Discount</span><span>-{formatUsd(invoice.discount_usd)}</span></div>
                <div className="flex justify-between text-slate-500"><span>VAT ({invoice.vat_pct}%)</span><span>{formatUsd(invoice.vat_usd)}</span></div>
                <div className="flex justify-between font-bold text-slate-800 pt-1 border-t border-slate-200"><span>Total</span><span>{formatUsd(invoice.total_usd)}</span></div>
                <div className="flex justify-between text-emerald-700"><span>Paid</span><span>{formatUsd(invoice.paid_usd)}</span></div>
                <div className="flex justify-between font-bold" style={{ color: balance > 0 ? "#96322f" : "#2c6349" }}><span>Balance</span><span>{formatUsd(balance)}</span></div>
              </div>

              {payments.length > 0 && (
                <div>
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Payment History</div>
                  <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
                    {payments.map((p) => (
                      <div key={p.id} className="flex justify-between px-3 py-2">
                        <span className="text-slate-600 flex items-center gap-1.5"><Banknote size={11} className="text-slate-400" /> {p.method} {p.reference ? `(${p.reference})` : ""} — {formatDate(p.paid_at)}</span>
                        <span className="font-semibold text-emerald-700">{formatUsd(p.amount_usd)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {balance > 0 && invoice.status !== "void" && (
                <form onSubmit={handleRecordPayment} className="border-t border-slate-200 pt-3 flex flex-col gap-2">
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Record Payment</div>
                  {error && <div className="bg-red-50 border border-red-100 text-red-600 text-[10px] font-semibold px-2.5 py-1.5 rounded">{error}</div>}
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      type="number" min={0.01} step="any" value={amount}
                      onChange={(e) => setAmount(Number(e.target.value) || 0)}
                      className="border border-slate-200 rounded-md px-2 py-1.5 bg-slate-50 text-[11px]"
                      placeholder="Amount"
                    />
                    <select value={method} onChange={(e) => setMethod(e.target.value)} className="border border-slate-200 rounded-md px-2 py-1.5 bg-slate-50 text-[11px] capitalize">
                      {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m.replace("_", " ")}</option>)}
                    </select>
                    <input
                      value={reference} onChange={(e) => setReference(e.target.value)}
                      placeholder="Reference (optional)"
                      className="border border-slate-200 rounded-md px-2 py-1.5 bg-slate-50 text-[11px]"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="self-start bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-dark)] disabled:opacity-60 text-white font-bold px-4 py-2 rounded-lg text-xs flex items-center gap-1.5"
                  >
                    <Check size={12} /> {isSaving ? "Recording..." : "Record Payment"}
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
