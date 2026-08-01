import React, { useState, useEffect } from "react";
import {
  Package, Truck, ShoppingCart, Syringe, Plus, X, Search,
  AlertCircle, Check, Trash2, RefreshCw, User, History, Filter
} from "lucide-react";
import { supabase } from "../supabaseClient";
import { UserSession } from "./SignIn";

interface PharmacyManagerProps { currentUser: UserSession; }

interface Vendor {
  id: number;
  name: string;
  contact_person?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  created_at?: string;
}

interface InventoryItem {
  id: number;
  drug_name: string;
  generic_name?: string | null;
  category?: string | null;
  form: string;
  strength?: string | null;
  unit: string;
  quantity_on_hand: number;
  reorder_level: number;
  unit_cost?: number | null;
  unit_price: number;
  default_vendor_id?: number | null;
  batch_number?: string | null;
  expiry_date?: string | null;
}

interface PurchaseLine {
  inventory_id: number | "";
  quantity: string;
  unit_cost: string;
  batch_number: string;
  expiry_date: string;
}

interface Purchase {
  id: number;
  vendor_id: number;
  invoice_number?: string | null;
  purchase_date: string;
  total_amount: number;
  created_at?: string;
  pharmacy_vendors?: { name: string };
}

interface PatientLite {
  mrn: number;
  first_name: string;
  surname: string;
}

interface DispenseRow {
  id: number;
  patient_mrn: number;
  inventory_id: number;
  quantity: number;
  unit_price: number;
  line_total: number;
  dispensed_at: string;
  notes?: string | null;
  patients?: { first_name: string; surname: string };
  pharmacy_inventory?: { drug_name: string };
  profiles?: { full_name: string };
}

interface LedgerRow {
  movement_type: "purchase" | "dispense";
  movement_id: number;
  inventory_id: number;
  drug_name: string;
  strength?: string | null;
  form?: string | null;
  unit?: string | null;
  quantity_change: number;
  unit_price: number;
  line_total: number;
  movement_date: string;
  created_at: string;
  patient_mrn?: number | null;
  patient_name?: string | null;
  vendor_name?: string | null;
  staff_id?: string | null;
  staff_name?: string | null;
  reference_id?: number | null;
  reference_note?: string | null;
}

const S: Record<string, React.CSSProperties> = {
  page: { fontFamily: "system-ui,-apple-system,sans-serif", background: "#f4f6f9", minHeight: "100%" },
  banner: {
    background: "var(--theme-accent-dark)", borderBottom: "1px solid var(--theme-accent)",
    padding: "20px 24px", display: "flex", flexWrap: "wrap" as const,
    justifyContent: "space-between", alignItems: "flex-start", gap: "16px",
  },
  bannerEyebrow: { fontSize: "10px", color: "var(--theme-accent-bg)", fontFamily: "monospace", textTransform: "uppercase" as const, letterSpacing: "0.08em", marginBottom: "4px" },
  bannerTitle: { fontSize: "18px", fontWeight: 600, color: "#f6f8fa", margin: "0 0 4px" },
  bannerSub: { fontSize: "12px", color: "#f0f2f5" },
  tabBar: { display: "flex", background: "rgba(0, 0, 0, 0.18)", border: "1px solid rgba(255, 255, 255, 0.25)", borderRadius: "8px", padding: "3px", gap: "2px", flexWrap: "wrap" as const },
  tab: (active: boolean, color = "var(--theme-accent)"): React.CSSProperties => ({
    padding: "6px 14px", borderRadius: "6px", border: "none", fontSize: "12px",
    fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", gap: "6px",
    background: active ? color : "transparent",
    color: active ? "#fcfdfe" : "#8a96a5",
    transition: "all 0.15s",
  }),
  body: { padding: "24px" },
  card: { background: "#fcfdfe", border: "0.5px solid #dee4eb", borderRadius: "10px", overflow: "hidden" },
  cardHeader: {
    padding: "12px 16px", background: "#f6f8fa", borderBottom: "0.5px solid #dee4eb",
    display: "flex", alignItems: "center", flexWrap: "wrap" as const, justifyContent: "space-between", gap: "10px",
  },
  cardHeaderLabel: { fontSize: "11px", fontWeight: 600, color: "#5d6b7c", textTransform: "uppercase" as const, letterSpacing: "0.06em" },
  sectionHead: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "20px", paddingBottom: "16px", borderBottom: "0.5px solid #dee4eb", flexWrap: "wrap" as const, gap: "12px" },
  sectionTitle: { fontSize: "14px", fontWeight: 600, color: "#26313e", margin: "0 0 4px" },
  sectionSub: { fontSize: "12px", color: "#5d6b7c", margin: 0 },
  btnPrimary: (color = "var(--theme-accent)"): React.CSSProperties => ({
    padding: "7px 14px", background: color, border: "none", borderRadius: "7px",
    color: "#fcfdfe", fontSize: "12px", fontWeight: 600, cursor: "pointer",
    display: "flex", alignItems: "center", gap: "6px",
  }),
  btnGhost: {
    padding: "7px 14px", background: "#fcfdfe", border: "0.5px solid #dee4eb",
    borderRadius: "7px", color: "#3c4b5c", fontSize: "12px", cursor: "pointer",
    display: "flex", alignItems: "center", gap: "6px",
  },
  label: { display: "block", fontSize: "11px", color: "#5d6b7c", marginBottom: "4px", fontWeight: 500 },
  input: {
    width: "100%", padding: "8px 10px", background: "#f6f8fa",
    border: "0.5px solid #c9d2dc", borderRadius: "7px",
    fontSize: "13px", color: "#26313e", outline: "none", boxSizing: "border-box" as const,
  },
  th: { padding: "9px 12px", textAlign: "left" as const, fontSize: "10px", fontWeight: 700, color: "#8a96a5", textTransform: "uppercase" as const, letterSpacing: "0.05em", borderBottom: "0.5px solid #dee4eb" },
  td: { padding: "10px 12px", fontSize: "12.5px", color: "#26313e", borderBottom: "0.5px solid #eef1f5" },
};

const emptyPurchaseLine = (): PurchaseLine => ({ inventory_id: "", quantity: "", unit_cost: "", batch_number: "", expiry_date: "" });

export default function PharmacyManager({ currentUser }: PharmacyManagerProps) {
  const [activeTab, setActiveTab] = useState<"inventory" | "vendors" | "purchases" | "dispense" | "ledger">("inventory");
  const canManageStock = currentUser?.role === "pharmacy" || currentUser?.role === "admin";

  // --- Shared data ---
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const flash = (msg: string, isError = false) => {
    if (isError) { setErrorMsg(msg); setTimeout(() => setErrorMsg(null), 4000); }
    else { setSuccessMsg(msg); setTimeout(() => setSuccessMsg(null), 3000); }
  };

  const fetchInventory = async () => {
    const { data, error } = await supabase.from("pharmacy_inventory").select("*").order("drug_name", { ascending: true });
    if (!error && data) setInventory(data as InventoryItem[]);
  };

  const fetchVendors = async () => {
    const { data, error } = await supabase.from("pharmacy_vendors").select("*").order("name", { ascending: true });
    if (!error && data) setVendors(data as Vendor[]);
  };

  useEffect(() => {
    setIsLoading(true);
    Promise.all([fetchInventory(), fetchVendors()]).finally(() => setIsLoading(false));
  }, []);

  // ---------------------------------------------------------------------
  // INVENTORY TAB
  // ---------------------------------------------------------------------
  const [isAddingDrug, setIsAddingDrug] = useState(false);
  const [drugForm, setDrugForm] = useState({
    drug_name: "", generic_name: "", category: "", form: "Tablet", strength: "",
    unit: "unit", reorder_level: "0", unit_price: "", default_vendor_id: "",
  });

  const resetDrugForm = () => setDrugForm({ drug_name: "", generic_name: "", category: "", form: "Tablet", strength: "", unit: "unit", reorder_level: "0", unit_price: "", default_vendor_id: "" });

  // When "+ New Drug" is clicked from a specific purchase line, this holds
  // that line's index so the newly-created drug gets auto-selected into it.
  const [pendingLineForNewDrug, setPendingLineForNewDrug] = useState<number | null>(null);

  const handleAddDrug = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!drugForm.drug_name.trim()) { flash("Drug name is required.", true); return; }
    try {
      const { data, error } = await supabase.from("pharmacy_inventory").insert({
        drug_name: drugForm.drug_name.trim(),
        generic_name: drugForm.generic_name.trim() || null,
        category: drugForm.category.trim() || null,
        form: drugForm.form,
        strength: drugForm.strength.trim() || null,
        unit: drugForm.unit,
        reorder_level: parseFloat(drugForm.reorder_level) || 0,
        unit_price: parseFloat(drugForm.unit_price) || 0,
        default_vendor_id: drugForm.default_vendor_id ? Number(drugForm.default_vendor_id) : null,
        created_by: currentUser?.id || null,
      }).select().single();
      if (error) throw new Error(error.message);
      flash(`"${drugForm.drug_name}" added to inventory.`);
      resetDrugForm();
      setIsAddingDrug(false);
      await fetchInventory();
      if (pendingLineForNewDrug !== null && data) {
        updatePurchaseLine(pendingLineForNewDrug, "inventory_id", String(data.id));
        setPendingLineForNewDrug(null);
      }
    } catch (err: any) {
      console.error("Add drug failed:", err);
      flash(`Could not add drug: ${err.message || "Unknown error"}`, true);
    }
  };

  // Shared fields for the "add a drug" form — used both on the Inventory
  // tab and inline from a Purchases line item, so the two stay in sync.
  const drugFormFields = (
    <>
      <div><label style={S.label}>Drug Name *</label><input required style={S.input} value={drugForm.drug_name} onChange={e => setDrugForm({ ...drugForm, drug_name: e.target.value })} placeholder="e.g. Amoxicillin" /></div>
      <div><label style={S.label}>Generic Name</label><input style={S.input} value={drugForm.generic_name} onChange={e => setDrugForm({ ...drugForm, generic_name: e.target.value })} /></div>
      <div><label style={S.label}>Category</label><input style={S.input} value={drugForm.category} onChange={e => setDrugForm({ ...drugForm, category: e.target.value })} placeholder="e.g. Antibiotic" /></div>
      <div>
        <label style={S.label}>Form</label>
        <select style={S.input} value={drugForm.form} onChange={e => setDrugForm({ ...drugForm, form: e.target.value })}>
          {["Tablet", "Syrup", "Injection", "Cream", "Drops", "Inhaler", "Other"].map(f => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>
      <div><label style={S.label}>Strength</label><input style={S.input} value={drugForm.strength} onChange={e => setDrugForm({ ...drugForm, strength: e.target.value })} placeholder="e.g. 500mg" /></div>
      <div><label style={S.label}>Unit</label><input style={S.input} value={drugForm.unit} onChange={e => setDrugForm({ ...drugForm, unit: e.target.value })} placeholder="box, bottle, strip..." /></div>
      <div><label style={S.label}>Reorder Level</label><input type="number" min="0" style={S.input} value={drugForm.reorder_level} onChange={e => setDrugForm({ ...drugForm, reorder_level: e.target.value })} /></div>
      <div><label style={S.label}>Price Charged to Patient ($) *</label><input required type="number" min="0" step="0.01" style={S.input} value={drugForm.unit_price} onChange={e => setDrugForm({ ...drugForm, unit_price: e.target.value })} /></div>
      <div>
        <label style={S.label}>Default Vendor</label>
        <select style={S.input} value={drugForm.default_vendor_id} onChange={e => setDrugForm({ ...drugForm, default_vendor_id: e.target.value })}>
          <option value="">None</option>
          {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </div>
      <div style={{ gridColumn: "1/-1", display: "flex", gap: "8px" }}>
        <button type="submit" style={S.btnPrimary()}><Plus size={12} /> Save Drug</button>
        <button type="button" style={S.btnGhost} onClick={() => { setIsAddingDrug(false); setPendingLineForNewDrug(null); resetDrugForm(); }}>Cancel</button>
      </div>
    </>
  );

  // ---------------------------------------------------------------------
  // VENDORS TAB
  // ---------------------------------------------------------------------
  const [isAddingVendor, setIsAddingVendor] = useState(false);
  const [vendorForm, setVendorForm] = useState({ name: "", contact_person: "", phone: "", email: "", address: "", notes: "" });

  const handleAddVendor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vendorForm.name.trim()) { flash("Vendor name is required.", true); return; }
    try {
      const { error } = await supabase.from("pharmacy_vendors").insert({
        name: vendorForm.name.trim(),
        contact_person: vendorForm.contact_person.trim() || null,
        phone: vendorForm.phone.trim() || null,
        email: vendorForm.email.trim() || null,
        address: vendorForm.address.trim() || null,
        notes: vendorForm.notes.trim() || null,
        created_by: currentUser?.id || null,
      });
      if (error) throw new Error(error.message);
      flash(`Vendor "${vendorForm.name}" added.`);
      setVendorForm({ name: "", contact_person: "", phone: "", email: "", address: "", notes: "" });
      setIsAddingVendor(false);
      fetchVendors();
    } catch (err: any) {
      console.error("Add vendor failed:", err);
      flash(`Could not add vendor: ${err.message || "Unknown error"}`, true);
    }
  };

  // ---------------------------------------------------------------------
  // PURCHASES TAB
  // ---------------------------------------------------------------------
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [purchaseVendorId, setPurchaseVendorId] = useState("");
  const [purchaseInvoiceNo, setPurchaseInvoiceNo] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [purchaseLines, setPurchaseLines] = useState<PurchaseLine[]>([emptyPurchaseLine()]);
  const [isSavingPurchase, setIsSavingPurchase] = useState(false);

  const fetchPurchases = async () => {
    const { data, error } = await supabase
      .from("pharmacy_purchases")
      .select("*, pharmacy_vendors(name)")
      .order("purchase_date", { ascending: false })
      .limit(25);
    if (!error && data) setPurchases(data as any);
  };

  useEffect(() => { if (activeTab === "purchases") fetchPurchases(); }, [activeTab]);

  const updatePurchaseLine = (idx: number, field: keyof PurchaseLine, value: string) => {
    setPurchaseLines(prev => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  };

  const handleSavePurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!purchaseVendorId) { flash("Select a vendor.", true); return; }
    const validLines = purchaseLines.filter(l => l.inventory_id && parseFloat(l.quantity) > 0 && parseFloat(l.unit_cost) >= 0);
    if (validLines.length === 0) { flash("Add at least one valid line item (drug, quantity, cost).", true); return; }

    setIsSavingPurchase(true);
    try {
      const { data: purchase, error: purchaseErr } = await supabase
        .from("pharmacy_purchases")
        .insert({
          vendor_id: Number(purchaseVendorId),
          invoice_number: purchaseInvoiceNo.trim() || null,
          purchase_date: purchaseDate,
          created_by: currentUser?.id || null,
        })
        .select()
        .single();
      if (purchaseErr || !purchase) throw new Error(purchaseErr?.message || "Could not create purchase.");

      for (const line of validLines) {
        const { error: lineErr } = await supabase.from("pharmacy_purchase_items").insert({
          purchase_id: purchase.id,
          inventory_id: Number(line.inventory_id),
          quantity: parseFloat(line.quantity),
          unit_cost: parseFloat(line.unit_cost),
          batch_number: line.batch_number.trim() || null,
          expiry_date: line.expiry_date || null,
        });
        if (lineErr) throw new Error(lineErr.message);
      }

      flash("Purchase recorded and stock updated.");
      setPurchaseVendorId(""); setPurchaseInvoiceNo(""); setPurchaseLines([emptyPurchaseLine()]);
      fetchPurchases();
      fetchInventory();
    } catch (err: any) {
      flash(err.message || "Could not record purchase.", true);
    } finally {
      setIsSavingPurchase(false);
    }
  };

  // ---------------------------------------------------------------------
  // DISPENSE TAB
  // ---------------------------------------------------------------------
  const canDispense = ["nurse", "pharmacy", "doctor", "admin"].includes(currentUser?.role || "");
  const [patientQuery, setPatientQuery] = useState("");
  const [patientResults, setPatientResults] = useState<PatientLite[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientLite | null>(null);
  const [dispenseInventoryId, setDispenseInventoryId] = useState("");
  const [dispenseQty, setDispenseQty] = useState("1");
  const [dispenseNotes, setDispenseNotes] = useState("");
  const [isDispensing, setIsDispensing] = useState(false);
  const [recentDispenses, setRecentDispenses] = useState<DispenseRow[]>([]);

  const fetchRecentDispenses = async () => {
    const { data, error } = await supabase
      .from("pharmacy_dispenses")
      .select("*, patients(first_name, surname), pharmacy_inventory(drug_name), profiles(full_name)")
      .order("dispensed_at", { ascending: false })
      .limit(20);
    if (!error && data) setRecentDispenses(data as any);
  };

  useEffect(() => { if (activeTab === "dispense") fetchRecentDispenses(); }, [activeTab]);

  useEffect(() => {
    const q = patientQuery.trim();
    if (q.length < 2) { setPatientResults([]); return; }
    const t = setTimeout(async () => {
      const { data, error } = await supabase
        .from("patients")
        .select("mrn, first_name, surname")
        .or(`first_name.ilike.%${q}%,surname.ilike.%${q}%`)
        .limit(8);
      if (!error && data) setPatientResults(data as PatientLite[]);
    }, 250);
    return () => clearTimeout(t);
  }, [patientQuery]);

  const selectedDrug = inventory.find(i => i.id === Number(dispenseInventoryId));

  const handleDispense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatient) { flash("Select a patient first.", true); return; }
    if (!dispenseInventoryId || !selectedDrug) { flash("Select a drug to dispense.", true); return; }
    const qty = parseFloat(dispenseQty);
    if (!qty || qty <= 0) { flash("Enter a valid quantity.", true); return; }

    setIsDispensing(true);
    try {
      const { error } = await supabase.from("pharmacy_dispenses").insert({
        patient_mrn: selectedPatient.mrn,
        inventory_id: selectedDrug.id,
        quantity: qty,
        unit_price: selectedDrug.unit_price,
        dispensed_by: currentUser?.id || null,
        notes: dispenseNotes.trim() || null,
      });
      if (error) throw new Error(error.message);
      flash(`Dispensed ${qty} × ${selectedDrug.drug_name} to ${selectedPatient.first_name} ${selectedPatient.surname} — charged $${(qty * selectedDrug.unit_price).toFixed(2)}.`);
      setDispenseQty("1"); setDispenseNotes(""); setDispenseInventoryId("");
      fetchInventory();
      fetchRecentDispenses();
    } catch (err: any) {
      flash(err.message || "Could not dispense medicine (check stock levels).", true);
    } finally {
      setIsDispensing(false);
    }
  };

  // ---------------------------------------------------------------------
  // LEDGER TAB — combined stock-in (purchases) / stock-out (dispenses) log
  // ---------------------------------------------------------------------
  const [ledgerRows, setLedgerRows] = useState<LedgerRow[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerDrugId, setLedgerDrugId] = useState("");
  const [ledgerDateFrom, setLedgerDateFrom] = useState("");
  const [ledgerDateTo, setLedgerDateTo] = useState("");
  const [ledgerPatientQuery, setLedgerPatientQuery] = useState("");

  const fetchLedger = async (overrides?: { drugId?: string; dateFrom?: string; dateTo?: string; patientQuery?: string }) => {
    const drugId = overrides?.drugId ?? ledgerDrugId;
    const dateFrom = overrides?.dateFrom ?? ledgerDateFrom;
    const dateTo = overrides?.dateTo ?? ledgerDateTo;
    const patientQuery = overrides?.patientQuery ?? ledgerPatientQuery;
    setLedgerLoading(true);
    try {
      let query = supabase
        .from("pharmacy_ledger")
        .select("*")
        .order("movement_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(300);
      if (drugId) query = query.eq("inventory_id", Number(drugId));
      if (dateFrom) query = query.gte("movement_date", dateFrom);
      if (dateTo) query = query.lte("movement_date", dateTo);
      if (patientQuery.trim()) query = query.ilike("patient_name", `%${patientQuery.trim()}%`);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      setLedgerRows((data || []) as LedgerRow[]);
    } catch (err: any) {
      flash(err.message || "Could not load the ledger.", true);
    } finally {
      setLedgerLoading(false);
    }
  };

  useEffect(() => { if (activeTab === "ledger") fetchLedger(); }, [activeTab]);

  const clearLedgerFilters = () => {
    setLedgerDrugId(""); setLedgerDateFrom(""); setLedgerDateTo(""); setLedgerPatientQuery("");
    fetchLedger({ drugId: "", dateFrom: "", dateTo: "", patientQuery: "" });
  };

  return (
    <div style={S.page}>
      {/* Banner */}
      <div style={S.banner}>
        <div>
          <div style={S.bannerEyebrow}>Pharmacy · Inventory & Dispensing</div>
          <h1 style={S.bannerTitle}>Pharmacy Department</h1>
          <p style={S.bannerSub}>Manage stock, vendors, purchases, and medicine charged to patients.</p>
        </div>
        <div style={S.tabBar}>
          <button style={S.tab(activeTab === "inventory")} onClick={() => setActiveTab("inventory")}><Package size={13} /> Inventory</button>
          <button style={S.tab(activeTab === "vendors")} onClick={() => setActiveTab("vendors")}><Truck size={13} /> Vendors</button>
          <button style={S.tab(activeTab === "purchases")} onClick={() => setActiveTab("purchases")}><ShoppingCart size={13} /> Purchases</button>
          <button style={S.tab(activeTab === "dispense")} onClick={() => setActiveTab("dispense")}><Syringe size={13} /> Dispense</button>
          <button style={S.tab(activeTab === "ledger")} onClick={() => setActiveTab("ledger")}><History size={13} /> Ledger</button>
        </div>
      </div>

      <div style={S.body}>
        {errorMsg && (
          <div style={{ background: "#fdecec", border: "0.5px solid #f3b8b8", color: "#9c2f2f", padding: "10px 14px", borderRadius: "8px", fontSize: "12.5px", marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
            <AlertCircle size={14} /> {errorMsg}
          </div>
        )}
        {successMsg && (
          <div style={{ background: "#e7f5ee", border: "0.5px solid #a9dfc4", color: "#1f6b45", padding: "10px 14px", borderRadius: "8px", fontSize: "12.5px", marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px" }}>
            <Check size={14} /> {successMsg}
          </div>
        )}

        {/* ---------------- INVENTORY ---------------- */}
        {activeTab === "inventory" && (
          <div style={S.card}>
            <div style={S.cardHeader}>
              <span style={S.cardHeaderLabel}>Drug Catalog & Stock Levels ({inventory.length})</span>
              <div style={{ display: "flex", gap: "8px" }}>
                <button style={S.btnGhost} onClick={fetchInventory}><RefreshCw size={12} /> Refresh</button>
                {canManageStock && (
                  <button style={S.btnPrimary()} onClick={() => { setPendingLineForNewDrug(null); setIsAddingDrug(v => !v); }}>
                    <Plus size={12} /> {isAddingDrug ? "Cancel" : "Add Drug"}
                  </button>
                )}
              </div>
            </div>

            {isAddingDrug && canManageStock && (
              <form onSubmit={handleAddDrug} style={{ padding: "16px", borderBottom: "0.5px solid #dee4eb", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
                {drugFormFields}
              </form>
            )}

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>
                  <th style={S.th}>Drug</th><th style={S.th}>Form / Strength</th>
                  <th style={S.th}>Stock</th><th style={S.th}>Reorder At</th>
                  <th style={S.th}>Price</th><th style={S.th}>Vendor</th>
                </tr></thead>
                <tbody>
                  {inventory.map(item => {
                    const low = item.quantity_on_hand <= item.reorder_level;
                    const vendor = vendors.find(v => v.id === item.default_vendor_id);
                    return (
                      <tr key={item.id}>
                        <td style={S.td}>
                          <div style={{ fontWeight: 600 }}>{item.drug_name}</div>
                          {item.generic_name && <div style={{ fontSize: "10.5px", color: "#8a96a5" }}>{item.generic_name}</div>}
                        </td>
                        <td style={S.td}>{item.form}{item.strength ? ` · ${item.strength}` : ""}</td>
                        <td style={S.td}>
                          <span style={{ fontWeight: 700, color: low ? "#c0392b" : "#26313e" }}>{item.quantity_on_hand}</span>
                          <span style={{ color: "#8a96a5" }}> {item.unit}</span>
                          {low && <span style={{ marginLeft: "6px", fontSize: "9px", fontWeight: 700, color: "#c0392b", background: "#fdecec", padding: "1px 6px", borderRadius: "10px", textTransform: "uppercase" }}>Low</span>}
                        </td>
                        <td style={S.td}>{item.reorder_level}</td>
                        <td style={S.td}>${item.unit_price.toFixed(2)}</td>
                        <td style={S.td}>{vendor?.name || "—"}</td>
                      </tr>
                    );
                  })}
                  {inventory.length === 0 && !isLoading && (
                    <tr><td colSpan={6} style={{ ...S.td, textAlign: "center", color: "#8a96a5", padding: "24px" }}>No drugs in the catalog yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ---------------- VENDORS ---------------- */}
        {activeTab === "vendors" && (
          <div style={S.card}>
            <div style={S.cardHeader}>
              <span style={S.cardHeaderLabel}>Suppliers ({vendors.length})</span>
              {canManageStock && (
                <button style={S.btnPrimary()} onClick={() => setIsAddingVendor(v => !v)}>
                  <Plus size={12} /> {isAddingVendor ? "Cancel" : "Add Vendor"}
                </button>
              )}
            </div>

            {isAddingVendor && canManageStock && (
              <form onSubmit={handleAddVendor} style={{ padding: "16px", borderBottom: "0.5px solid #dee4eb", display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "12px" }}>
                <div><label style={S.label}>Vendor Name *</label><input required style={S.input} value={vendorForm.name} onChange={e => setVendorForm({ ...vendorForm, name: e.target.value })} /></div>
                <div><label style={S.label}>Contact Person</label><input style={S.input} value={vendorForm.contact_person} onChange={e => setVendorForm({ ...vendorForm, contact_person: e.target.value })} /></div>
                <div><label style={S.label}>Phone</label><input style={S.input} value={vendorForm.phone} onChange={e => setVendorForm({ ...vendorForm, phone: e.target.value })} placeholder="+961 3 123 456" /></div>
                <div><label style={S.label}>Email</label><input type="email" style={S.input} value={vendorForm.email} onChange={e => setVendorForm({ ...vendorForm, email: e.target.value })} /></div>
                <div style={{ gridColumn: "1/-1" }}><label style={S.label}>Address</label><input style={S.input} value={vendorForm.address} onChange={e => setVendorForm({ ...vendorForm, address: e.target.value })} /></div>
                <div style={{ gridColumn: "1/-1" }}><label style={S.label}>Notes</label><input style={S.input} value={vendorForm.notes} onChange={e => setVendorForm({ ...vendorForm, notes: e.target.value })} /></div>
                <div style={{ gridColumn: "1/-1" }}><button type="submit" style={S.btnPrimary()}><Plus size={12} /> Save Vendor</button></div>
              </form>
            )}

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr><th style={S.th}>Name</th><th style={S.th}>Contact</th><th style={S.th}>Phone</th><th style={S.th}>Email</th></tr></thead>
                <tbody>
                  {vendors.map(v => (
                    <tr key={v.id}>
                      <td style={S.td}>{v.name}</td>
                      <td style={S.td}>{v.contact_person || "—"}</td>
                      <td style={S.td}>{v.phone || "—"}</td>
                      <td style={S.td}>{v.email || "—"}</td>
                    </tr>
                  ))}
                  {vendors.length === 0 && (
                    <tr><td colSpan={4} style={{ ...S.td, textAlign: "center", color: "#8a96a5", padding: "24px" }}>No vendors added yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ---------------- PURCHASES ---------------- */}
        {activeTab === "purchases" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {canManageStock && (
              <div style={S.card}>
                <div style={S.cardHeader}><span style={S.cardHeaderLabel}>Record a New Purchase (Stock-In)</span></div>
                {inventory.length === 0 && (
                  <div style={{ margin: "16px", padding: "12px 14px", background: "#fff7e6", border: "0.5px solid #f0c987", borderRadius: "8px", fontSize: "12.5px", color: "#8a5a00", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
                    <span>Your drug catalog is empty. Use the <strong>+</strong> next to a line item below to add a new drug on the spot, or add one in Inventory first.</span>
                    <button type="button" onClick={() => setActiveTab("inventory")} style={S.btnGhost}>Go to Inventory</button>
                  </div>
                )}
                {isAddingDrug && canManageStock && (
                  <form onSubmit={handleAddDrug} style={{ margin: "16px", padding: "14px", background: "#f6f8fa", border: "0.5px solid #dee4eb", borderRadius: "8px", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
                    <div style={{ gridColumn: "1/-1", fontSize: "11px", fontWeight: 600, color: "#5d6b7c", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      New Drug{pendingLineForNewDrug !== null ? ` — will be selected on line ${pendingLineForNewDrug + 1}` : ""}
                    </div>
                    {drugFormFields}
                  </form>
                )}
                <form onSubmit={handleSavePurchase} style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "14px" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
                    <div>
                      <label style={S.label}>Vendor *</label>
                      <select required style={S.input} value={purchaseVendorId} onChange={e => setPurchaseVendorId(e.target.value)}>
                        <option value="">Select vendor...</option>
                        {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                      </select>
                    </div>
                    <div><label style={S.label}>Invoice #</label><input style={S.input} value={purchaseInvoiceNo} onChange={e => setPurchaseInvoiceNo(e.target.value)} /></div>
                    <div><label style={S.label}>Purchase Date</label><input type="date" style={S.input} value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)} /></div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <label style={S.label}>Line Items</label>
                    {purchaseLines.map((line, idx) => (
                      <div key={idx} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr auto", gap: "8px", alignItems: "end" }}>
                        <div style={{ display: "flex", gap: "6px" }}>
                          <select style={{ ...S.input, flex: 1 }} value={line.inventory_id} onChange={e => updatePurchaseLine(idx, "inventory_id", e.target.value)}>
                            <option value="">Select drug...</option>
                            {inventory.map(i => <option key={i.id} value={i.id}>{i.drug_name}{i.strength ? ` (${i.strength})` : ""}</option>)}
                          </select>
                          {canManageStock && (
                            <button
                              type="button"
                              title="Add a new drug to the catalog"
                              onClick={() => { setPendingLineForNewDrug(idx); setIsAddingDrug(true); }}
                              style={{ ...S.btnGhost, padding: "8px", flex: "0 0 auto" }}
                            >
                              <Plus size={13} />
                            </button>
                          )}
                        </div>
                        <input style={S.input} type="number" min="0" step="1" placeholder="Qty" value={line.quantity} onChange={e => updatePurchaseLine(idx, "quantity", e.target.value)} />
                        <input style={S.input} type="number" min="0" step="0.01" placeholder="Unit cost" value={line.unit_cost} onChange={e => updatePurchaseLine(idx, "unit_cost", e.target.value)} />
                        <input style={S.input} placeholder="Batch #" value={line.batch_number} onChange={e => updatePurchaseLine(idx, "batch_number", e.target.value)} />
                        <input style={S.input} type="date" value={line.expiry_date} onChange={e => updatePurchaseLine(idx, "expiry_date", e.target.value)} />
                        <button type="button" onClick={() => setPurchaseLines(prev => prev.filter((_, i) => i !== idx))} style={{ background: "none", border: "none", color: "#c0392b", cursor: "pointer" }}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                    <button type="button" onClick={() => setPurchaseLines(prev => [...prev, emptyPurchaseLine()])} style={{ ...S.btnGhost, alignSelf: "flex-start" }}>
                      <Plus size={12} /> Add Line
                    </button>
                  </div>

                  <div>
                    <button type="submit" disabled={isSavingPurchase} style={S.btnPrimary()}>
                      <ShoppingCart size={12} /> {isSavingPurchase ? "Saving..." : "Save Purchase & Update Stock"}
                    </button>
                  </div>
                </form>
              </div>
            )}

            <div style={S.card}>
              <div style={S.cardHeader}><span style={S.cardHeaderLabel}>Recent Purchases</span></div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr><th style={S.th}>Date</th><th style={S.th}>Vendor</th><th style={S.th}>Invoice #</th><th style={S.th}>Total</th></tr></thead>
                  <tbody>
                    {purchases.map(p => (
                      <tr key={p.id}>
                        <td style={S.td}>{p.purchase_date}</td>
                        <td style={S.td}>{p.pharmacy_vendors?.name || "—"}</td>
                        <td style={S.td}>{p.invoice_number || "—"}</td>
                        <td style={S.td}>${Number(p.total_amount).toFixed(2)}</td>
                      </tr>
                    ))}
                    {purchases.length === 0 && (
                      <tr><td colSpan={4} style={{ ...S.td, textAlign: "center", color: "#8a96a5", padding: "24px" }}>No purchases recorded yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ---------------- DISPENSE ---------------- */}
        {activeTab === "dispense" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {!canDispense ? (
              <div style={{ ...S.card, padding: "24px", textAlign: "center", color: "#8a96a5", fontSize: "12.5px" }}>
                Your role isn't permitted to dispense and charge medicine.
              </div>
            ) : (
              <div style={S.card}>
                <div style={S.cardHeader}><span style={S.cardHeaderLabel}>Dispense Medicine to a Patient</span></div>
                {inventory.length === 0 && (
                  <div style={{ margin: "16px", padding: "12px 14px", background: "#fff7e6", border: "0.5px solid #f0c987", borderRadius: "8px", fontSize: "12.5px", color: "#8a5a00", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
                    <span>No drugs in the catalog yet. Add one in Inventory before dispensing.</span>
                    <button type="button" onClick={() => setActiveTab("inventory")} style={S.btnGhost}>Go to Inventory</button>
                  </div>
                )}
                <form onSubmit={handleDispense} style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "14px" }}>
                  <div>
                    <label style={S.label}>Patient *</label>
                    {selectedPatient ? (
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "#f6f8fa", border: "0.5px solid #c9d2dc", borderRadius: "7px", padding: "8px 10px" }}>
                        <User size={13} style={{ color: "var(--theme-accent)" }} />
                        <span style={{ fontSize: "13px", fontWeight: 600 }}>{selectedPatient.first_name} {selectedPatient.surname}</span>
                        <span style={{ fontSize: "11px", color: "#8a96a5" }}>MRN: {selectedPatient.mrn}</span>
                        <button type="button" onClick={() => { setSelectedPatient(null); setPatientQuery(""); }} style={{ marginLeft: "auto", background: "none", border: "none", color: "#8a96a5", cursor: "pointer" }}>
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <div style={{ position: "relative" }}>
                        <div style={{ position: "relative" }}>
                          <Search size={13} style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: "#8a96a5" }} />
                          <input style={{ ...S.input, paddingLeft: "30px" }} placeholder="Search patient by name..." value={patientQuery} onChange={e => setPatientQuery(e.target.value)} />
                        </div>
                        {patientResults.length > 0 && (
                          <div style={{ position: "absolute", zIndex: 10, top: "100%", left: 0, right: 0, background: "#fff", border: "0.5px solid #dee4eb", borderRadius: "7px", marginTop: "4px", boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}>
                            {patientResults.map(p => (
                              <button
                                key={p.mrn}
                                type="button"
                                onClick={() => { setSelectedPatient(p); setPatientResults([]); }}
                                style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 10px", background: "none", border: "none", cursor: "pointer", fontSize: "12.5px" }}
                              >
                                {p.first_name} {p.surname} <span style={{ color: "#8a96a5" }}>· MRN: {p.mrn}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "12px" }}>
                    <div>
                      <label style={S.label}>Drug *</label>
                      <select required style={S.input} value={dispenseInventoryId} onChange={e => setDispenseInventoryId(e.target.value)}>
                        <option value="">Select drug...</option>
                        {inventory.map(i => (
                          <option key={i.id} value={i.id} disabled={i.quantity_on_hand <= 0}>
                            {i.drug_name}{i.strength ? ` (${i.strength})` : ""} — {i.quantity_on_hand} {i.unit} in stock — ${i.unit_price.toFixed(2)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label style={S.label}>Quantity *</label>
                      <input required type="number" min="1" step="1" style={S.input} value={dispenseQty} onChange={e => setDispenseQty(e.target.value)} />
                    </div>
                  </div>

                  {selectedDrug && (
                    <div style={{ fontSize: "12.5px", color: "#5d6b7c", background: "#f6f8fa", border: "0.5px solid #dee4eb", borderRadius: "7px", padding: "8px 10px" }}>
                      Will charge <strong style={{ color: "#26313e" }}>${(selectedDrug.unit_price * (parseFloat(dispenseQty) || 0)).toFixed(2)}</strong> to this patient's chart.
                    </div>
                  )}

                  <div>
                    <label style={S.label}>Notes (optional)</label>
                    <input style={S.input} value={dispenseNotes} onChange={e => setDispenseNotes(e.target.value)} placeholder="e.g. Post-visit prescription fulfillment" />
                  </div>

                  <div>
                    <button type="submit" disabled={isDispensing} style={S.btnPrimary()}>
                      <Syringe size={12} /> {isDispensing ? "Charging..." : "Dispense & Charge Patient"}
                    </button>
                  </div>
                </form>
              </div>
            )}

            <div style={S.card}>
              <div style={S.cardHeader}><span style={S.cardHeaderLabel}>Recent Dispenses</span></div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr><th style={S.th}>When</th><th style={S.th}>Patient</th><th style={S.th}>Drug</th><th style={S.th}>Qty</th><th style={S.th}>Charged</th><th style={S.th}>By</th></tr></thead>
                  <tbody>
                    {recentDispenses.map(d => (
                      <tr key={d.id}>
                        <td style={S.td}>{new Date(d.dispensed_at).toLocaleString("en-GB")}</td>
                        <td style={S.td}>{d.patients ? `${d.patients.first_name} ${d.patients.surname}` : `MRN ${d.patient_mrn}`}</td>
                        <td style={S.td}>{d.pharmacy_inventory?.drug_name || "—"}</td>
                        <td style={S.td}>{d.quantity}</td>
                        <td style={S.td}>${Number(d.line_total).toFixed(2)}</td>
                        <td style={S.td}>{d.profiles?.full_name || "—"}</td>
                      </tr>
                    ))}
                    {recentDispenses.length === 0 && (
                      <tr><td colSpan={6} style={{ ...S.td, textAlign: "center", color: "#8a96a5", padding: "24px" }}>No dispenses logged yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ---------------- LEDGER ---------------- */}
        {activeTab === "ledger" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div style={S.card}>
              <div style={S.cardHeader}><span style={S.cardHeaderLabel}><Filter size={11} style={{ verticalAlign: "-1px", marginRight: "4px" }} />Filter Movement</span></div>
              <div style={{ padding: "16px", display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1.2fr auto auto", gap: "10px", alignItems: "end" }}>
                <div>
                  <label style={S.label}>Drug</label>
                  <select style={S.input} value={ledgerDrugId} onChange={e => setLedgerDrugId(e.target.value)}>
                    <option value="">All drugs</option>
                    {inventory.map(i => <option key={i.id} value={i.id}>{i.drug_name}{i.strength ? ` (${i.strength})` : ""}</option>)}
                  </select>
                </div>
                <div><label style={S.label}>From</label><input type="date" style={S.input} value={ledgerDateFrom} onChange={e => setLedgerDateFrom(e.target.value)} /></div>
                <div><label style={S.label}>To</label><input type="date" style={S.input} value={ledgerDateTo} onChange={e => setLedgerDateTo(e.target.value)} /></div>
                <div>
                  <label style={S.label}>Patient</label>
                  <input style={S.input} placeholder="Search patient name..." value={ledgerPatientQuery} onChange={e => setLedgerPatientQuery(e.target.value)} />
                </div>
                <button type="button" style={S.btnPrimary()} onClick={() => fetchLedger()}>
                  <Filter size={12} /> Apply
                </button>
                <button type="button" style={S.btnGhost} onClick={clearLedgerFilters}>Clear</button>
              </div>
            </div>

            <div style={S.card}>
              <div style={S.cardHeader}>
                <span style={S.cardHeaderLabel}>Movement Log ({ledgerRows.length}{ledgerRows.length >= 300 ? "+" : ""})</span>
                <button style={S.btnGhost} onClick={() => fetchLedger()}><RefreshCw size={12} /> Refresh</button>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr>
                    <th style={S.th}>Date</th><th style={S.th}>Type</th><th style={S.th}>Drug</th>
                    <th style={S.th}>Qty</th><th style={S.th}>Unit Price</th><th style={S.th}>Total</th>
                    <th style={S.th}>Vendor / Patient</th><th style={S.th}>Staff</th><th style={S.th}>Note</th>
                  </tr></thead>
                  <tbody>
                    {ledgerRows.map(row => (
                      <tr key={`${row.movement_type}-${row.movement_id}`}>
                        <td style={S.td}>{row.movement_date}</td>
                        <td style={S.td}>
                          <span style={{
                            fontSize: "9px", fontWeight: 700, padding: "2px 8px", borderRadius: "10px", textTransform: "uppercase" as const,
                            background: row.movement_type === "purchase" ? "#e7f5ee" : "#fdecec",
                            color: row.movement_type === "purchase" ? "#1f6b45" : "#9c2f2f",
                          }}>
                            {row.movement_type === "purchase" ? "Stock In" : "Stock Out"}
                          </span>
                        </td>
                        <td style={S.td}>
                          <div style={{ fontWeight: 600 }}>{row.drug_name}</div>
                          {row.strength && <div style={{ fontSize: "10.5px", color: "#8a96a5" }}>{row.strength}</div>}
                        </td>
                        <td style={S.td}>
                          <span style={{ fontWeight: 700, color: row.quantity_change > 0 ? "#1f6b45" : "#9c2f2f" }}>
                            {row.quantity_change > 0 ? "+" : ""}{row.quantity_change}
                          </span>
                          <span style={{ color: "#8a96a5" }}> {row.unit}</span>
                        </td>
                        <td style={S.td}>${Number(row.unit_price).toFixed(2)}</td>
                        <td style={S.td}>${Number(row.line_total).toFixed(2)}</td>
                        <td style={S.td}>
                          {row.movement_type === "purchase"
                            ? (row.vendor_name || "—")
                            : (row.patient_name ? `${row.patient_name} · MRN ${row.patient_mrn}` : `MRN ${row.patient_mrn}`)}
                        </td>
                        <td style={S.td}>{row.staff_name || "—"}</td>
                        <td style={S.td}>{row.reference_note || "—"}</td>
                      </tr>
                    ))}
                    {ledgerRows.length === 0 && (
                      <tr><td colSpan={9} style={{ ...S.td, textAlign: "center", color: "#8a96a5", padding: "24px" }}>{ledgerLoading ? "Loading..." : "No stock movement matches these filters."}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
