import React, { useState, useEffect, useRef } from "react";
import {
  Users, Search, UserPlus, Phone, Mail, Calendar, Heart, Shield,
  Activity, Clock, FileText, AlertCircle, RefreshCw, Plus, Edit3,
  ChevronRight, ClipboardList, Database, Code, Check, Copy, UserCheck,
  BookOpen, PlusCircle, X, Save, Lock, Printer, Share2, Trash2, Sliders, Sparkles,
  TrendingUp, ArrowUpRight, ArrowDownRight,
  Bold, Italic, Underline, Strikethrough, List, ListOrdered, AlignLeft, AlignCenter, AlignRight, AlignJustify, Type, Palette, RotateCcw, RotateCw, ChevronDown,
  FlaskConical, Camera, Mic, MicOff, Syringe, Ban, MapPin, Pill, PhoneCall, MessageSquare, CalendarClock
} from "lucide-react";
import DOMPurify from "dompurify";
import { supabase, authedFetch } from "../supabaseClient";
import { useVisitNotes, VisitNote } from "./VisitNotesManager";
import { staticTests, ClinicalTest } from "./TestManager";

// The clinical note editor is a contentEditable div that reads/writes raw
// HTML (rich text formatting, pasted content, inserted templates). Every
// string that reaches the DOM through .innerHTML or execCommand('insertHTML')
// must go through this first — otherwise a note saved by one user (or a
// malicious/compromised account) can run script in the next viewer's session.
const sanitizeHtml = (html: string): string => DOMPurify.sanitize(html || "");

// Standard routes of administration for a medication order (doctor picks one
// when placing the order; shown to the nurse on the Care Queue so they know
// exactly how to give the dose).
export const MEDICATION_ROUTES = [
  "Oral", "Sublingual", "Buccal", "IV", "IM", "Subcutaneous", "Intradermal",
  "Topical", "Transdermal", "Inhalation", "Nasal", "Rectal", "Vaginal",
  "Ophthalmic", "Otic", "NG Tube",
];

// The Orders tab used to be a structured Medication/Task form (order_type
// toggle, dose/route/frequency fields). It's been replaced by free-text
// quick entry (type an order, hit Enter, sign it) but the old form's code is
// left in place and simply not rendered, in case it's ever needed again.
const SHOW_LEGACY_ORDER_FORM = false;

// Internal patient model
export interface Patient {
  id: string;
  mrn?: number;
  name: string;
  first_name?: string;
  father_name?: string;
  surname?: string;
  birth_date: string;
  gender: string;
  phone: string;
  email: string;
  history: string;
  address?: string;
  created_at?: string;
  mother_name?: string;
  national_id?: string;
  nationality?: string;
  place_of_birth?: string;
  marital_status?: string;
  occupation?: string;
  education_level?: string;
  emergency_contact_name?: string;
  emergency_contact_relation?: string;
  emergency_contact_phone?: string;
  insurance_provider?: string;
  insurance_number?: string;
  blood_type?: string;
}

// Date helpers: the app displays and accepts dates as dd/mm/yyyy, stores ISO yyyy-mm-dd
export const isoToDDMM = (iso: string): string => {
  const m = (iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso || "");
};

export const ddmmToIso = (s: string): string | null => {
  const m = (s || "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d || y < 1900 || dt > new Date()) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
};

// ---- Fuzzy name matching -----------------------------------------------------
// Tolerates skipped middle names ("malek kaddoura" matches "Malek Ahmad
// Kaddoura") and small typos ("malik" matches "Malek") so data entry can
// always double-check for an existing patient before creating a new one.
const editDistanceLte = (a: string, b: string, max: number): boolean => {
  if (Math.abs(a.length - b.length) > max) return false;
  const dp: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    let rowMin = dp[0];
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
      if (dp[j] < rowMin) rowMin = dp[j];
    }
    if (rowMin > max) return false;
  }
  return dp[b.length] <= max;
};

export const tokenMatchesWord = (token: string, word: string): boolean => {
  if (!token || !word) return false;
  if (word.startsWith(token) || token.startsWith(word)) return true;
  if (word.includes(token)) return true;
  const max = token.length >= 6 ? 2 : token.length >= 4 ? 1 : 0;
  return max > 0 && editDistanceLte(token, word, max);
};

export const nameMatchesQuery = (name: string, query: string): boolean => {
  const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const words = name.toLowerCase().split(/\s+/).filter(Boolean);
  return tokens.every(t => words.some(w => tokenMatchesWord(t, w)));
};

// Capitalizes the first letter of every word: "malek ahmad kaddoura" -> "Malek Ahmad Kaddoura"
export const toTitleCase = (s: string): string =>
  s
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map(w => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");

export interface PatientLab {
  id: string;
  patient_name: string;
  lab_type: string; // e.g. "GLYCAEMIC", "LIPIDS", "KIDNEY", "THYROID"
  panel_name: string; // e.g. "HbA1c & Glycaemic Control", "Lipid Profile Panel", "Renal Function Screen", "Thyroid Stimulating Panel"
  value_display: string; // e.g. "8.2% (DANGER)", "145 mg/dL (HIGH)", etc.
  status: "Normal" | "Warning" | "Danger";
  collected_at: string;
  facility_name?: string;
  components: {
    name: string;
    value: string;
    unit: string;
    reference_range: string;
    flag: "NORMAL" | "HIGH" | "LOW" | "ABNORMAL";
  }[];
}

export interface PatientPhoto {
  id: number;
  patient_mrn: number;
  storage_path: string;
  category: "lab_document" | "condition_photo" | "other";
  caption: string | null;
  taken_at: string;
  uploaded_by: string | null;
  signedUrl?: string; // resolved client-side, not stored in the DB
}

export interface ArchivedNote {
  id: string;
  title: string;
  dateStr: string;
  timeStr: string;
  author: string;
  department: string;
  timePeriod: "6 Months Ago" | "3 Years Ago" | "5 Years Ago";
  content: string;
}

// Archived notes now come exclusively from the real "visit_notes" table -- no mock data.
export const getArchivedNotesForPatient = (_patientName: string): ArchivedNote[] => {
  return [];
};

// Patient lab data now comes exclusively from the real "patient_lab_results"
// table in Supabase -- no mock/demo fallback data is kept in the app.
const getFallbackLabsForPatient = (_patientName: string): PatientLab[] => {
  return [];
};

// The AI document extractor names the same clinical value slightly
// differently between uploads -- e.g. "RBC" on one report, "RBC Count" on
// another -- which used to fragment trend tracking into two unrelated
// parameters instead of one continuous series. This maps known variants to
// one canonical name before anything gets saved, so future uploads merge
// correctly. (Not exhaustive -- new variants Claude produces that aren't
// listed here will still fragment; add them here as they come up.)
const LAB_PARAMETER_ALIASES: Record<string, string> = {
  "rbc count": "RBC", "rbc": "RBC", "red blood cell count": "RBC", "red blood cells": "RBC",
  "wbc count": "WBC", "wbc": "WBC", "white blood cell count": "WBC", "white blood cells": "WBC",
  "hemoglobin": "Hemoglobin (Hb)", "hemoglobin (hb)": "Hemoglobin (Hb)", "hgb": "Hemoglobin (Hb)", "hb": "Hemoglobin (Hb)",
  "hematocrit": "Hematocrit (Hct)", "hematocrit (hct)": "Hematocrit (Hct)", "hct": "Hematocrit (Hct)",
  "platelet count": "Platelet Count", "platelets": "Platelet Count", "plt": "Platelet Count",
  "mcv": "MCV", "mean corpuscular volume": "MCV",
  "mch": "MCH", "mean corpuscular hemoglobin": "MCH",
  "mchc": "MCHC", "mean corpuscular hemoglobin concentration": "MCHC",
  "rdw": "RDW", "red cell distribution width": "RDW",
  "neutrophils": "Neutrophils", "neutrophil count": "Neutrophils",
  "lymphocytes": "Lymphocytes", "lymphocyte count": "Lymphocytes",
  "monocytes": "Monocytes", "monocyte count": "Monocytes",
  "eosinophils": "Eosinophils", "eosinophil count": "Eosinophils",
  "basophils": "Basophils", "basophil count": "Basophils",
  "glucose": "Glucose", "blood glucose": "Glucose", "fasting glucose": "Glucose",
  "creatinine": "Creatinine", "serum creatinine": "Creatinine",
  "cholesterol": "Cholesterol", "total cholesterol": "Cholesterol",
};

const normalizeLabParameterName = (rawName: string): string => {
  const trimmed = (rawName || "").trim().replace(/\s+/g, " ");
  const key = trimmed.toLowerCase();
  return LAB_PARAMETER_ALIASES[key] || trimmed;
};

// Helper to format any date string or Date object into DD/MM/YYYY format
export const formatDateDDMMYYYY = (dateVal: string | Date | undefined | null): string => {
  if (!dateVal) return "N/A";

  let dateObj: Date;
  if (dateVal instanceof Date) {
    dateObj = dateVal;
  } else {
    const strVal = String(dateVal).trim();
    // Match YYYY-MM-DD
    const parts = strVal.split("T")[0].split("-");
    if (parts.length === 3) {
      const [year, month, day] = parts;
      if (year.length === 4) {
        return `${day}/${month}/${year}`;
      }
    }
    dateObj = new Date(strVal);
  }

  if (isNaN(dateObj.getTime())) return String(dateVal);

  const day = String(dateObj.getDate()).padStart(2, '0');
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const year = dateObj.getFullYear();
  return `${day}/${month}/${year}`;
};

// Helper to decode a numeric BIGINT MRN back to our desired alpha-numeric representation (e.g. 131101112 -> Mk01112)
export const formatMRNDisplay = (mrnVal: string | number | undefined | null): string => {
  if (!mrnVal) return "";
  return String(mrnVal).trim();
};

export const stripHtmlTags = (str: string | undefined | null): string => {
  if (!str) return "";
  return str
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .trim();
};

export interface ClinicalTemplate {
  id: string;
  title: string;
  description: string;
  icon: string;
  content: string;
}

export const noteTemplates: ClinicalTemplate[] = [
  {
    id: "soap",
    title: "SOAP Clinical Template",
    description: "Subjective, Objective, Assessment, Plan",
    icon: "📋",
    content: "<strong>[SUBJECTIVE]</strong><br>Patient presents for routine follow up.<br><br><strong>[OBJECTIVE]</strong><br>BP: 120/80 mmHg, HR: 72 bpm.<br><br><strong>[ASSESSMENT]</strong><br>Anxiety levels assessed; periodic monitoring recommended.<br><br><strong>[PLAN]</strong><br>Follow up in 2 weeks."
  },
  {
    id: "ros",
    title: "Review of Systems (ROS)",
    description: "Comprehensive ROS questionnaire checklist",
    icon: "🫁",
    content: "<strong>[REVIEW OF SYSTEMS (ROS)]</strong><br>• Constitutional: Normal appetite, no fatigue<br>• Cardiorespiratory: No chest pain, no dyspnea<br>• Psychiatric: Occasional worries on edge, no acute panics"
  },
  {
    id: "phys",
    title: "Physical Exam Outline",
    description: "Standard physical exam structure",
    icon: "🩺",
    content: "<strong>[PHYSICAL EXAM OUTLINE]</strong><br>• General: Well groomed, cooperative, anxious affect<br>• HEENT: Normocephalic, pupils equal & reactive<br>• Abdomen: Soft, non-tender, active bowel sounds"
  },
  {
    id: "gad",
    title: "GAD-7 Assessment Summary",
    description: "GAD-7 Anxiety Scale results sheet",
    icon: "📊",
    content: "<strong>[GAD-7 ANXIETY SCALE SUMMARY]</strong><br>Patient assessed using GAD-7 Anxiety scale.<br>Indicator Result: Minimal anxiety.<br>Anxiety Severity Category: periodic monitor suggested."
  },
  {
    id: "followup",
    title: "Care Follow-Up Checklist",
    description: "Post-care guidelines and tracking",
    icon: "📅",
    content: "<strong>[FOLLOW-UP CLINICAL ACTIONS]</strong><br>• Return to clinic in 14 days.<br>• Check serum glucose / lipid panels.<br>• Administer blood pressure logs daily."
  },
  {
    id: "cardio",
    title: "Cardiology Follow-up",
    description: "Cardiac specific review template",
    icon: "❤️",
    content: "<strong>[CHIEF COMPLAINT]</strong><br>Chest pain or shortness of breath updates:<br><br><strong>[CARDIAC ASSESSMENT]</strong><br>Heart sounds:<br>ECG findings (if available):<br><br><strong>[ASSESSMENT & PLAN]</strong><br>Hypertension / CAD management details:<br>Medication adjustments:"
  }
];

// Read-only GAD-7 clinical form visualization for the summary log
const ClinicalFormReadOnlyView: React.FC<{ data: any }> = ({ data }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  if (!data || data.formId !== "gad-7") return null;

  const totalScore = data.totalScore || 0;
  const severity = data.severity || "Minimal anxiety";
  const interpretation = data.interpretation || "";
  const answers = data.answers || {};

  // GAD-7 Questions to map names
  const questionsList = [
    { id: "q1", text: "Feeling nervous, anxious, or on edge" },
    { id: "q2", text: "Not being able to stop or control worrying" },
    { id: "q3", text: "Worrying too much about different things" },
    { id: "q4", text: "Trouble relaxing" },
    { id: "q5", text: "Being so restless that it's hard to sit still" },
    { id: "q6", text: "Becoming easily annoyed or irritable" },
    { id: "q7", text: "Feeling afraid, as if something awful might happen" }
  ];

  const getOptionLabel = (val: number) => {
    if (val === 0) return "Not at all";
    if (val === 1) return "Several days";
    if (val === 2) return "More than half the days";
    if (val === 3) return "Nearly every day";
    return "N/A";
  };

  const getSeverityBadgeColor = (score: number) => {
    if (score >= 15) return "bg-red-50 text-red-700 border-red-200";
    if (score >= 10) return "bg-amber-50 text-amber-700 border-amber-200";
    if (score >= 5) return "bg-blue-50 text-blue-700 border-blue-200";
    return "bg-green-50 text-green-700 border-green-200";
  };

  return (
    <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-4 my-2 text-xs font-sans">
      <div className="flex justify-between items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
            <ClipboardList className="h-4 w-4" />
          </div>
          <div>
            <span className="font-bold text-slate-800 text-[11px] uppercase tracking-wide block">
              {data.title || "Clinical Assessment"}
            </span>
            <span className="text-[10px] text-slate-400 font-medium block">
              Completed on: {data.completedAt ? formatDateDDMMYYYY(data.completedAt) : "N/A"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold border uppercase tracking-wider ${getSeverityBadgeColor(totalScore)}`}>
            {severity} ({totalScore} / 21)
          </span>
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-[10px] text-indigo-600 hover:text-indigo-800 font-bold px-2 py-1 bg-white hover:bg-slate-100 border border-slate-200 rounded transition-colors cursor-pointer"
          >
            {isExpanded ? "Hide Responses" : "View Detailed Responses"}
          </button>
        </div>
      </div>

      {interpretation && (
        <p className="text-[11px] text-slate-500 mt-2 bg-white/65 p-2 rounded-lg border border-slate-100 leading-relaxed">
          <strong>Interpretation:</strong> {interpretation}
        </p>
      )}

      {isExpanded && (
        <div className="mt-3 border-t border-slate-200/60 pt-3 flex flex-col gap-2.5 animate-in fade-in slide-in-from-top-1 duration-100">
          <div className="text-[9px] uppercase tracking-wider font-bold text-slate-400">Question-by-Question Diagnostics:</div>
          <div className="grid grid-cols-1 gap-2">
            {questionsList.map((q, idx) => {
              const score = answers[q.id];
              return (
                <div key={q.id} className="flex justify-between items-center gap-4 bg-white/40 hover:bg-white/90 p-2 rounded-lg border border-slate-100/50 transition-colors">
                  <span className="text-slate-600 font-medium leading-normal">
                    {idx + 1}. {q.text}
                  </span>
                  <span className={`px-2 py-0.5 rounded font-mono font-black text-[10px] whitespace-nowrap ${
                    score !== undefined && score !== null
                      ? score >= 2 ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700"
                      : "bg-slate-100 text-slate-400"
                  }`}>
                    Score: {score !== undefined && score !== null ? `${score} (${getOptionLabel(score)})` : "Unanswered"}
                  </span>
                </div>
              );
            })}
          </div>

          {answers.difficulty && (
            <div className="mt-1 bg-amber-50/50 border border-amber-100/65 rounded-lg p-2.5">
              <span className="font-semibold text-slate-700 block text-[10px] uppercase tracking-wider mb-1 font-sans">Functional Impact:</span>
              <p className="text-slate-600 italic">"{answers.difficulty}"</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

interface AppointmentRow {
  id: string;
  patient_name: string;
  doctor_name: string;
  room: string;
  schedule_time: string;
  duration_hours: number;
  location_id?: number | null;
  status?: "scheduled" | "checked-in" | "completed";
}

interface MedicalRecordRow {
  id: string;
  patient_name: string;
  raw_text_backup: string;
  extracted_json: any;
  created_at: string;
}

export default function PatientsDirectory({
  externalSearchQuery = "",
  onClearExternalSearch,
  currentUser
}: {
  externalSearchQuery?: string;
  onClearExternalSearch?: () => void;
  currentUser?: { id?: string; username: string; name: string; role: string } | null;
} = {}) {
  const { openNoteWindow, activeWindows } = useVisitNotes();

  // State Management
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [searchQuery, setSearchQuery] = useState(externalSearchQuery);
  const [isNewPatientModal, setIsNewPatientModal] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  // Find-or-register step shown before New Patient registration, so a
  // duplicate chart can be caught (and opened) before filling out the whole
  // form. Adapted from SIMA's Admit Patient modal, minus the admission-request
  // half — see docs/sima-interface.md.
  const [isFindOrRegisterModal, setIsFindOrRegisterModal] = useState(false);
  const [findOrRegisterSearch, setFindOrRegisterSearch] = useState("");

  // Sync external search query
  useEffect(() => {
    if (externalSearchQuery !== undefined) {
      setSearchQuery(externalSearchQuery);
      if (externalSearchQuery.trim() !== "") {
        setIsSearchOpen(true);
      }
    }
  }, [externalSearchQuery]);

  // Loading & error flags
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saveLoading, setSaveLoading] = useState(false);

  // Lists of records for the selected patient
  const [patientAppointments, setPatientAppointments] = useState<AppointmentRow[]>([]);
  const [activeAdmission, setActiveAdmission] = useState<any | null>(null);
  const [patientRecords, setPatientRecords] = useState<MedicalRecordRow[]>([]);
  const [patientNotes, setPatientNotes] = useState<VisitNote[]>([]);
  const [isDataLoading, setIsDataLoading] = useState(false);

  // SIMA Clinical Workspace States
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<"chart_review" | "synopsis" | "assessment" | "plan" | "orders" | "medications" | "contact_log">("chart_review");

  // Doctor's Orders (medication or nursing task, recurring) for the selected patient
  const [patientOrders, setPatientOrders] = useState<any[]>([]);
  const [isOrdersLoading, setIsOrdersLoading] = useState(false);
  const [isAddingOrder, setIsAddingOrder] = useState(false);
  const [orderInventory, setOrderInventory] = useState<any[]>([]);
  const [orderForm, setOrderForm] = useState({
    order_type: "medication" as "medication" | "task",
    drug_input: "",
    dose_quantity: "",
    route: "",
    task_name: "",
    instructions: "",
    is_one_time: false,
    frequency_hours: "8",
    total_occurrences: "",
  });
  const [orderError, setOrderError] = useState<string | null>(null);

  const fetchPatientOrders = async (patientMrn: number | string) => {
    setIsOrdersLoading(true);
    try {
      const { data, error } = await supabase
        .from("patient_orders")
        .select("*, pharmacy_inventory(drug_name, unit, strength), profiles!ordered_by(full_name), patient_order_administrations(due_at, completed_at, status, recorded_value, completed_by, profiles!completed_by(full_name))")
        .eq("patient_mrn", patientMrn)
        .order("created_at", { ascending: false });
      if (error) throw error;
      setPatientOrders(data || []);
    } catch (err: any) {
      console.error("Could not load patient orders:", err.message);
    } finally {
      setIsOrdersLoading(false);
    }
  };

  const fetchOrderInventory = async () => {
    const { data } = await supabase.from("pharmacy_inventory").select("id, drug_name, strength, unit, unit_price").order("drug_name", { ascending: true });
    setOrderInventory(data || []);
  };

  const resetOrderForm = () => setOrderForm({ order_type: "medication", drug_input: "", dose_quantity: "", route: "", task_name: "", instructions: "", is_one_time: false, frequency_hours: "8", total_occurrences: "" });

  // Shared label used both for the drug datalist suggestions and for matching
  // what the doctor typed back to a catalog item on submit.
  const getDrugLabel = (i: any) => `${i.drug_name}${i.strength ? ` (${i.strength})` : ""}`;

  // Mirrors the nurse's Care Queue "next due" calculation, so the doctor sees
  // the same overdue/due-now/upcoming picture when reviewing an order here.
  const computeOrderNextDue = (order: any): Date => {
    const done = (order.patient_order_administrations || []).filter((a: any) => a.status === "done");
    if (done.length === 0) return new Date(order.start_at);
    const lastDue = done.reduce((latest: Date, a: any) => {
      const d = new Date(a.due_at);
      return d > latest ? d : latest;
    }, new Date(0));
    return new Date(lastDue.getTime() + order.frequency_hours * 3600000);
  };

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatient) return;
    setOrderError(null);

    const patientMrn = parseInt(String(selectedPatient.mrn || selectedPatient.id), 10);
    if (!patientMrn) { setOrderError("Could not resolve this patient's MRN."); return; }

    if (orderForm.order_type === "medication" && !orderForm.drug_input.trim()) {
      setOrderError("Type or select a drug for a medication order."); return;
    }
    if (orderForm.order_type === "task" && !orderForm.task_name.trim()) {
      setOrderError("Name the task (e.g. \"Vitals Check\")."); return;
    }
    // One-time orders don't need a real recurrence interval -- they're given
    // once and then auto-complete after a single administration. Store a
    // harmless placeholder frequency (the DB requires frequency_hours > 0,
    // but it's never used again since total_occurrences will be 1).
    const freq = orderForm.is_one_time ? 24 : parseFloat(orderForm.frequency_hours);
    if (!orderForm.is_one_time && (!freq || freq <= 0)) { setOrderError("Enter a valid frequency in hours."); return; }

    // If what the doctor typed matches a catalog drug exactly, keep linking
    // inventory_id (so stock deduction on administration keeps working).
    // Otherwise it's a drug the pharmacy doesn't stock -- save it as free text.
    const matchedInventory = orderForm.order_type === "medication"
      ? orderInventory.find((i: any) => getDrugLabel(i).trim().toLowerCase() === orderForm.drug_input.trim().toLowerCase())
      : null;

    try {
      const { error } = await supabase.from("patient_orders").insert({
        patient_mrn: patientMrn,
        ordered_by: currentUser?.id || null,
        order_type: orderForm.order_type,
        inventory_id: orderForm.order_type === "medication" && matchedInventory ? matchedInventory.id : null,
        custom_drug_name: orderForm.order_type === "medication" && !matchedInventory ? orderForm.drug_input.trim() : null,
        dose_quantity: orderForm.order_type === "medication" ? parseFloat(orderForm.dose_quantity) || 1 : null,
        route: orderForm.order_type === "medication" ? (orderForm.route || null) : null,
        task_name: orderForm.order_type === "task" ? orderForm.task_name.trim() : null,
        instructions: orderForm.instructions.trim() || null,
        frequency_hours: freq,
        total_occurrences: orderForm.is_one_time ? 1 : (orderForm.total_occurrences ? parseInt(orderForm.total_occurrences, 10) : null),
      });
      if (error) throw new Error(error.message);
      triggerToast("Order placed. It will appear on the nurse's Care Queue.");
      resetOrderForm();
      setIsAddingOrder(false);
      fetchPatientOrders(patientMrn);
    } catch (err: any) {
      setOrderError(err.message || "Could not place the order.");
    }
  };

  const handleDiscontinueOrder = async (orderId: number) => {
    if (!confirm("Discontinue this order? It will stop appearing on the nurse's queue.")) return;
    try {
      const { error } = await supabase
        .from("patient_orders")
        .update({ status: "discontinued", discontinued_at: new Date().toISOString(), discontinued_by: currentUser?.id || null })
        .eq("id", orderId);
      if (error) throw new Error(error.message);
      triggerToast("Order discontinued.");
      if (selectedPatient) fetchPatientOrders(selectedPatient.mrn || selectedPatient.id);
    } catch (err: any) {
      triggerToast(`Could not discontinue order: ${err.message}`);
    }
  };

  // ─── Free-text quick order entry (draft → sign workflow) ──────────────────
  // The old structured Medication/Task form above (isAddingOrder / orderForm /
  // handleCreateOrder) is kept in the code but no longer rendered -- see
  // SHOW_LEGACY_ORDER_FORM below. Doctors now just type an order in plain
  // English and hit Enter; it's captured immediately as a `draft` row (drafts
  // are invisible to the nurse Care Queue and pharmacy, which only ever query
  // status = 'active'). Drafts sit in the middle column where they can be
  // edited or discarded, then signed -- individually or all at once -- which
  // is what actually activates them.
  const [quickOrderText, setQuickOrderText] = useState("");
  const [isSubmittingQuickOrder, setIsSubmittingQuickOrder] = useState(false);
  const quickOrderInputRef = useRef<HTMLInputElement | null>(null);
  const [editingDraftId, setEditingDraftId] = useState<number | null>(null);
  const [editingDraftText, setEditingDraftText] = useState("");
  const [signingOrderIds, setSigningOrderIds] = useState<Set<number>>(new Set());

  const draftOrders = patientOrders.filter((o: any) => o.status === "draft");
  const signedOrders = patientOrders.filter((o: any) => o.status !== "draft");

  // Best-effort parse of a free-text order into the same structured shape the
  // old form used to produce, so the Care Queue's due-time math and pharmacy
  // stock deduction keep working without the doctor filling out any fields.
  // Falls back to a plain nursing task (task_name = the raw text) whenever it
  // can't confidently detect a medication -- always produces a valid shape.
  const ROUTE_ALIASES: Record<string, string> = {
    po: "Oral", oral: "Oral", sl: "Sublingual", sublingual: "Sublingual",
    buccal: "Buccal", iv: "IV", im: "IM", sc: "Subcutaneous", subq: "Subcutaneous",
    subcutaneous: "Subcutaneous", id: "Intradermal", intradermal: "Intradermal",
    top: "Topical", topical: "Topical", td: "Transdermal", transdermal: "Transdermal",
    inh: "Inhalation", inhalation: "Inhalation", nasal: "Nasal", pr: "Rectal",
    rectal: "Rectal", pv: "Vaginal", vaginal: "Vaginal", ophthalmic: "Ophthalmic",
    otic: "Otic", ng: "NG Tube",
  };

  const parseFreeTextOrder = (rawInput: string, inventory: any[]) => {
    const text = rawInput.trim();
    const lower = text.toLowerCase();

    let route: string | null = null;
    for (const [alias, full] of Object.entries(ROUTE_ALIASES)) {
      if (new RegExp(`\\b${alias}\\b`, "i").test(text)) { route = full; break; }
    }

    let frequency_hours = 24; // one-time-like placeholder until a pattern is found
    let total_occurrences: number | null = null;
    const qhMatch = lower.match(/\bq(\d{1,2})h\b/) || lower.match(/every\s+(\d{1,2})\s*(?:hours|hrs|h)\b/);
    if (qhMatch) {
      frequency_hours = parseInt(qhMatch[1], 10);
    } else if (/\b(bid|twice\s+daily|twice\s+a\s+day)\b/.test(lower)) {
      frequency_hours = 12;
    } else if (/\b(tid|three\s+times\s+daily)\b/.test(lower)) {
      frequency_hours = 8;
    } else if (/\b(qid|four\s+times\s+daily)\b/.test(lower)) {
      frequency_hours = 6;
    } else if (/\b(qd|once\s+daily|once\s+a\s+day|daily)\b/.test(lower)) {
      frequency_hours = 24;
    }
    const occMatch = lower.match(/\bx\s*(\d{1,3})\b/) || lower.match(/for\s+(\d{1,3})\s+doses/);
    if (occMatch) total_occurrences = parseInt(occMatch[1], 10);

    let inventory_id: number | null = null;
    let matchedName: string | null = null;
    for (const inv of inventory) {
      if (inv.drug_name && lower.includes(String(inv.drug_name).toLowerCase())) {
        inventory_id = inv.id;
        matchedName = inv.drug_name;
        break;
      }
    }

    const doseMatch = text.match(/(\d+(?:\.\d+)?)\s*(mg|mcg|g|ml|tab(?:let)?s?|cap(?:sule)?s?|unit(?:s)?|puff(?:s)?|drop(?:s)?)\b/i);
    const looksLikeMedication = !!(inventory_id || doseMatch || /\b(tab|tablet|capsule|mg|ml|injection|syrup)\b/i.test(lower));

    if (looksLikeMedication) {
      return {
        order_type: "medication" as const,
        inventory_id,
        custom_drug_name: inventory_id ? null : (matchedName || text),
        dose_quantity: doseMatch ? parseFloat(doseMatch[1]) : 1,
        route,
        task_name: null,
        instructions: text,
        frequency_hours,
        total_occurrences,
      };
    }
    return {
      order_type: "task" as const,
      inventory_id: null,
      custom_drug_name: null,
      dose_quantity: null,
      route: null,
      task_name: text.slice(0, 200),
      instructions: null,
      frequency_hours,
      total_occurrences,
    };
  };

  // Builds a readable fallback string for orders that predate this feature
  // (no raw_order_text saved), so "Renew" always has sensible text to prefill.
  const reconstructOrderText = (order: any): string => {
    if (order.raw_order_text) return order.raw_order_text;
    const freqPart = order.total_occurrences === 1 ? "one-time" : `every ${order.frequency_hours}h${order.total_occurrences ? ` x${order.total_occurrences}` : ""}`;
    if (order.order_type === "medication") {
      const name = order.pharmacy_inventory?.drug_name || order.custom_drug_name || "medication";
      return `${name} ${order.dose_quantity || ""} ${order.route || ""} ${freqPart} ${order.instructions || ""}`.replace(/\s+/g, " ").trim();
    }
    return `${order.task_name || "task"} ${freqPart} ${order.instructions || ""}`.replace(/\s+/g, " ").trim();
  };

  const handleQuickOrderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatient || !quickOrderText.trim() || isSubmittingQuickOrder) return;
    const patientMrn = parseInt(String(selectedPatient.mrn || selectedPatient.id), 10);
    if (!patientMrn) { setOrderError("Could not resolve this patient's MRN."); return; }

    setIsSubmittingQuickOrder(true);
    setOrderError(null);
    const raw = quickOrderText.trim();
    const parsed = parseFreeTextOrder(raw, orderInventory);
    try {
      const { error } = await supabase.from("patient_orders").insert({
        patient_mrn: patientMrn,
        ordered_by: currentUser?.id || null,
        status: "draft",
        raw_order_text: raw,
        ...parsed,
      });
      if (error) throw new Error(error.message);
      setQuickOrderText("");
      fetchPatientOrders(patientMrn);
    } catch (err: any) {
      setOrderError(err.message || "Could not capture this order.");
    } finally {
      setIsSubmittingQuickOrder(false);
      // Keep typing without having to re-click the box -- the input briefly
      // loses focus while disabled mid-submit, so grab it back explicitly.
      requestAnimationFrame(() => quickOrderInputRef.current?.focus());
    }
  };

  const handleStartEditDraft = (order: any) => {
    setEditingDraftId(order.id);
    setEditingDraftText(order.raw_order_text || reconstructOrderText(order));
  };

  const handleSaveEditDraft = async (orderId: number) => {
    if (!editingDraftText.trim() || !selectedPatient) { setEditingDraftId(null); return; }
    const raw = editingDraftText.trim();
    const parsed = parseFreeTextOrder(raw, orderInventory);
    try {
      const { error } = await supabase.from("patient_orders").update({ raw_order_text: raw, ...parsed }).eq("id", orderId);
      if (error) throw new Error(error.message);
      setEditingDraftId(null);
      fetchPatientOrders(selectedPatient.mrn || selectedPatient.id);
    } catch (err: any) {
      triggerToast(`Could not update draft: ${err.message}`);
    }
  };

  const handleSignOrders = async (orderIds: number[]) => {
    if (orderIds.length === 0 || !selectedPatient) return;
    setSigningOrderIds((prev) => new Set([...prev, ...orderIds]));
    try {
      const nowIso = new Date().toISOString();
      const { error } = await supabase
        .from("patient_orders")
        .update({ status: "active", signed_at: nowIso, signed_by: currentUser?.id || null, start_at: nowIso })
        .in("id", orderIds);
      if (error) throw new Error(error.message);
      triggerToast(orderIds.length > 1 ? `${orderIds.length} orders signed.` : "Order signed.");
      fetchPatientOrders(selectedPatient.mrn || selectedPatient.id);
    } catch (err: any) {
      triggerToast(`Could not sign order(s): ${err.message}`);
    } finally {
      setSigningOrderIds((prev) => {
        const next = new Set(prev);
        orderIds.forEach((id) => next.delete(id));
        return next;
      });
    }
  };

  // Prefills the compose box from an existing (signed/discontinued) order so
  // the doctor can quickly renew or tweak it -- review, then hit Enter.
  const handleRenewOrder = (order: any) => {
    setQuickOrderText(reconstructOrderText(order));
  };

  // Current Medications List -- doctor's own med-rec reference list of what
  // the patient is currently taking. Deliberately separate from the
  // nurse-facing standing Orders above: no schedule, no Care Queue
  // involvement, just a simple drug name + dose/route/frequency note that
  // the doctor can add, edit, or delete at any time.
  const [patientMedications, setPatientMedications] = useState<any[]>([]);
  const [isMedsLoading, setIsMedsLoading] = useState(false);
  const [isAddingMedication, setIsAddingMedication] = useState(false);
  const [editingMedId, setEditingMedId] = useState<number | null>(null);
  const [medForm, setMedForm] = useState({ drug_name: "", note: "" });
  const [medError, setMedError] = useState<string | null>(null);

  const fetchPatientMedications = async (patientMrn: number | string) => {
    setIsMedsLoading(true);
    try {
      const { data, error } = await supabase
        .from("patient_medications")
        .select("*, profiles!created_by(full_name)")
        .eq("patient_mrn", patientMrn)
        .order("created_at", { ascending: false });
      if (error) throw error;
      setPatientMedications(data || []);
    } catch (err: any) {
      console.error("Could not load patient medications:", err.message);
    } finally {
      setIsMedsLoading(false);
    }
  };

  const resetMedForm = () => setMedForm({ drug_name: "", note: "" });

  const handleSaveMedication = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatient) return;
    setMedError(null);
    if (!medForm.drug_name.trim()) { setMedError("Enter a drug name."); return; }

    const patientMrn = parseInt(String(selectedPatient.mrn || selectedPatient.id), 10);
    if (!patientMrn) { setMedError("Could not resolve this patient's MRN."); return; }

    try {
      if (editingMedId) {
        const { error } = await supabase
          .from("patient_medications")
          .update({ drug_name: medForm.drug_name.trim(), note: medForm.note.trim() || null })
          .eq("id", editingMedId);
        if (error) throw new Error(error.message);
        triggerToast("Medication updated.");
      } else {
        const { error } = await supabase.from("patient_medications").insert({
          patient_mrn: patientMrn,
          drug_name: medForm.drug_name.trim(),
          note: medForm.note.trim() || null,
          created_by: currentUser?.id || null,
        });
        if (error) throw new Error(error.message);
        triggerToast("Medication added to current list.");
      }
      resetMedForm();
      setEditingMedId(null);
      setIsAddingMedication(false);
      fetchPatientMedications(patientMrn);
    } catch (err: any) {
      setMedError(err.message || "Could not save this medication.");
    }
  };

  const handleEditMedication = (med: any) => {
    setEditingMedId(med.id);
    setMedForm({ drug_name: med.drug_name || "", note: med.note || "" });
    setIsAddingMedication(true);
    setMedError(null);
  };

  const handleCancelMedicationForm = () => {
    resetMedForm();
    setEditingMedId(null);
    setIsAddingMedication(false);
    setMedError(null);
  };

  const handleDeleteMedication = async (medId: number) => {
    if (!confirm("Remove this medication from the patient's current list?")) return;
    try {
      const { error } = await supabase.from("patient_medications").delete().eq("id", medId);
      if (error) throw new Error(error.message);
      triggerToast("Medication removed.");
      if (selectedPatient) fetchPatientMedications(selectedPatient.mrn || selectedPatient.id);
    } catch (err: any) {
      triggerToast(`Could not remove medication: ${err.message}`);
    }
  };

  useEffect(() => {
    if (activeWorkspaceTab === "orders" && selectedPatient) {
      fetchPatientOrders(selectedPatient.mrn || selectedPatient.id);
      fetchOrderInventory();
    }
    if (activeWorkspaceTab === "medications" && selectedPatient) {
      fetchPatientMedications(selectedPatient.mrn || selectedPatient.id);
    }
    if (activeWorkspaceTab === "contact_log" && selectedPatient) {
      fetchContactLog(selectedPatient.mrn || selectedPatient.id);
    }
  }, [activeWorkspaceTab, selectedPatient]);
  const [chartReviewSubTab, setChartReviewSubTab] = useState<"encounters" | "notes" | "labs" | "lab_trends" | "all_labs" | "imaging" | "cardiology" | "procedures" | "surgeries" | "meds" | "note_template" | "media" | "photos">("notes");

  // ── Contact Log ──────────────────────────────────────────────────────────
  // Every non-clinical-note touchpoint with the patient: calls, messages,
  // nurse/secretary/provider contact, and appointment scheduled/rescheduled/
  // cancelled events (those last three are written automatically from the
  // Clinic Calendar). A row can optionally carry a "staff note" -- an
  // internal, addressable note. RLS on staff_notes hides the note content
  // from anyone it isn't routed to (e.g. secretary sees that a nurse logged
  // a contact, but not a clinically-routed note attached to it) -- the
  // embedded select below simply returns null for that nested object when
  // blocked, so no client-side filtering is needed.
  const CONTACT_LOG_TYPE_LABELS: Record<string, string> = {
    nurse_contact: "Nurse Contact",
    provider_contact: "Provider Contact",
    secretary_contact: "Secretary Contact",
    phone_call: "Phone Call",
    message: "Message",
    appointment_scheduled: "Appointment Scheduled",
    appointment_rescheduled: "Appointment Rescheduled",
    appointment_cancelled: "Appointment Cancelled",
  };
  const [contactLog, setContactLog] = useState<any[]>([]);
  const [isContactLogLoading, setIsContactLogLoading] = useState(false);
  const [isLoggingContact, setIsLoggingContact] = useState(false);
  const [clEntryType, setClEntryType] = useState<"nurse_contact" | "provider_contact" | "secretary_contact" | "phone_call" | "message">("phone_call");
  const [clActor, setClActor] = useState<"patient" | "secretary" | "nurse" | "provider" | "admin" | "other">("patient");
  const [clSummary, setClSummary] = useState("");
  const [clAttachNote, setClAttachNote] = useState(false);
  const [clNoteBody, setClNoteBody] = useState("");
  const [clRecipientRole, setClRecipientRole] = useState("");
  const [clRecipientUserId, setClRecipientUserId] = useState("");
  const [clError, setClError] = useState<string | null>(null);
  const [clSaving, setClSaving] = useState(false);
  const [staffDirectory, setStaffDirectory] = useState<{ id: string; full_name: string; role: string }[]>([]);

  const fetchContactLog = async (patientMrn: number | string) => {
    setIsContactLogLoading(true);
    try {
      const { data, error } = await supabase
        .from("patient_contact_log")
        .select("*, profiles!logged_by(full_name), staff_notes(id, body, created_at, created_by)")
        .eq("patient_mrn", patientMrn)
        .order("occurred_at", { ascending: false });
      if (error) throw error;
      setContactLog(data || []);
    } catch (err: any) {
      console.error("Could not load Contact Log:", err.message);
    } finally {
      setIsContactLogLoading(false);
    }
  };

  const openLogContactForm = async () => {
    setClEntryType("phone_call");
    setClActor("patient");
    setClSummary("");
    setClAttachNote(false);
    setClNoteBody("");
    setClRecipientRole("");
    setClRecipientUserId("");
    setClError(null);
    setIsLoggingContact(true);
    if (staffDirectory.length === 0) {
      try {
        const { data, error } = await supabase.from("profiles").select("id, full_name, role").order("full_name");
        if (error) throw error;
        setStaffDirectory(data || []);
      } catch (err) {
        console.warn("Could not load staff directory for the recipient picker:", err);
      }
    }
  };

  const handleLogContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatient) return;
    setClError(null);
    if (!clSummary.trim()) { setClError("Enter a short summary of what happened."); return; }
    if (clAttachNote && !clNoteBody.trim()) { setClError("Enter the note content, or turn off \"Attach a note\"."); return; }

    const patientMrn = parseInt(String(selectedPatient.mrn || selectedPatient.id), 10);
    if (!patientMrn) { setClError("Could not resolve this patient's MRN."); return; }

    setClSaving(true);
    try {
      let staffNoteId: number | null = null;

      if (clAttachNote) {
        const { data: noteData, error: noteErr } = await supabase
          .from("staff_notes")
          .insert({ patient_mrn: patientMrn, body: clNoteBody.trim(), created_by: currentUser?.id || null })
          .select()
          .single();
        if (noteErr) throw new Error(noteErr.message);
        staffNoteId = noteData.id;

        if (clRecipientRole || clRecipientUserId) {
          const { error: recErr } = await supabase.from("staff_note_recipients").insert({
            staff_note_id: staffNoteId,
            recipient_role: clRecipientRole || null,
            recipient_user_id: clRecipientUserId || null,
          });
          if (recErr) throw new Error(recErr.message);
        }
      }

      const { error: logErr } = await supabase.from("patient_contact_log").insert({
        patient_mrn: patientMrn,
        entry_type: clEntryType,
        actor: clActor,
        summary: clSummary.trim(),
        staff_note_id: staffNoteId,
        logged_by: currentUser?.id || null,
      });
      if (logErr) throw new Error(logErr.message);

      triggerToast("Logged to Contact Log.");
      setIsLoggingContact(false);
      fetchContactLog(patientMrn);
    } catch (err: any) {
      setClError(err.message || "Could not save this entry.");
    } finally {
      setClSaving(false);
    }
  };

  // Patient photo timeline (e.g. skin/wound condition photos for follow-up)
  const [patientPhotos, setPatientPhotos] = useState<PatientPhoto[]>([]);
  const [isPhotosLoading, setIsPhotosLoading] = useState(false);
  const [photoUploadError, setPhotoUploadError] = useState<string | null>(null);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [newPhotoCaption, setNewPhotoCaption] = useState("");
  const [allLabsViewMode, setAllLabsViewMode] = useState<"timeline" | "list">("timeline");
  const [selectedLabDate, setSelectedLabDate] = useState<string>("all");
  const [isMyNoteMinimized, setIsMyNoteMinimized] = useState(false);

  // Media Upload & Validation States
  const [isAnalyzingMedia, setIsAnalyzingMedia] = useState(false);
  const [analysisProgressMsg, setAnalysisProgressMsg] = useState("");
  const [validationDocType, setValidationDocType] = useState("Blood Test");
  const [validationReportDate, setValidationReportDate] = useState("");
  const [validationFacility, setValidationFacility] = useState("");
  const [validationLabType, setValidationLabType] = useState<string>("HEMATOLOGY");
  const [validationPanelName, setValidationPanelName] = useState("");
  const [validationComponents, setValidationComponents] = useState<any[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isSavingValidatedLab, setIsSavingValidatedLab] = useState(false);
  const [activeMyNote, setActiveMyNote] = useState<any | null>(null);
  // Note workspace panel opens only when a note is actually being written/edited
  const showNoteWorkspace = activeWorkspaceTab === "chart_review" && chartReviewSubTab === "notes" && !!activeMyNote;
  // Order history right panel (Orders tab): which past order line is expanded
  const [expandedHistoryOrderId, setExpandedHistoryOrderId] = useState<any>(null);
  const [expandedArchiveId, setExpandedArchiveId] = useState<string | null>(null);
  const [customTemplates, setCustomTemplates] = useState<{ id: string; title: string; category: string; content: string }[]>([]);
  const [customTests, setCustomTests] = useState<ClinicalTest[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("gad-7");
  const [gad7Answers, setGad7Answers] = useState<number[]>([0, 0, 0, 0, 0, 0, 0]);
  const [gad7Difficulty, setGad7Difficulty] = useState<string>("Somewhat difficult");
  const [newTemplateTitle, setNewTemplateTitle] = useState<string>("");
  const [newTemplateContent, setNewTemplateContent] = useState<string>("");
  const [newTemplateCategory, setNewTemplateCategory] = useState<string>("General");
  const [newTemplateIcon, setNewTemplateIcon] = useState<string>("📋");

  // Fetch custom templates from database
  const fetchCustomTemplates = async () => {
    try {
      const { data, error } = await supabase
        .from("note_templates")
        .select("*")
        .order("title");
      if (error) throw error;
      if (data && data.length > 0) {
        const mapped = data.map((item: any) => ({
          id: item.id,
          title: item.title,
          category: item.category || "General",
          content: item.content
        }));
        setCustomTemplates(mapped);
      }
    } catch (err: any) {
      console.warn("Could not query 'note_templates' table.", err.message);
    }
  };

  // Fetch custom clinical tests from database or local cache
  const fetchClinicalTests = async () => {
    try {
      const { data, error } = await supabase
        .from("clinical_tests")
        .select("*")
        .order("name");
      if (error) throw error;
      if (data) {
        setCustomTests(data);
      }
    } catch (err: any) {
      console.warn("Could not query 'clinical_tests' table. Loading cached local tests.", err.message);
      const saved = localStorage.getItem("aura_custom_tests");
      if (saved) {
        try {
          setCustomTests(JSON.parse(saved));
        } catch {
          setCustomTests([]);
        }
      }
    }
  };

  // Combine static and custom tests dynamically
  const getCombinedTests = (): ClinicalTest[] => {
    const combined: ClinicalTest[] = [...staticTests];
    customTests.forEach(test => {
      if (!combined.some(c => c.name.toLowerCase() === test.name.toLowerCase())) {
        combined.push(test);
      }
    });
    return combined;
  };

  // Combine static and custom templates dynamically
  const getCombinedTemplates = (): ClinicalTemplate[] => {
    const combined: ClinicalTemplate[] = [...noteTemplates];
    customTemplates.forEach(temp => {
      if (!combined.some(c => c.id === temp.id)) {
        let description = temp.category;
        let icon = "📝";

        // Parse custom serialization format if stored as "Custom|Category/Description|Icon"
        if (temp.category && temp.category.startsWith("Custom|")) {
          const parts = temp.category.split("|");
          description = parts[1] || "Custom Template";
          icon = parts[2] || "📝";
        } else {
          // Fallback categories map
          if (temp.category === "General Practice") icon = "📋";
          else if (temp.category === "Specialist") icon = "🩺";
          else if (temp.category === "Lab Review") icon = "📊";
          else if (temp.category === "Pediatrics") icon = "🫁";
          else if (temp.category === "Cardiology") icon = "❤️";
        }

        combined.push({
          id: temp.id,
          title: temp.title,
          description: description,
          icon: icon,
          content: temp.content
        });
      }
    });
    return combined;
  };

  // Note edit state
  const [activeNoteContent, setActiveNoteContent] = useState("");
  const [activeNoteDiagnosis, setActiveNoteDiagnosis] = useState("");
  const [activeNoteFollowUp, setActiveNoteFollowUp] = useState("");
  const [activeNoteBp, setActiveNoteBp] = useState("");
  const [activeNoteHr, setActiveNoteHr] = useState("");
  const [activeNoteCosign, setActiveNoteCosign] = useState(false);
  const [isNoteSaving, setIsNoteSaving] = useState(false);
  const [isNoteSigned, setIsNoteSigned] = useState(false);
  // Which appointment this note is precharting/documenting -- needed so
  // "Sign Note" can actually finalize it. A note can only go final while its
  // linked appointment is checked-in (enforced by a trigger on visit_notes,
  // see visit_notes_precharting.sql); status is re-read live at save time,
  // so it's fine if this was linked back when the appointment was still
  // just "scheduled."
  const [activeNoteAppointmentId, setActiveNoteAppointmentId] = useState<number | null>(null);
  const [activeNoteAppointmentStatus, setActiveNoteAppointmentStatus] = useState<string | null>(null);
  // Where this encounter actually happened (Main Clinic, Home Visit, etc.) --
  // doctor's own managed list, see LocationsManager.tsx / doctor_locations.
  const [myLocations, setMyLocations] = useState<{ id: number; name: string }[]>([]);
  const [activeNoteLocationId, setActiveNoteLocationId] = useState("");

  // Voice dictation for the note editor (browser's built-in speech
  // recognition -- free, no server round-trip, but only reliably supported
  // in Chrome; iOS Safari doesn't implement it at all).
  const voiceSupported = typeof window !== "undefined" && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  const [isRecordingNote, setIsRecordingNote] = useState(false);
  const [noteVoiceError, setNoteVoiceError] = useState<string | null>(null);
  const noteRecognitionRef = React.useRef<any>(null);
  const isRecordingNoteRef = React.useRef(false);

  const stopNoteRecording = () => {
    isRecordingNoteRef.current = false;
    setIsRecordingNote(false);
    try { noteRecognitionRef.current?.stop(); } catch {}
    noteRecognitionRef.current = null;
  };

  const startNoteRecording = () => {
    const SpeechRecognitionCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      setNoteVoiceError("Voice input isn't supported in this browser. Try Chrome.");
      return;
    }
    if (isNoteSigned) return;
    setNoteVoiceError(null);

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = false; // only commit finalized phrases into the rich-text editor
    recognition.lang = "en-US";

    recognition.onresult = (event: any) => {
      let finalChunk = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) finalChunk += event.results[i][0].transcript;
      }
      const trimmed = finalChunk.trim();
      if (trimmed) {
        const escaped = trimmed.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        appendHtmlContent(escaped + " ");
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error === "no-speech" || event.error === "aborted") return; // benign, keep listening
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setNoteVoiceError("Microphone access was blocked. Allow it in your browser's site settings to dictate.");
      } else {
        setNoteVoiceError("Voice input hit an error and stopped. Tap the mic to try again.");
      }
      stopNoteRecording();
    };

    recognition.onend = () => {
      // Mobile browsers often auto-stop after a short pause of silence --
      // restart transparently unless the user explicitly hit stop.
      if (isRecordingNoteRef.current && noteRecognitionRef.current === recognition) {
        try { recognition.start(); } catch {}
      }
    };

    noteRecognitionRef.current = recognition;
    isRecordingNoteRef.current = true;
    setIsRecordingNote(true);
    try {
      recognition.start();
    } catch {
      setNoteVoiceError("Could not start voice input.");
      stopNoteRecording();
    }
  };

  const toggleNoteRecording = () => {
    if (isRecordingNote) stopNoteRecording();
    else startNoteRecording();
  };

  useEffect(() => {
    return () => {
      isRecordingNoteRef.current = false;
      try { noteRecognitionRef.current?.stop(); } catch {}
    };
  }, []);

  // Slash menu & Shortcuts state for rich note workspace
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const [showBackslashMenu, setShowBackslashMenu] = useState(false);
  const [backslashQuery, setBackslashQuery] = useState("");
  const editorRef = React.useRef<HTMLDivElement>(null);

  // Interpolates placeholders like @NAME@, @AGE@, and @MRN@ with active patient data
  const interpolateTemplate = (content: string) => {
    if (!content) return "";
    let interpolated = content;
    if (selectedPatient) {
      const ageStr = selectedPatient.birth_date ? `${calculateAge(selectedPatient.birth_date)}` : "N/A";
      const mrnStr = selectedPatient.id ? formatMRNDisplay(selectedPatient.mrn) : "N/A";
      interpolated = interpolated
        .replace(/@NAME@/g, selectedPatient.name)
        .replace(/@AGE@/g, ageStr)
        .replace(/@MRN@/g, mrnStr);
    }
    return interpolated;
  };

  // Interactive SIMA Features States
  const [patientLabs, setPatientLabs] = useState<PatientLab[]>([]);
  const [expandedLabId, setExpandedLabId] = useState<string | null>(null);

  // Lab Trends State
  const [selectedTrendCategory, setSelectedTrendCategory] = useState<string>("ALL");
  const [selectedTrendTest, setSelectedTrendTest] = useState<string>("");
  const [hoveredPointIndex, setHoveredPointIndex] = useState<number | null>(null);

  useEffect(() => {
    if (patientLabs && patientLabs.length > 0) {
      const tests = new Set<string>();
      patientLabs.forEach(lab => {
        if (selectedTrendCategory === "ALL" || lab.lab_type === selectedTrendCategory) {
          lab.components?.forEach(c => {
            if (c.name) tests.add(c.name);
          });
        }
      });
      const testList = Array.from(tests);
      if (testList.length > 0) {
        if (!selectedTrendTest || !testList.includes(selectedTrendTest)) {
          setSelectedTrendTest(testList[0]);
        }
      } else {
        setSelectedTrendTest("");
      }
    } else {
      setSelectedTrendTest("");
    }
  }, [patientLabs, selectedTrendCategory]);

  // Physical Metrics & Vitals States
  const [patientVitals, setPatientVitals] = useState<any[]>([]);
  const [isVitalsLoading, setIsVitalsLoading] = useState(false);
  const [vitalsHeightInput, setVitalsHeightInput] = useState("");
  const [vitalsWeightInput, setVitalsWeightInput] = useState("");
  const [vitalsBpInput, setVitalsBpInput] = useState("");
  const [vitalsHrInput, setVitalsHrInput] = useState("");
  const [isVitalsModalOpen, setIsVitalsModalOpen] = useState(false);

  // Advanced Chronological Filtering States
  const [departmentFilter, setDepartmentFilter] = useState<"All" | "Cardiology" | "Internal Medicine" | "Rheumatology" | "General">("All");
  // Author options are derived live from the real notes on this patient's chart (see below), not a fixed fake list.
  const [authorFilter, setAuthorFilter] = useState<string>("All");
  const [hideAddlNotes, setHideAddlNotes] = useState(false);

  // SmartText / Macros Search
  const [smartTextSearchQuery, setSmartTextSearchQuery] = useState("");
  const [isSmartTextDropdownOpen, setIsSmartTextDropdownOpen] = useState(false);

  // Order Management State
  const [activeOrders, setActiveOrders] = useState<Array<{ id: string; name: string; type: "med" | "lab" | "imaging" | "procedure"; status: string }>>([
    { id: "ord-1", name: "HbA1c Blood Panel", type: "lab", status: "Active" },
    { id: "ord-2", name: "Lisinopril 10mg PO Daily", type: "med", status: "Active" }
  ]);
  const [isOrderModalOpen, setIsOrderModalOpen] = useState(false);
  const [newOrderName, setNewOrderName] = useState("");
  const [newOrderType, setNewOrderType] = useState<"med" | "lab" | "imaging" | "procedure">("lab");

  // Diagnoses (ICD-10) Management State
  const [activeDiagnoses, setActiveDiagnoses] = useState<Array<{ id: string; code: string; name: string }>>([
    { id: "dx-1", code: "I10", name: "Essential Hypertension" },
    { id: "dx-2", code: "F41.1", name: "Generalized Anxiety Disorder" }
  ]);
  const [isDxModalOpen, setIsDxModalOpen] = useState(false);
  const [newDxName, setNewDxName] = useState("");
  const [newDxCode, setNewDxCode] = useState("");

  // Patient Exit Workflow State
  const [isAvsModalOpen, setIsAvsModalOpen] = useState(false);
  const [isAddendumSigned, setIsAddendumSigned] = useState(false);
  const [addendumText, setAddendumText] = useState("");
  const [showToast, setShowToast] = useState<string | null>(null);

  const triggerToast = (msg: string) => {
    setShowToast(msg);
    setTimeout(() => {
      setShowToast(null);
    }, 4000);
  };

  const handleMediaUploadAndAnalyze = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsAnalyzingMedia(true);
    setAnalysisProgressMsg("Reading clinical document and preparing upload...");
    setUploadError(null);

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64Data = reader.result as string;
        setAnalysisProgressMsg("Contacting Claude clinical model (analyzing document layout)...");

        const response = await authedFetch("/api/analyze", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            fileData: base64Data,
            mimeType: file.type,
            textData: `Extracted under Patient: ${selectedPatient?.name || "Unknown"}`
          })
        });

        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.error || `Server responded with ${response.status}`);
        }

        const data = await response.json();
        setAnalysisProgressMsg("Parsing and mapping test metrics...");

        const docMetadata = data.document_metadata || {};
        const extData = data.extracted_data || {};
        const quantResults = extData.quantitative_results || [];

        setValidationDocType(docMetadata.document_type || "Blood Test");
        setValidationReportDate(docMetadata.date_of_report || new Date().toISOString().split("T")[0]);
        setValidationFacility(docMetadata.facility_or_laboratory_name || "Professional Healthcare Diagnostics");

        // Dynamically map lab category based on file/document hints
        let guessedCategory = "HEMATOLOGY";
        const combinedText = `${file.name} ${docMetadata.document_type || ""} ${docMetadata.facility_or_laboratory_name || ""}`.toLowerCase();
        if (combinedText.includes("urine") || combinedText.includes("micro")) {
          guessedCategory = "MICROBIOLOGY";
        } else if (combinedText.includes("lipid") || combinedText.includes("cholesterol") || combinedText.includes("chem") || combinedText.includes("glucose")) {
          guessedCategory = "BIO CHEMISTRY";
        } else if (combinedText.includes("hormone") || combinedText.includes("thyroid") || combinedText.includes("endocrine") || combinedText.includes("tsh")) {
          guessedCategory = "ENDOCRINOLOGY";
        } else if (combinedText.includes("serology") || combinedText.includes("crp") || combinedText.includes("antibody")) {
          guessedCategory = "SEROLOGY";
        }
        setValidationLabType(guessedCategory);

        // Derive panel name
        setValidationPanelName(
          docMetadata.document_type && docMetadata.document_type !== "Other"
            ? `${guessedCategory === "HEMATOLOGY" ? "CBC" : guessedCategory} (${docMetadata.document_type})`
            : `${guessedCategory} Panel`
        );

        // Map quantitative parameters to component fields
        const mapped = quantResults.map((item: any) => {
          let refStr = item.reference_range || "";
          let valStr = String(item.value || "").trim();

          // Determine flag based on is_abnormal and references
          let flagVal: "NORMAL" | "HIGH" | "LOW" = "NORMAL";
          if (item.is_abnormal) {
            // Check if there is high/low indicators or guess
            const numVal = parseFloat(valStr);
            if (!isNaN(numVal) && refStr) {
              const match = refStr.match(/([\d.]+)\s*-\s*([\d.]+)/);
              if (match) {
                const low = parseFloat(match[1]);
                const high = parseFloat(match[2]);
                if (numVal < low) flagVal = "LOW";
                else if (numVal > high) flagVal = "HIGH";
              } else if (refStr.includes("<")) {
                const limit = parseFloat(refStr.replace(/[^\d.]/g, ""));
                if (!isNaN(limit) && numVal > limit) flagVal = "HIGH";
              } else if (refStr.includes(">")) {
                const limit = parseFloat(refStr.replace(/[^\d.]/g, ""));
                if (!isNaN(limit) && numVal < limit) flagVal = "LOW";
              }
            }
            if (flagVal === "NORMAL") {
              flagVal = "HIGH"; // Default abnormal to HIGH if exact direction is ambiguous
            }
          }

          return {
            name: item.parameter_name || "Unknown Metric",
            value: valStr,
            unit: item.unit || "",
            reference_range: refStr,
            flag: flagVal
          };
        });

        setValidationComponents(mapped);
        triggerToast("Clinical parameters extracted successfully!");
      } catch (err: any) {
        console.error("Clinical Analyzer Error:", err);
        setUploadError(err.message || "Failed to analyze document. Verify Anthropic API Key configuration.");
      } finally {
        setIsAnalyzingMedia(false);
        setAnalysisProgressMsg("");
      }
    };

    reader.onerror = () => {
      setUploadError("Failed to read selected file.");
      setIsAnalyzingMedia(false);
    };

    reader.readAsDataURL(file);
  };

  const handleSaveValidatedLab = async () => {
    if (!selectedPatient) {
      setUploadError("Please select a patient first.");
      return;
    }
    if (!validationPanelName.trim()) {
      setUploadError("Please specify a lab panel name.");
      return;
    }
    if (validationComponents.length === 0) {
      setUploadError("Please add at least one lab parameter row.");
      return;
    }

    setIsSavingValidatedLab(true);
    setUploadError(null);

    // Create a meaningful display value summary
    let summaryDisplay = "";
    if (validationComponents.length > 0) {
      const first = validationComponents[0];
      summaryDisplay = `${first.name}: ${first.value} ${first.unit}`;
      const abnormals = validationComponents.filter(c => c.flag !== "NORMAL");
      if (abnormals.length > 0) {
        summaryDisplay += ` (${abnormals.length} Abnormal Flagged)`;
      } else {
        summaryDisplay += ` (All Normal)`;
      }
    }

    // Determine status rating
    let statusVal: "Normal" | "Warning" | "Danger" = "Normal";
    const abnormals = validationComponents.filter(c => c.flag !== "NORMAL");
    if (abnormals.length > 0) {
      statusVal = abnormals.length > 2 ? "Danger" : "Warning";
    }

    const patientMrn = selectedPatient.mrn || (isNaN(Number(selectedPatient.id)) ? null : Number(selectedPatient.id));
    if (!patientMrn) {
      setUploadError("This patient does not have a valid MRN required for relational clinical records.");
      setIsSavingValidatedLab(false);
      return;
    }

    try {
      const savedComponents = [];
      for (const comp of validationComponents) {
        // 1. Upsert parameter into lab_parameters -- name normalized first so
        // "RBC Count" and "RBC" (etc.) land under one canonical parameter
        // instead of silently fragmenting the trend line across uploads.
        const canonicalName = normalizeLabParameterName(comp.name);
        const { data: pData, error: pErr } = await supabase
          .from("lab_parameters")
          .upsert({
            category: validationLabType,
            test_name: canonicalName,
            units: comp.unit,
            reference_range: comp.reference_range
          }, { onConflict: "test_name" })
          .select();

        if (pErr) {
          console.error("Error upserting parameter:", pErr);
          throw pErr;
        }

        const parameterId = pData?.[0]?.id;
        if (!parameterId) {
          throw new Error(`Failed to retrieve parameter ID for '${comp.name}'`);
        }

        // 2. Insert result into patient_lab_results
        const labResultPayload: any = {
          patient_mrn: patientMrn,
          parameter_id: parameterId,
          result_value: comp.value,
          is_abnormal: comp.flag !== "NORMAL",
          created_by: currentUser?.id || null,
          created_at: validationReportDate ? new Date(validationReportDate).toISOString() : new Date().toISOString()
        };

        const { error: rErr } = await supabase
          .from("patient_lab_results")
          .insert(labResultPayload);

        if (rErr) {
          console.error("Error inserting result:", rErr);
          throw rErr;
        }

        savedComponents.push(comp);
      }

      // Build a local grouped lab representation and prepend it to state so the UI displays it immediately
      const newLab: PatientLab = {
        id: `db-${Date.now()}`,
        patient_name: selectedPatient.name,
        lab_type: validationLabType,
        panel_name: validationPanelName.trim(),
        value_display: summaryDisplay,
        status: statusVal,
        collected_at: validationReportDate ? new Date(validationReportDate).toISOString() : new Date().toISOString(),
        facility_name: validationFacility.trim() || undefined,
        components: savedComponents
      };

      setPatientLabs(prev => [newLab, ...prev]);
      setExpandedLabId(newLab.id);

      // Reset extraction/validation state
      setValidationComponents([]);
      setValidationPanelName("");
      setValidationFacility("");
      setChartReviewSubTab("labs"); // Switch to Lab tab to view results!
      triggerToast("Lab panel successfully validated and saved to Supabase!");
    } catch (err: any) {
      console.error("Error saving validated lab to database:", err);
      // Fallback in case of error or lack of connection
      const fallbackLab: PatientLab = {
        id: `offline-${Date.now()}`,
        patient_name: selectedPatient.name,
        lab_type: validationLabType,
        panel_name: validationPanelName.trim(),
        value_display: summaryDisplay,
        status: statusVal,
        collected_at: validationReportDate ? new Date(validationReportDate).toISOString() : new Date().toISOString(),
        facility_name: validationFacility.trim() || undefined,
        components: validationComponents
      };
      setPatientLabs(prev => [fallbackLab, ...prev]);
      setExpandedLabId(fallbackLab.id);
      setValidationComponents([]);
      setChartReviewSubTab("labs"); // Switch to Lab tab to view results!
      triggerToast("Saved lab panel to patient's offline local registry.");
    } finally {
      setIsSavingValidatedLab(false);
    }
  };

  const handleSelectNoteForEdit = (note: any) => {
    setActiveMyNote(note);
    setActiveNoteContent(note.content || "");
    setActiveNoteDiagnosis(note.diagnosis || "");
    setActiveNoteFollowUp(note.follow_up_date || "");
    setActiveNoteBp(note.blood_pressure || "");
    setActiveNoteHr(note.heart_rate || "");
    setActiveNoteLocationId(note.location_id ? String(note.location_id) : "");
    setIsNoteSigned(note.content?.includes("[SIGNED ELECTRONICALLY]") || false);
    setActiveNoteAppointmentId(note.appointment_id ? Number(note.appointment_id) : null);
    setActiveNoteAppointmentStatus(
      note.appointment_id
        ? (patientAppointments || []).find((a: any) => String(a.id) === String(note.appointment_id))?.status || null
        : null
    );
    setIsMyNoteMinimized(false);
  };

  const handleCreateNewBlankNote = () => {
    const tempNote = {
      id: `new-temp-${Date.now()}`,
      patient_name: selectedPatient?.name || "",
      doctor_name: currentUser?.name || "Unassigned Provider",
      content: "",
      blood_pressure: "",
      heart_rate: "",
      diagnosis: "",
      follow_up_date: "",
      note_data: null,
      is_local_fallback: true
    };
    setActiveMyNote(tempNote);
    setActiveNoteContent("");
    setActiveNoteDiagnosis("");
    setActiveNoteFollowUp("");
    setActiveNoteBp("");
    setActiveNoteHr("");
    // Default the location, and link this note to today's appointment (if
    // one exists) so it can later be signed -- see activeNoteAppointmentId.
    // Whether that appointment is checked-in yet doesn't matter here; the
    // finalization trigger re-checks its live status when "Sign Note" is
    // actually clicked, not now.
    const todayStr = new Date().toDateString();
    const todaysAppt = (patientAppointments || []).find((apt: any) =>
      new Date(apt.schedule_time).toDateString() === todayStr
    );
    setActiveNoteLocationId(todaysAppt?.location_id ? String(todaysAppt.location_id) : "");
    setActiveNoteAppointmentId(todaysAppt?.id ? Number(todaysAppt.id) : null);
    setActiveNoteAppointmentStatus(todaysAppt?.status || null);
    setIsNoteSigned(false);
    setIsMyNoteMinimized(false);
  };

  // Rich-text editor content synchronization hook
  useEffect(() => {
    if (editorRef.current && activeMyNote) {
      const targetContent = activeNoteContent || "";
      if (editorRef.current.innerHTML !== targetContent) {
        editorRef.current.innerHTML = sanitizeHtml(targetContent);
      }
    }
  }, [activeMyNote?.id]);

  const executeFormat = (command: string, value: string = "") => {
    if (isNoteSigned) return;
    document.execCommand(command, false, value);
    if (editorRef.current) {
      setActiveNoteContent(editorRef.current.innerHTML);
    }
  };

  const checkForShortcuts = () => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const textNode = range.startContainer;

    if (textNode.nodeType === Node.TEXT_NODE) {
      const text = textNode.textContent || "";
      const offset = range.startOffset;
      const textBeforeCaret = text.substring(0, offset);

      const match = textBeforeCaret.match(/\.(age|height|weight|bp|hr|name|mrn)\s$/);
      if (match) {
        const shortcut = "." + match[1];
        const spaceLength = 1;

        let replacement = "";
        if (shortcut === ".age") {
          replacement = selectedPatient?.birth_date ? `${calculateAge(selectedPatient.birth_date)} y.o.` : "No DOB logged";
        } else if (shortcut === ".height") {
          const latest = patientVitals && patientVitals[0];
          replacement = latest && latest.height ? `${latest.height} cm` : "No height logged";
        } else if (shortcut === ".weight") {
          const latest = patientVitals && patientVitals[0];
          replacement = latest && latest.weight ? `${latest.weight} kg` : "No weight logged";
        } else if (shortcut === ".bp") {
          const latest = patientVitals && patientVitals[0];
          replacement = latest && latest.blood_pressure ? `${latest.blood_pressure} mmHg` : "No BP logged";
        } else if (shortcut === ".hr") {
          const latest = patientVitals && patientVitals[0];
          replacement = latest && latest.heart_rate ? `${latest.heart_rate} bpm` : "No HR logged";
        } else if (shortcut === ".name") {
          replacement = selectedPatient?.name || "";
        } else if (shortcut === ".mrn") {
          replacement = selectedPatient ? String(selectedPatient.id || selectedPatient.mrn) : "";
        }

        const newRange = document.createRange();
        newRange.setStart(textNode, offset - shortcut.length - spaceLength);
        newRange.setEnd(textNode, offset);
        selection.removeAllRanges();
        selection.addRange(newRange);

        document.execCommand('insertHTML', false, sanitizeHtml(replacement) + " ");
        triggerToast(`Expanded shortcut ${shortcut}`);
      }
    }
  };

  const insertTemplateAtCursor = (templateContent: string) => {
    if (!editorRef.current) return;
    editorRef.current.focus();

    // Interpolate patient placeholders
    const interpolated = interpolateTemplate(templateContent);
    // Convert newlines to HTML br tags so they render nicely inside the rich-text editor
    const htmlFormatted = interpolated.replace(/\n/g, "<br/>");

    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const textNode = range.startContainer;

      if (textNode.nodeType === Node.TEXT_NODE) {
        const text = textNode.textContent || "";
        const offset = range.startOffset;

        const slashIndex = text.lastIndexOf("/", offset - 1);
        if (slashIndex !== -1) {
          const newRange = document.createRange();
          newRange.setStart(textNode, slashIndex);
          newRange.setEnd(textNode, offset);
          selection.removeAllRanges();
          selection.addRange(newRange);
        }
      }
    }

    document.execCommand('insertHTML', false, sanitizeHtml(htmlFormatted));
    setActiveNoteContent(editorRef.current.innerHTML);
    setShowSlashMenu(false);
    setSlashQuery("");
    triggerToast("Inserted clinical template");
  };

  const insertTestAtCursor = (testHtml: string, testName: string) => {
    if (!editorRef.current) return;
    editorRef.current.focus();

    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const textNode = range.startContainer;

      if (textNode.nodeType === Node.TEXT_NODE) {
        const text = textNode.textContent || "";
        const offset = range.startOffset;

        const backslashIndex = text.lastIndexOf("\\", offset - 1);
        if (backslashIndex !== -1) {
          const newRange = document.createRange();
          newRange.setStart(textNode, backslashIndex);
          newRange.setEnd(textNode, offset);
          selection.removeAllRanges();
          selection.addRange(newRange);
        }
      }
    }

    document.execCommand('insertHTML', false, sanitizeHtml(testHtml));
    setActiveNoteContent(editorRef.current.innerHTML);
    setShowBackslashMenu(false);
    setBackslashQuery("");
    triggerToast(`Inserted Assessment: ${testName}`);
  };

  const appendHtmlContent = (html: string) => {
    if (isNoteSigned) return;
    if (editorRef.current) {
      editorRef.current.focus();
      const selection = window.getSelection();
      if (selection) {
        const range = document.createRange();
        range.selectNodeContents(editorRef.current);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      document.execCommand('insertHTML', false, sanitizeHtml(html));
      setActiveNoteContent(editorRef.current.innerHTML);
    } else {
      setActiveNoteContent(prev => (prev || "") + html);
    }
  };

  const handleEditorKeyUp = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (isNoteSigned) return;

    if (editorRef.current) {
      setActiveNoteContent(editorRef.current.innerHTML);
    }

    // Don't gate this on e.key === " " -- mobile virtual keyboards (Gboard, etc.)
    // use IME composition and frequently report key: "Unidentified" even for a
    // plain space press, so that check silently never fired on phones.
    // checkForShortcuts() already only expands when the live text ends in a
    // trailing space (its own regex requires \s$), so it's safe to just run it
    // on every keystroke -- same pattern already used below for slash/backslash.
    checkForShortcuts();

    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const textNode = range.startContainer;

      if (textNode.nodeType === Node.TEXT_NODE) {
        const text = textNode.textContent || "";
        const offset = range.startOffset;
        const textBeforeCaret = text.substring(0, offset);

        // Check for slash menu (templates)
        const slashIndex = textBeforeCaret.lastIndexOf("/");
        if (slashIndex !== -1 && (slashIndex === 0 || /\s/.test(textBeforeCaret[slashIndex - 1]))) {
          const query = textBeforeCaret.substring(slashIndex + 1);
          if (!query.includes(" ")) {
            setShowSlashMenu(true);
            setSlashQuery(query.toLowerCase());
            setShowBackslashMenu(false);
            setBackslashQuery("");
            return;
          }
        }

        // Check for backslash menu (assessments/tests)
        const backslashIndex = textBeforeCaret.lastIndexOf("\\");
        if (backslashIndex !== -1 && (backslashIndex === 0 || /\s/.test(textBeforeCaret[backslashIndex - 1]))) {
          const query = textBeforeCaret.substring(backslashIndex + 1);
          if (!query.includes(" ")) {
            setShowBackslashMenu(true);
            setBackslashQuery(query.toLowerCase());
            setShowSlashMenu(false);
            setSlashQuery("");
            return;
          }
        }
      }
    }
    setShowSlashMenu(false);
    setSlashQuery("");
    setShowBackslashMenu(false);
    setBackslashQuery("");
  };

  const handleSaveActiveNote = async (signOff: boolean = false) => {
    if (!selectedPatient || !activeMyNote) return;

    if (signOff && !isNoteSigned && !activeNoteAppointmentId) {
      triggerToast("Can't sign this note -- it isn't linked to an appointment for today. Precharted notes stay in draft until the visit.");
      return;
    }

    setIsNoteSaving(true);

    let finalContent = activeNoteContent;
    if (signOff && !isNoteSigned) {
      finalContent = `${activeNoteContent}\n\n[SIGNED ELECTRONICALLY]\nBy: ${currentUser?.name || "Unassigned Provider"}\nTimestamp: ${new Date().toLocaleString("en-GB")}\nVerified in SIMA Registry.`;
    }

    const payload: any = {
      patient_id: selectedPatient.id || null,
      doctor_id: currentUser?.id || null,
      content: finalContent,
      appointment_id: activeNoteAppointmentId,
      status: signOff ? "final" : "draft",
      blood_pressure: activeNoteBp,
      heart_rate: activeNoteHr,
      diagnosis: activeNoteDiagnosis || null,
      follow_up_date: activeNoteFollowUp || null,
      note_data: activeMyNote.note_data || null,
      visit_date: new Date().toISOString(),
      created_by: currentUser?.id || null,
      location_id: activeNoteLocationId ? Number(activeNoteLocationId) : null,
    };

    try {
      let result;
      // If it's a temp mock ID, do insert
      if (typeof activeMyNote.id === "string" && (activeMyNote.id.startsWith("new-temp") || activeMyNote.id.startsWith("sim"))) {
        const { data, error } = await supabase
          .from("visit_notes")
          .insert([payload])
          .select();
        if (error) throw error;
        result = data && data[0];
      } else {
        // Update existing
        const { data, error } = await supabase
          .from("visit_notes")
          .update(payload)
          .eq("id", activeMyNote.id)
          .select();
        if (error) throw error;
        result = data && data[0];
      }

      if (result) {
        setPatientNotes(prev => {
          const index = prev.findIndex(n => n.id === activeMyNote.id);
          if (index !== -1) {
            const updated = [...prev];
            updated[index] = result;
            return updated;
          } else {
            return [result, ...prev];
          }
        });

        setActiveMyNote(result);
        setActiveNoteContent(result.content || "");
        if (signOff) {
          setIsNoteSigned(true);
        }
        triggerToast(signOff ? "Clinical Note signed & synced!" : "Draft saved to EHR successfully");
      }
    } catch (err: any) {
      console.error("EHR backend sync failed:", err.message);
      triggerToast("Error: Failed to save to database. " + err.message);
    } finally {
      setIsNoteSaving(false);
    }
  };

  // New Patient Form fields
  const [newPatientFirstName, setNewPatientFirstName] = useState("");
  const [newPatientFatherName, setNewPatientFatherName] = useState("");
  const [newPatientSurname, setNewPatientSurname] = useState("");
  const newPatientName = toTitleCase(`${newPatientFirstName} ${newPatientFatherName} ${newPatientSurname}`);
  const [newPatientMotherName, setNewPatientMotherName] = useState("");
  const [newPatientNationalId, setNewPatientNationalId] = useState("");
  const [newPatientNationality, setNewPatientNationality] = useState("");
  const [newPatientPlaceOfBirth, setNewPatientPlaceOfBirth] = useState("");
  const [newPatientMaritalStatus, setNewPatientMaritalStatus] = useState("");
  const [newPatientOccupation, setNewPatientOccupation] = useState("");
  const [newPatientEducation, setNewPatientEducation] = useState("");
  const [newPatientEmergencyName, setNewPatientEmergencyName] = useState("");
  const [newPatientEmergencyRelation, setNewPatientEmergencyRelation] = useState("");
  const [newPatientEmergencyPhone, setNewPatientEmergencyPhone] = useState("");
  const [newPatientInsuranceProvider, setNewPatientInsuranceProvider] = useState("");
  const [newPatientInsuranceNumber, setNewPatientInsuranceNumber] = useState("");
  const [newPatientBloodType, setNewPatientBloodType] = useState("");
  const [newPatientDob, setNewPatientDob] = useState(""); // dd/mm/yyyy
  const [newPatientGender, setNewPatientGender] = useState("Female");
  const [newPatientPhone, setNewPatientPhone] = useState("");
  const [newPatientEmail, setNewPatientEmail] = useState("");
  const [newPatientAddress, setNewPatientAddress] = useState("");
  const [newPatientHistory, setNewPatientHistory] = useState("");

  // Optional initial encounter data inputs (NOT auto-filled)
  const [newPatientBp, setNewPatientBp] = useState("");
  const [newPatientHr, setNewPatientHr] = useState("");
  const [newPatientInitialNote, setNewPatientInitialNote] = useState("");
  const [newPatientInitialDx, setNewPatientInitialDx] = useState("");
  const [newPatientInitialFollowUp, setNewPatientInitialFollowUp] = useState("");
  const [newPatientHeight, setNewPatientHeight] = useState("");
  const [newPatientWeight, setNewPatientWeight] = useState("");

  const [copiedText, setCopiedText] = useState<string | null>(null);

  // Fetch patient physical metrics & vitals history
  const fetchPatientVitals = async (patientMrn: number | string, patientName: string) => {
    setIsVitalsLoading(true);
    try {
      const numericMrn = parseInt(String(patientMrn), 10);
      let res: any = null;

      if (!isNaN(numericMrn)) {
        res = await supabase
          .from("patient_vitals")
          .select("*")
          .eq("patient_mrn", numericMrn)
          .order("recorded_at", { ascending: false });
      }

      if (res && res.error) {
        console.warn("Could not fetch patient vitals from database:", res.error.message);
        setPatientVitals([]);
      } else if (res && res.data) {
        // Map database records to a standardized format
        const mapped = res.data.map((vital: any) => {
          const height = vital.height_cm !== undefined ? vital.height_cm : vital.height;
          const weight = vital.weight_kg !== undefined ? vital.weight_kg : vital.weight;

          let bp = "";
          if (vital.systolic_bp !== undefined && vital.diastolic_bp !== undefined) {
            if (vital.systolic_bp && vital.diastolic_bp) {
              bp = `${vital.systolic_bp}/${vital.diastolic_bp}`;
            } else if (vital.systolic_bp) {
              bp = `${vital.systolic_bp}/--`;
            } else if (vital.diastolic_bp) {
              bp = `--/${vital.diastolic_bp}`;
            }
          } else {
            bp = vital.blood_pressure || "";
          }

          const hr = vital.heart_rate !== undefined && vital.heart_rate !== null ? String(vital.heart_rate) : (vital.heart_rate_str || "");

          return {
            id: vital.id,
            patient_mrn: vital.patient_mrn,
            patient_name: vital.patient_name || patientName,
            height: height ? parseFloat(height) : null,
            weight: weight ? parseFloat(weight) : null,
            blood_pressure: bp,
            heart_rate: hr,
            created_at: vital.recorded_at || vital.created_at
          };
        });
        setPatientVitals(mapped);
      } else {
        setPatientVitals([]);
      }
    } catch (err: any) {
      console.warn("Exception during fetchPatientVitals:", err.message);
      setPatientVitals([]);
    } finally {
      setIsVitalsLoading(false);
    }
  };

  const handleSaveVitals = async (heightCm: string, weightKg: string, bp: string, hr: string) => {
    if (!selectedPatient) return;
    const h = parseFloat(heightCm);
    const w = parseFloat(weightKg);
    if (!h || !w || h <= 0 || w <= 0) {
      triggerToast("Please enter valid height and weight values.");
      return;
    }

    const mrnValue = parseInt(String(selectedPatient.mrn || selectedPatient.id), 10) || 123456789;

    // Parse blood pressure
    const bpParts = bp.split("/");
    const systolic = parseInt(bpParts[0]?.trim(), 10) || null;
    const diastolic = bpParts[1] ? (parseInt(bpParts[1].trim(), 10) || null) : null;
    const parsedHr = parseInt(hr.trim(), 10) || null;

    // Try New Schema first
    const newPayload = {
      patient_mrn: mrnValue,
      height_cm: h,
      weight_kg: w,
      systolic_bp: systolic,
      diastolic_bp: diastolic,
      heart_rate: parsedHr,
      recorded_at: new Date().toISOString(),
      created_at: new Date().toISOString()
    };

    try {
      const { error } = await supabase
        .from("patient_vitals")
        .insert([newPayload])
        .select();

      if (error) throw error;


      triggerToast("Vitals registered and saved in database!");
      fetchPatientVitals(mrnValue, selectedPatient.name);
    } catch (err: any) {
      console.warn("Could not save vitals in DB (saving locally in session fallback):", err.message);
      // Fallback: save to local state for seamless immediate preview
      const localRecord = {
        id: `local-vital-${Date.now()}`,
        patient_mrn: mrnValue,
        patient_name: selectedPatient.name,
        height: h,
        weight: w,
        blood_pressure: bp,
        heart_rate: hr,
        created_at: new Date().toISOString(),
        is_local_fallback: true
      };
      setPatientVitals(prev => [localRecord, ...prev]);
      triggerToast("Saved locally (Offline Fallback)");
    }
  };

  const handleDeleteVitals = async (vitalId: string | number) => {
    if (typeof vitalId === "string" && vitalId.startsWith("local-vital-")) {
      setPatientVitals(prev => prev.filter(v => v.id !== vitalId));
      triggerToast("Local record cleared.");
      return;
    }

    try {
      const { error } = await supabase
        .from("patient_vitals")
        .delete()
        .eq("id", vitalId);

      if (error) throw error;
      triggerToast("Vital record deleted!");
      if (selectedPatient) {
        const mrnValue = parseInt(String(selectedPatient.mrn || selectedPatient.id), 10) || 123456789;
        fetchPatientVitals(mrnValue, selectedPatient.name);
      }
    } catch (err: any) {
      console.warn("Could not delete vital record from Supabase:", err.message);
      triggerToast("Could not delete record from database.");
    }
  };

  // Fetch Patients List
  const fetchPatients = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const { data, error } = await supabase
        .from("patients")
        .select("*");

      if (error) throw error;

      if (data && data.length > 0) {
        // history lives in its own is_clinical()-gated table, not on
        // patients itself, so secretary/pharmacy/hr/admissions -- who can
        // read `patients` for scheduling/registration/billing -- never see
        // doctor-authored clinical narrative. Fetched separately and merged
        // in here rather than embedded, to keep the join explicit and simple.
        const { data: histRows } = await supabase
          .from("patient_clinical_history")
          .select("patient_mrn, history");
        const historyByMrn = new Map((histRows || []).map((h: any) => [Number(h.patient_mrn), h.history]));

        // Map any existing schemas to our standard interface dynamically
        const mappedData: Patient[] = data.map((item: any) => {
          let name = item.name;
          if (!name) {
            const first = item.first_name || "";
            const father = item.father_name || "";
            const last = item.surname || item.last_name || "";
            name = [first, father, last].filter(Boolean).join(" ").trim() || `Patient MRN-${item.id || item.mrn || ""}`;
          }
          name = toTitleCase(name);
          const birth_date = item.birth_date || item.date_of_birth || "1988-04-12";
          const phone = item.phone || item.phone_number || "";
          return {
            id: String(item.id || item.mrn || ""),
            mrn: item.mrn ? Number(item.mrn) : (isNaN(Number(item.id)) ? undefined : Number(item.id)),
            name,
            first_name: item.first_name || "",
            father_name: item.father_name || "",
            surname: item.surname || "",
            birth_date,
            gender: item.gender || "Female",
            phone,
            email: item.email || "",
            history: (item.mrn != null ? historyByMrn.get(Number(item.mrn)) : undefined) || "None declared.",
            address: item.address || "",
            created_at: item.created_at,
            mother_name: item.mother_name || "",
            national_id: item.national_id || "",
            nationality: item.nationality || "",
            place_of_birth: item.place_of_birth || "",
            marital_status: item.marital_status || "",
            occupation: item.occupation || "",
            education_level: item.education_level || "",
            emergency_contact_name: item.emergency_contact_name || "",
            emergency_contact_relation: item.emergency_contact_relation || "",
            emergency_contact_phone: item.emergency_contact_phone || "",
            insurance_provider: item.insurance_provider || "",
            insurance_number: item.insurance_number || "",
            blood_type: item.blood_type || ""
          };
        });

        // Sort by name alphabetically in memory to avoid query-level sorting crashes
        mappedData.sort((a, b) => a.name.localeCompare(b.name));

        setPatients(mappedData);
        if (!selectedPatient) {
          setSelectedPatient(mappedData[0]);
        }
      } else {
        // Fallback to empty list so user can seed or add
        setPatients([]);
      }
    } catch (err: any) {
      console.warn("Could not query 'patients' table. Check if table exists.", err.message);
      setPatients([]);
      setErrorMsg("Patients table query failed. It is highly recommended to run the Patient SQL script at the bottom to configure Supabase tables!");
    } finally {
      setIsLoading(false);
    }
  };

  // Initial Fetch
  useEffect(() => {
    fetchPatients();
    fetchCustomTemplates();
    fetchClinicalTests();

    const handleTemplatesUpdate = () => {
      console.log("EHR note templates updated. Re-fetching custom templates...");
      fetchCustomTemplates();
    };

    const handleTestsUpdate = () => {
      console.log("Clinical tests catalog updated. Re-fetching tests...");
      fetchClinicalTests();
    };

    window.addEventListener("note-templates-updated", handleTemplatesUpdate);
    window.addEventListener("clinical-tests-updated", handleTestsUpdate);
    return () => {
      window.removeEventListener("note-templates-updated", handleTemplatesUpdate);
      window.removeEventListener("clinical-tests-updated", handleTestsUpdate);
    };
  }, []);

  // Load this doctor's own managed location list once, so the note editor's
  // location picker has something to show.
  useEffect(() => {
    if (!currentUser?.id || currentUser.role !== "doctor") return;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("doctor_locations")
          .select("id, name")
          .eq("doctor_id", currentUser.id)
          .eq("is_active", true)
          .order("sort_order");
        if (error) throw error;
        setMyLocations(data || []);
      } catch {
        setMyLocations([]);
      }
    })();
  }, [currentUser?.id]);

  // Fetch sub-data when selectedPatient changes
  useEffect(() => {
    if (!selectedPatient) return;

    const fetchPatientDetails = async () => {
      setIsDataLoading(true);
      try {
        const selectedMrn = Number(selectedPatient.mrn ?? selectedPatient.id);

        // 1. Fetch appointments (linked by patient_id — this app's own
        // schema, unlike SIMA's numeric patient_mrn foreign key)
        const { data: appts, error: apptErr } = await supabase
          .from("appointments")
          .select("*")
          .eq("patient_id", selectedPatient.id)
          .order("starts_at", { ascending: false });

        if (!apptErr && appts) {
          setPatientAppointments(appts);
        } else {
          setPatientAppointments([]);
        }

        // 1b. Active admission (bed/room/ward/floor) for the identity card
        try {
          const { data: adm } = await supabase
            .from("admissions")
            .select("*, beds(bed_label, ward_rooms(room_number, room_type, wards(name, hospital_floors(name))))")
            .eq("patient_mrn", selectedMrn)
            .in("status", ["requested", "admitted"])
            .maybeSingle();
          setActiveAdmission(adm || null);
        } catch {
          setActiveAdmission(null);
        }

        // 2. Fetch extracted medical records (linked by patient_mrn)
        const { data: recs, error: recErr } = await supabase
          .from("medical_records")
          .select("*")
          .eq("patient_mrn", selectedMrn)
          .order("created_at", { ascending: false });

        if (!recErr && recs) {
          setPatientRecords(recs);
        } else {
          setPatientRecords([]);
        }

        // 3. Fetch clinical visit notes (linked by patient_id)
        const { data: notes, error: noteErr } = await supabase
          .from("visit_notes")
          .select("*")
          .eq("patient_id", selectedPatient.id)
          .order("created_at", { ascending: false });

        if (!noteErr && notes) {
          setPatientNotes(notes);
        } else {
          setPatientNotes([]);
        }

        // 4. Fetch physical metrics & vitals history
        await fetchPatientVitals(selectedPatient.mrn || selectedPatient.id, selectedPatient.name);

        // 5. Fetch patient labs from Supabase with safe local mock fallback
        try {
          const patientMrn = selectedPatient.mrn || (isNaN(Number(selectedPatient.id)) ? null : Number(selectedPatient.id));
          if (patientMrn) {
            const res = await supabase
              .from("patient_lab_results")
              .select(`
                id,
                patient_mrn,
                result_value,
                is_abnormal,
                created_at,
                parameter_id,
                lab_parameters:parameter_id (
                  id,
                  category,
                  test_name,
                  units,
                  reference_range
                )
              `)
              .eq("patient_mrn", patientMrn);
            const resultsData: any[] | null = res.data;
            const resultsErr: any = res.error;

            if (!resultsErr && resultsData && resultsData.length > 0) {
              // Group results into panels by Category and date (same day or exact timestamp)
              const groups: { [key: string]: any[] } = {};
              resultsData.forEach((row: any) => {
                const param = row.lab_parameters;
                if (!param) return;

                // Group by category and date-hour-minute to group things uploaded in the same action
                const dateStr = row.created_at ? row.created_at.substring(0, 16) : new Date().toISOString().substring(0, 16);
                const key = `${param.category}_${dateStr}`;
                if (!groups[key]) {
                  groups[key] = [];
                }
                groups[key].push(row);
              });

              const formatted: PatientLab[] = Object.keys(groups).map((key, index) => {
                const rows = groups[key];
                const firstRow = rows[0];
                const paramCategory = firstRow.lab_parameters.category;
                const collectedAt = firstRow.created_at || new Date().toISOString();
                const facilityNameVal = firstRow.facility_name || undefined;

                const components = rows.map((r: any) => {
                  const p = r.lab_parameters;
                  let flagVal: "NORMAL" | "HIGH" | "LOW" = "NORMAL";
                  if (r.is_abnormal) {
                    flagVal = "HIGH";
                  }
                  return {
                    name: p.test_name,
                    value: r.result_value,
                    unit: p.units || "",
                    reference_range: p.reference_range || "",
                    flag: flagVal
                  };
                });

                let panelName = `${paramCategory} Panel`;
                if (paramCategory === "HEMATOLOGY") panelName = "CBC (Complete Blood Count)";
                else if (paramCategory === "MICROBIOLOGY") panelName = "Urine Analysis & Culturing";
                else if (paramCategory === "BIO CHEMISTRY") panelName = "Metabolic Panel";
                else if (paramCategory === "ENDOCRINOLOGY") panelName = "Thyroid / Hormone Profile";
                else if (paramCategory === "SEROLOGY") panelName = "Immunology & Serology Panel";

                const abnormalsCount = components.filter(c => c.flag !== "NORMAL").length;
                let statusVal: "Normal" | "Warning" | "Danger" = "Normal";
                if (abnormalsCount > 0) {
                  statusVal = abnormalsCount > 2 ? "Danger" : "Warning";
                }

                const firstComp = components[0];
                let valDisplay = firstComp ? `${firstComp.name}: ${firstComp.value} ${firstComp.unit}` : "No metrics";
                if (components.length > 1) {
                  valDisplay += ` (+${components.length - 1} more metrics)`;
                }

                return {
                  id: `db-${index}-${collectedAt}`,
                  patient_name: selectedPatient.name,
                  lab_type: paramCategory,
                  panel_name: panelName,
                  value_display: valDisplay,
                  status: statusVal,
                  collected_at: collectedAt,
                  facility_name: facilityNameVal,
                  components: components
                };
              });

              formatted.sort((a, b) => new Date(b.collected_at).getTime() - new Date(a.collected_at).getTime());
              setPatientLabs(formatted);
            } else {
              setPatientLabs(getFallbackLabsForPatient(selectedPatient.name));
            }
          } else {
            setPatientLabs(getFallbackLabsForPatient(selectedPatient.name));
          }
        } catch (err) {
          console.warn("Could not query patient lab results table:", err);
          setPatientLabs(getFallbackLabsForPatient(selectedPatient.name));
        }
      } catch (err) {
        console.error("Error loading patient sub-data", err);
      } finally {
        setIsDataLoading(false);
      }
    };

    fetchPatientDetails();
  }, [selectedPatient, activeWindows]); // Refetch if active windows saved (or closed) to show newly updated notes!

  // --- Patient Photo Timeline (condition/follow-up photos, stored in Supabase Storage) ---

  const getSelectedPatientMrn = (): number | null => {
    if (!selectedPatient) return null;
    if (selectedPatient.mrn) return selectedPatient.mrn;
    const asNum = Number(selectedPatient.id);
    return isNaN(asNum) ? null : asNum;
  };

  const fetchPatientPhotos = async () => {
    const mrn = getSelectedPatientMrn();
    if (!mrn) {
      setPatientPhotos([]);
      return;
    }
    setIsPhotosLoading(true);
    try {
      const { data, error } = await supabase
        .from("patient_photos")
        .select("*")
        .eq("patient_mrn", mrn)
        .order("taken_at", { ascending: false });

      if (error || !data) {
        setPatientPhotos([]);
        return;
      }

      // Resolve a short-lived signed URL for each private photo so it can render in <img>
      const withUrls: PatientPhoto[] = await Promise.all(
        data.map(async (row: PatientPhoto) => {
          const { data: signed } = await supabase.storage
            .from("patient-photos")
            .createSignedUrl(row.storage_path, 3600);
          return { ...row, signedUrl: signed?.signedUrl };
        })
      );
      setPatientPhotos(withUrls);
    } catch (err) {
      console.error("Error loading patient photo timeline:", err);
      setPatientPhotos([]);
    } finally {
      setIsPhotosLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedPatient) {
      setPatientPhotos([]);
      return;
    }
    fetchPatientPhotos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPatient]);

  const handleUploadConditionPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file next time
    if (!file) return;

    const mrn = getSelectedPatientMrn();
    if (!mrn) {
      setPhotoUploadError("This patient doesn't have a valid MRN on record yet, so a photo can't be linked to them.");
      return;
    }

    setPhotoUploadError(null);
    setIsUploadingPhoto(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const ext = file.name.split(".").pop() || "jpg";
      const storagePath = `${mrn}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from("patient-photos")
        .upload(storagePath, file, { contentType: file.type || "image/jpeg" });
      if (uploadErr) {
        throw new Error(uploadErr.message);
      }

      const { error: insertErr } = await supabase.from("patient_photos").insert({
        patient_mrn: mrn,
        storage_path: storagePath,
        category: "condition_photo",
        caption: newPhotoCaption.trim() || null,
        uploaded_by: userData?.user?.id || null,
      });
      if (insertErr) {
        throw new Error(insertErr.message);
      }

      setNewPhotoCaption("");
      await fetchPatientPhotos();
    } catch (err: any) {
      console.error("Photo upload failed:", err);
      setPhotoUploadError(err.message || "Could not upload this photo. Please try again.");
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  const handleDeletePatientPhoto = async (photo: PatientPhoto) => {
    if (!window.confirm("Remove this photo from the patient's timeline? This can't be undone.")) return;
    try {
      await supabase.storage.from("patient-photos").remove([photo.storage_path]);
      await supabase.from("patient_photos").delete().eq("id", photo.id);
      setPatientPhotos(prev => prev.filter(p => p.id !== photo.id));
    } catch (err) {
      console.error("Error deleting photo:", err);
    }
  };

  // Auto-load note for editing when notes change
  useEffect(() => {
    if (patientNotes && patientNotes.length > 0) {
      handleSelectNoteForEdit(patientNotes[0]);
    } else {
      setActiveMyNote(null);
      setActiveNoteContent("");
      setActiveNoteDiagnosis("");
      setActiveNoteFollowUp("");
      setActiveNoteBp("");
      setActiveNoteHr("");
      setIsNoteSigned(false);
    }
  }, [patientNotes]);

  const handleCreatePatient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPatientFirstName.trim() || !newPatientSurname.trim()) {
      triggerToast("Please enter both First Name and Surname.");
      return;
    }

    // Birth date: mandatory, dd/mm/yyyy, converted to ISO for the database
    const dobMatch = newPatientDob.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!dobMatch) {
      triggerToast("Birth Date is required in dd/mm/yyyy format.");
      return;
    }
    const dobDay = Number(dobMatch[1]), dobMonth = Number(dobMatch[2]), dobYear = Number(dobMatch[3]);
    const dobCheck = new Date(dobYear, dobMonth - 1, dobDay);
    if (dobCheck.getFullYear() !== dobYear || dobCheck.getMonth() !== dobMonth - 1 || dobCheck.getDate() !== dobDay || dobCheck > new Date() || dobYear < 1900) {
      triggerToast("Please enter a valid Birth Date (dd/mm/yyyy).");
      return;
    }
    const dobIso = `${dobMatch[3]}-${dobMatch[2]}-${dobMatch[1]}`;

    // Auto-capitalize: "malek" -> "Malek"
    const firstName = toTitleCase(newPatientFirstName);
    const fatherName = toTitleCase(newPatientFatherName);
    const surname = toTitleCase(newPatientSurname);
    const nameStr = [firstName, fatherName, surname].filter(Boolean).join(" ");

    // Duplicate protection: block same full name + birth date, or same full name + phone
    const normPhoneKey = (s: string) => s.replace(/\D/g, "").replace(/^0+/, "");
    const nameKey = nameStr.toLowerCase();
    const phoneKey = normPhoneKey(newPatientPhone);
    const duplicate = patients.find(p => {
      const sameName = p.name.trim().replace(/\s+/g, " ").toLowerCase() === nameKey;
      if (!sameName) return false;
      const sameDob = p.birth_date === dobIso;
      const samePhone = !!phoneKey && !!p.phone && normPhoneKey(p.phone) === phoneKey;
      return sameDob || samePhone;
    });
    if (duplicate) {
      triggerToast(`Duplicate blocked: "${duplicate.name}" is already registered (MRN: ${duplicate.mrn ?? duplicate.id}).`);
      return;
    }

    setSaveLoading(true);

    // Dynamic numeric BIGINT MRN generator
    // It maps first two letters to numeric codes so it fits perfectly in BIGINT, yet decodes to letters in the UI (e.g. Mk01112)
    const generateNumericMRN = (first: string, last: string): number => {
      const c1 = first.trim().charAt(0).toUpperCase() || "P";
      const c2 = last.trim().charAt(0).toLowerCase() || "t";
      const num1 = Math.max(1, Math.min(26, c1.charCodeAt(0) - 64));
      const num2 = Math.max(1, Math.min(26, c2.toUpperCase().charCodeAt(0) - 64));
      const prefix1 = String(num1).padStart(2, "0");
      const prefix2 = String(num2).padStart(2, "0");
      const randomDigits = String(Math.floor(Math.random() * 100000)).padStart(5, "0");
      return parseInt(`${prefix1}${prefix2}${randomDigits}`, 10);
    };

    try {
      // Insert matching this app's actual patients schema
      // (supabase/migrations/0003_patients.sql) -- not SIMA's column names.
      // mrn is deliberately omitted: the database assigns it automatically
      // (see 0010_mrn_format.sql), same plain-incrementing-number scheme
      // as SIMA, instead of the client generating one itself.
      const payload = {
        first_name: firstName,
        last_name: surname,
        father_name: fatherName || null,
        mother_name: toTitleCase(newPatientMotherName) || null,
        gender: newPatientGender.toLowerCase(),
        date_of_birth: dobIso,
        national_id: newPatientNationalId.trim() || null,
        nationality: toTitleCase(newPatientNationality) || null,
        phone: newPatientPhone.trim() || null,
        email: newPatientEmail.trim() || null,
        address_line: newPatientAddress.trim() || null,
        blood_type: newPatientBloodType || null,
        created_by: currentUser?.id || null,
        // No home in this app's schema (a leaner model than SIMA's): place
        // of birth, marital status, occupation, education level, emergency
        // contact. Not sent -- unlike SIMA's table these columns don't
        // exist here, and an unknown column fails the whole insert.
      };
      const res = await supabase.from("patients").insert([payload]).select();

      if (res.error) {
        throw res.error;
      }

      // Insurance lives in its own patient_payers table here, not on
      // patients directly -- a second insert, only if either field is set.
      if (res.data?.[0]?.id && (newPatientInsuranceProvider.trim() || newPatientInsuranceNumber.trim())) {
        try {
          await supabase.from("patient_payers").insert([{
            patient_id: res.data[0].id,
            payer_type: "private_insurance",
            payer_name: newPatientInsuranceProvider.trim() || null,
            policy_no: newPatientInsuranceNumber.trim() || null,
          }]);
        } catch (payerErr) {
          console.warn("Could not save insurance info:", payerErr);
        }
      }

      const resultData: any = res.data && res.data[0];

      if (resultData) {
        // Map returned database record to internal standard Patient interface
        let name = resultData.name;
        if (!name) {
          const first = resultData.first_name || "";
          const father = resultData.father_name || "";
          const last = resultData.surname || resultData.last_name || "";
          name = [first, father, last].filter(Boolean).join(" ").trim() || `Patient MRN-${resultData.id || resultData.mrn || ""}`;
        }
        name = toTitleCase(name);
        const birth_date = resultData.birth_date || resultData.date_of_birth || "1988-04-12";
        const phone = resultData.phone || resultData.phone_number || "";

        const created: Patient = {
          id: String(resultData.id || resultData.mrn || ""),
          mrn: resultData.mrn ? Number(resultData.mrn) : undefined,
          name,
          first_name: resultData.first_name || "",
          father_name: resultData.father_name || "",
          surname: resultData.surname || resultData.last_name || "",
          birth_date,
          gender: resultData.gender || "Female",
          phone,
          email: resultData.email || "",
          history: newPatientHistory.trim() || "None declared.",
          address: resultData.address || resultData.address_line || "",
          mother_name: resultData.mother_name || "",
          national_id: resultData.national_id || "",
          nationality: resultData.nationality || "",
          place_of_birth: resultData.place_of_birth || "",
          marital_status: resultData.marital_status || "",
          occupation: resultData.occupation || "",
          education_level: resultData.education_level || "",
          emergency_contact_name: resultData.emergency_contact_name || "",
          emergency_contact_relation: resultData.emergency_contact_relation || "",
          emergency_contact_phone: resultData.emergency_contact_phone || "",
          insurance_provider: resultData.insurance_provider || "",
          insurance_number: resultData.insurance_number || "",
          blood_type: resultData.blood_type || ""
        };

        // history lives in its own is_clinical()-gated table (see fetchPatients).
        if (newPatientHistory.trim()) {
          try {
            const { error: histErr } = await supabase.from("patient_clinical_history").upsert({
              patient_mrn: created.mrn,
              history: newPatientHistory.trim(),
              updated_by: currentUser?.id || null,
            });
            if (histErr) throw histErr;
          } catch (histErr) {
            console.warn("Could not save clinical history for new patient:", histErr);
          }
        }

        // If user entered optional initial clinical details (Vitals / Notes), save to Supabase!
        if (newPatientInitialNote.trim() || newPatientBp.trim() || newPatientHr.trim() || newPatientInitialDx.trim() || newPatientInitialFollowUp.trim()) {
          const contentValue = newPatientInitialNote.trim() || "Initial clinical evaluation note.";
          const initialNotePayload: any = {
            patient_id: created.id,
            doctor_id: currentUser?.id || null,
            content: contentValue,
            blood_pressure: newPatientBp.trim() || null,
            heart_rate: newPatientHr.trim() || null,
            diagnosis: newPatientInitialDx.trim() || null,
            follow_up_date: newPatientInitialFollowUp.trim() || null,
            visit_date: new Date().toISOString(),
            created_by: currentUser?.id || null,
          };
          try {
            const { error } = await supabase.from("visit_notes").insert([initialNotePayload]);
            if (error) throw error;
          } catch (noteErr) {
            console.warn("Could not insert initial clinical note in database:", noteErr);
          }
        }

        // Save initial physical metrics & vitals if entered
        if (newPatientHeight.trim() || newPatientWeight.trim()) {
          const bpParts = newPatientBp.trim().split("/");
          const systolic = parseInt(bpParts[0]?.trim(), 10) || null;
          const diastolic = bpParts[1] ? (parseInt(bpParts[1].trim(), 10) || null) : null;
          const parsedHr = parseInt(newPatientHr.trim(), 10) || null;

          const newVitalsPayload = {
            patient_mrn: created.mrn,
            height_cm: parseFloat(newPatientHeight.trim()) || 0,
            weight_kg: parseFloat(newPatientWeight.trim()) || 0,
            systolic_bp: systolic,
            diastolic_bp: diastolic,
            heart_rate: parsedHr,
            recorded_at: new Date().toISOString(),
            created_at: new Date().toISOString()
          };

          try {
            const { error: vitalsErr } = await supabase.from("patient_vitals").insert([newVitalsPayload]);
            if (vitalsErr) throw vitalsErr;
          } catch (vitalsErr: any) {
            console.warn("Could not insert initial vitals in database:", vitalsErr.message);
          }
        }

        setPatients(prev => [created, ...prev]);
        setSelectedPatient(created);
        setIsNewPatientModal(false);
        if (admitMode) {
          setAdmitMode(false);
          setAdmitPatient(created);
          setIsAdmitModal(true);
        }
      } else {
        throw new Error("No data returned from insert operations.");
      }

      // Clear all inputs
      setNewPatientFirstName("");
      setNewPatientDob("");
      setNewPatientFatherName("");
      setNewPatientSurname("");
      setNewPatientMotherName("");
      setNewPatientNationalId("");
      setNewPatientNationality("");
      setNewPatientPlaceOfBirth("");
      setNewPatientMaritalStatus("");
      setNewPatientOccupation("");
      setNewPatientEducation("");
      setNewPatientEmergencyName("");
      setNewPatientEmergencyRelation("");
      setNewPatientEmergencyPhone("");
      setNewPatientInsuranceProvider("");
      setNewPatientInsuranceNumber("");
      setNewPatientBloodType("");
      setNewPatientPhone("");
      setNewPatientEmail("");
      setNewPatientAddress("");
      setNewPatientHistory("");
      setNewPatientBp("");
      setNewPatientHr("");
      setNewPatientInitialNote("");
      setNewPatientInitialDx("");
      setNewPatientInitialFollowUp("");
      setNewPatientHeight("");
      setNewPatientWeight("");
      triggerToast("Patient registered successfully!");
    } catch (err: any) {
      // Fail honestly instead of faking success with a local-only object --
      // that pattern (SIMA's original "offline fallback") is exactly what
      // made patients silently vanish: the toast said "created" and the
      // chart opened normally, but nothing was ever in the database, so it
      // was gone on the next refresh or from any other session. The form
      // stays open with everything still filled in so it can be retried.
      console.error("Could not save patient to database:", err);
      triggerToast(`Could not save this patient: ${err.message || "Unknown error"}. Nothing was saved -- please try again.`);
    } finally {
      setSaveLoading(false);
    }
  };

  // Quick helper to calculate age
  const calculateAge = (dobString: string) => {
    if (!dobString) return "N/A";
    const birth = new Date(dobString);
    if (isNaN(birth.getTime())) return "N/A";
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      age--;
    }
    return age;
  };

  // Quick helper to calculate BMI and its clinical categories
  const calculateBMI = (heightCm: string | number, weightKg: string | number) => {
    const h = parseFloat(String(heightCm));
    const w = parseFloat(String(weightKg));
    if (!h || !w || h <= 0 || w <= 0) return { bmi: null, category: "N/A", color: "text-slate-500" };
    const hMeters = h / 100;
    const bmi = w / (hMeters * hMeters);
    let category = "";
    let color = "";
    if (bmi < 18.5) {
      category = "Underweight";
      color = "text-amber-500";
    } else if (bmi < 25) {
      category = "Normal Weight";
      color = "text-emerald-600";
    } else if (bmi < 30) {
      category = "Overweight";
      color = "text-orange-500";
    } else {
      category = "Obese";
      color = "text-red-500";
    }
    return { bmi: parseFloat(bmi.toFixed(1)), category, color };
  };

  // ---- Edit Patient Profile ----
  const [isEditPatientModal, setIsEditPatientModal] = useState(false);
  const [editForm, setEditForm] = useState<any>({});
  const [isEditSaving, setIsEditSaving] = useState(false);

  const openEditPatient = () => {
    if (!selectedPatient) return;
    setEditForm({ ...selectedPatient, birth_date: isoToDDMM(selectedPatient.birth_date) });
    setIsEditPatientModal(true);
  };

  const handleSaveEditPatient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatient) return;
    if (!(editForm.first_name || "").trim() || !(editForm.surname || "").trim()) {
      triggerToast("First Name and Surname are required.");
      return;
    }
    const editDobIso = ddmmToIso(editForm.birth_date || "");
    if (!editDobIso) {
      triggerToast("Birth Date is required in dd/mm/yyyy format.");
      return;
    }
    setIsEditSaving(true);
    const payload: any = {
      first_name: toTitleCase(editForm.first_name || ""),
      father_name: toTitleCase(editForm.father_name || "") || null,
      surname: toTitleCase(editForm.surname || ""),
      birth_date: editDobIso,
      gender: editForm.gender,
      phone_number: (editForm.phone || "").trim() || null,
      email: (editForm.email || "").trim() || null,
      address: (editForm.address || "").trim() || null,
      mother_name: toTitleCase(editForm.mother_name || "") || null,
      national_id: (editForm.national_id || "").trim() || null,
      nationality: toTitleCase(editForm.nationality || "") || null,
      place_of_birth: toTitleCase(editForm.place_of_birth || "") || null,
      marital_status: editForm.marital_status || null,
      occupation: (editForm.occupation || "").trim() || null,
      education_level: editForm.education_level || null,
      emergency_contact_name: toTitleCase(editForm.emergency_contact_name || "") || null,
      emergency_contact_relation: (editForm.emergency_contact_relation || "").trim() || null,
      emergency_contact_phone: (editForm.emergency_contact_phone || "").trim() || null,
      insurance_provider: (editForm.insurance_provider || "").trim() || null,
      insurance_number: (editForm.insurance_number || "").trim() || null,
      blood_type: editForm.blood_type || null
    };
    const editMrn = Number(selectedPatient.mrn ?? selectedPatient.id);
    const editedHistory = (editForm.history || "").trim();
    try {
      const { error } = await supabase.from("patients").update(payload).eq("mrn", editMrn);
      if (error) throw error;

      // history lives in its own is_clinical()-gated table (see fetchPatients).
      try {
        const { error: histErr } = await supabase.from("patient_clinical_history").upsert({
          patient_mrn: editMrn,
          history: editedHistory || null,
          updated_by: currentUser?.id || null,
        });
        if (histErr) throw histErr;
      } catch (histErr) {
        console.warn("Could not save clinical history edit:", histErr);
      }

      const updated: Patient = {
        ...selectedPatient,
        ...payload,
        phone: payload.phone_number || "",
        email: payload.email || "",
        address: payload.address || "",
        history: editedHistory || "None declared.",
        father_name: payload.father_name || "",
        mother_name: payload.mother_name || "",
        name: [payload.first_name, payload.father_name, payload.surname].filter(Boolean).join(" ")
      };
      setPatients(prev => prev.map(p => (p.id === selectedPatient.id ? updated : p)));
      setSelectedPatient(updated);
      setIsEditPatientModal(false);
      triggerToast("Patient profile updated successfully!");
    } catch (err: any) {
      triggerToast(`Could not update profile: ${err.message}`);
    } finally {
      setIsEditSaving(false);
    }
  };

  // ---- Schedule Appointment ----
  const [isScheduleModal, setIsScheduleModal] = useState(false);
  const [schedForm, setSchedForm] = useState({ date: "", time: "09:00", duration: "1", doctorId: "" });
  const [schedDoctors, setSchedDoctors] = useState<any[]>([]);
  const [schedSaving, setSchedSaving] = useState(false);
  const [schedError, setSchedError] = useState<string | null>(null);

  const openScheduleModal = async () => {
    if (!selectedPatient) return;
    setSchedError(null);
    setSchedForm({ date: new Date().toISOString().slice(0, 10), time: "09:00", duration: "1", doctorId: "" });
    setIsScheduleModal(true);
    try {
      const { data } = await supabase.from("profiles").select("id, full_name").eq("role", "doctor");
      setSchedDoctors(data || []);
    } catch {
      setSchedDoctors([]);
    }
  };

  const handleSaveSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatient) return;
    setSchedSaving(true);
    setSchedError(null);
    try {
      const ts = new Date(`${schedForm.date}T${schedForm.time}:00`);
      if (isNaN(ts.getTime())) throw new Error("Please pick a valid date and time.");
      const { data, error } = await supabase.from("appointments").insert([{
        patient_mrn: Number(selectedPatient.mrn ?? selectedPatient.id),
        doctor_id: schedForm.doctorId || null,
        schedule_time: ts.toISOString(),
        duration_hours: Number(schedForm.duration) || 1
      }]).select();
      if (error) throw error;
      if (data && data[0]) setPatientAppointments(prev => [data[0], ...prev]);
      setIsScheduleModal(false);
      triggerToast("Appointment booked successfully!");
    } catch (err: any) {
      setSchedError(err.message || "Could not book the appointment.");
    } finally {
      setSchedSaving(false);
    }
  };

  // ---- Admit Patient flow (find-or-register, then admission request) ----
  const [isAdmitModal, setIsAdmitModal] = useState(false);
  const [admitPatient, setAdmitPatient] = useState<Patient | null>(null);
  const [admitSearch, setAdmitSearch] = useState("");
  const [admitForm, setAdmitForm] = useState({ reason: "", specialty: "", attendingId: "", expectedDischarge: "" });
  const [admitDoctors, setAdmitDoctors] = useState<any[]>([]);
  const [admitSaving, setAdmitSaving] = useState(false);
  const [admitError, setAdmitError] = useState<string | null>(null);
  const [admitMode, setAdmitMode] = useState(false); // registration was opened from the Admit flow

  const openAdmitModal = async () => {
    setAdmitError(null);
    setAdmitPatient(null);
    setAdmitSearch("");
    setAdmitForm({ reason: "", specialty: "", attendingId: "", expectedDischarge: "" });
    setIsAdmitModal(true);
    try {
      const { data } = await supabase.from("profiles").select("id, full_name").eq("role", "doctor");
      setAdmitDoctors(data || []);
    } catch {
      setAdmitDoctors([]);
    }
  };

  const handleRequestAdmission = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!admitPatient) return;
    if (!admitForm.reason.trim()) {
      setAdmitError("Please enter the reason / admitting diagnosis.");
      return;
    }
    let expected: string | null = null;
    if (admitForm.expectedDischarge.trim()) {
      const m = admitForm.expectedDischarge.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (!m) {
        setAdmitError("Expected discharge must be dd/mm/yyyy (or leave it empty).");
        return;
      }
      expected = `${m[3]}-${m[2]}-${m[1]}`;
    }
    setAdmitSaving(true);
    setAdmitError(null);
    try {
      const { error } = await supabase.from("admissions").insert([{
        patient_mrn: Number(admitPatient.mrn ?? admitPatient.id),
        status: "requested",
        requested_by: currentUser?.id || null,
        reason: admitForm.reason.trim(),
        specialty: admitForm.specialty.trim() || null,
        attending_doctor_id: admitForm.attendingId || null,
        expected_discharge: expected
      }]);
      if (error) {
        if (error.code === "23505" || (error.message || "").includes("one_active")) {
          throw new Error(`${admitPatient.name} already has an active admission or request.`);
        }
        throw error;
      }
      setIsAdmitModal(false);
      setSelectedPatient(admitPatient);
      triggerToast(`Admission requested for ${admitPatient.name} — the admissions desk can now assign a bed.`);
    } catch (err: any) {
      setAdmitError(err.message || "Could not request the admission.");
    } finally {
      setAdmitSaving(false);
    }
  };

  const filteredPatients = patients.filter(p => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    // Strip non-digits and leading zeros so local (03332486) and
    // international (+961 3 332486) formats match each other
    const normPhone = (s: string) => s.replace(/\D/g, "").replace(/^0+/, "");
    const qDigits = normPhone(q);
    // Matches first name, surname, or full name via includes on the full name
    if (nameMatchesQuery(p.name, q)) return true;
    if (p.email && p.email.toLowerCase().includes(q)) return true;
    if (p.mrn !== undefined && String(p.mrn).includes(q)) return true;
    if (qDigits && p.phone && normPhone(p.phone).includes(qDigits)) return true;
    return false;
  });

  return (
    <div className="flex flex-col" id="patients-directory-dashboard">

      <div className="grid grid-cols-12 items-start">
        {/* DETAILS SECTION: HIGH-FIDELITY SIMA CLINICAL WORKSPACE (NOW FULL WIDTH) */}
        <div className="col-span-12 flex flex-col">
          <div className="bg-[#edf1f5] overflow-hidden flex flex-col font-sans min-h-[calc(100vh-60px)]" id="sima-workspace">

              {/* 1. SIMA NAVIGATION / COMMAND RIBBON */}
              <div className="bg-[#2a5178] text-white px-4 py-2 flex items-center justify-between border-b border-[#2a5178] text-xs max-sm:flex-col max-sm:items-start gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-extrabold text-[#edf3f8] uppercase tracking-wider text-[11px] flex items-center gap-1">
                    <Database size={13} className="text-[#c2d5e7]" /> SIMA Workspace
                  </span>
                  <span className="text-slate-300">|</span>
                  <span className="text-[10px] bg-[#2a5178] px-2.5 py-0.5 rounded font-bold font-mono">
                    Encounter: Active Outpatient Session
                  </span>
                  <div className="relative">
                    <button
                      onClick={() => setIsSearchOpen(!isSearchOpen)}
                      className="flex items-center gap-1.5 px-2.5 py-1 bg-white/10 hover:bg-white/20 text-white border border-white/20 rounded text-[10px] font-bold cursor-pointer transition-all"
                    >
                      <Users size={12} className="text-[#c2d5e7]" />
                      <span>{selectedPatient ? `Chart: ${selectedPatient.name}` : "Select Patient"}</span>
                      <ChevronRight size={12} className={`text-slate-300 transition-transform ${isSearchOpen ? "rotate-90" : ""}`} />
                    </button>
                    {/* Search Dropdown Popover */}
          {isSearchOpen && (
            <>
              {/* Overlay background to close the dropdown when clicking outside */}
              <div
                className="fixed inset-0 z-40 cursor-default"
                onClick={() => setIsSearchOpen(false)}
              />
              <div className="absolute left-0 mt-2 w-80 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
                <div className="p-3 border-b bg-slate-50/50">
                  <div className="relative">
                    <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Search by name, MRN, or phone..."
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      className="w-full pl-8.5 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-teal-500"
                      autoFocus
                    />
                  </div>
                </div>

                <div className="max-h-64 overflow-y-auto divide-y divide-slate-100">
                  {isLoading ? (
                    <div className="py-8 text-center text-slate-400 text-xs flex flex-col items-center justify-center gap-1.5">
                      <RefreshCw size={16} className="animate-spin text-[var(--theme-accent)]" />
                      <span>Syncing patients list...</span>
                    </div>
                  ) : filteredPatients.length === 0 ? (
                    <div className="p-6 text-center text-slate-400 text-xs">
                      <p className="font-semibold">No patients found</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">Refine your search, or register a new chart:</p>
                      <button
                        type="button"
                        onClick={() => { setIsSearchOpen(false); setAdmitMode(false); setIsNewPatientModal(true); }}
                        className="mt-2 bg-[var(--theme-accent)] hover:bg-teal-500 text-white px-3 py-1.5 rounded-lg text-[10px] font-bold inline-flex items-center gap-1.5 cursor-pointer transition-all"
                      >
                        <UserPlus size={11} /> Register Patient
                      </button>
                    </div>
                  ) : (
                    filteredPatients.map(p => {
                      const isSelected = selectedPatient?.id === p.id;
                      return (
                        <button
                          key={p.id}
                          onClick={() => {
                            setSelectedPatient(p);
                            setIsSearchOpen(false);
                          }}
                          className={`w-full text-left p-3 hover:bg-slate-50 flex items-center justify-between transition-colors ${
                            isSelected ? "bg-teal-50/40 font-semibold" : ""
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-xs text-slate-800 truncate block">
                                {p.name}
                              </span>
                              <span className="text-[9px] bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded-full font-mono">
                                {calculateAge(p.birth_date)} yrs
                              </span>
                            </div>
                            <div className="text-[10px] text-slate-400 truncate mt-0.5">
                              {p.email || "No email"} &bull; {p.gender}
                            </div>
                          </div>
                          {isSelected && <Check size={12} className="text-[var(--theme-accent)]" />}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </>
          )}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5 text-[10px] text-slate-200">
                    <Clock size={11} className="text-[#c2d5e7]" />
                    <span>Active Session Provider: <strong>{currentUser?.name || "Unassigned"}</strong></span>
                  </div>
                  <button
                    onClick={fetchPatients}
                    disabled={isLoading}
                    title="Refresh Patients"
                    className="p-1.5 bg-white/10 hover:bg-white/20 border border-white/20 text-white rounded cursor-pointer transition-all"
                  >
                    <RefreshCw size={12} className={isLoading ? "animate-spin" : ""} />
                  </button>
                  <button
                    onClick={() => { setIsSearchOpen(false); setFindOrRegisterSearch(""); setIsFindOrRegisterModal(true); }}
                    className="bg-[var(--theme-accent)] hover:bg-teal-500 text-white px-2.5 py-1 rounded text-[10px] font-bold flex items-center gap-1.5 cursor-pointer transition-all"
                  >
                    <UserPlus size={12} /> New Patient
                  </button>
                  {selectedPatient && (
                  <button
                    onClick={() => openNoteWindow(selectedPatient.name, null, currentUser?.name || "Unassigned Provider", selectedPatient.id)}
                    className="bg-[#8f6d1e] hover:bg-[#75581a] text-white font-bold px-2.5 py-1 rounded text-[10px] flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    <Plus size={11} /> Launch Dynamic HUD
                  </button>
                  )}
                </div>
              </div>

              {selectedPatient ? (<>
              {/* 3. CORE MULTI-COLUMN WORKSPACE GRID */}
              <div className="grid grid-cols-12 gap-2 bg-slate-200 p-2 min-h-[580px]">

                {/* COLUMN A: STORY BOARD (Left Rail) - Width 20% on lg */}
                <div className="col-span-12 lg:col-span-3 bg-[#edf3f8] border border-[#c2d5e7] rounded-lg p-3 flex flex-col gap-3 text-xs text-slate-700 shadow-xs">

                  {/* Patient Identity Card */}
                  <div className="flex flex-col items-center text-center p-2.5 bg-white/60 rounded-md border border-[#c2d5e7]/60">
                    <div className="h-16 w-16 rounded-full bg-[#6e9cc9] text-white flex items-center justify-center font-extrabold text-xl border-2 border-white shadow-md mb-2">
                      {selectedPatient.name.split(" ").map(n => n[0]).join("")}
                    </div>
                    <h3 className="font-black text-[#2a5178] text-sm tracking-tight leading-snug">
                      {selectedPatient.name}
                    </h3>
                    <p className="text-[10px] text-slate-500 mt-1 font-semibold">
                      {selectedPatient.gender}, {calculateAge(selectedPatient.birth_date)} y.o. &bull; {formatDateDDMMYYYY(selectedPatient.birth_date)}
                    </p>
                    <span className="text-[9px] bg-slate-200 text-slate-600 px-2 py-0.5 rounded mt-1 font-mono font-bold">
                      MRN: {formatMRNDisplay(selectedPatient.mrn)}
                    </span>
                    <div className="flex items-center gap-1.5 mt-2.5 w-full">
                      <button type="button" onClick={openEditPatient} className="flex-1 bg-white hover:bg-slate-50 border border-[#c2d5e7] text-[#2a5178] text-[9px] font-bold px-2 py-1.5 rounded flex items-center justify-center gap-1 cursor-pointer transition-all">
                        <Edit3 size={10} /> Edit Profile
                      </button>
                      <button type="button" onClick={openScheduleModal} className="flex-1 bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-dark)] text-white text-[9px] font-bold px-2 py-1.5 rounded flex items-center justify-center gap-1 cursor-pointer transition-all">
                        <Calendar size={10} /> Schedule
                      </button>
                    </div>

                    {/* ACTIVE ADMISSION / ROOM ASSIGNMENT */}
                    {activeAdmission && (() => {
                      const bed = (activeAdmission as any).beds;
                      const room = bed?.ward_rooms;
                      const ward = room?.wards;
                      const floorName = ward?.hospital_floors?.name;
                      const isAdmitted = activeAdmission.status === "admitted" && bed;
                      return (
                        <div className={`w-full mt-2 rounded-lg px-2.5 py-2 text-left border ${isAdmitted ? "bg-[#2a5178]/5 border-[#c2d5e7]" : "bg-amber-50 border-amber-200"}`}>
                          <span className={`block text-[8px] font-black uppercase tracking-wider ${isAdmitted ? "text-[#2a5178]" : "text-amber-700"}`}>
                            {isAdmitted ? "Inpatient — Admitted" : "Admission Requested"}
                          </span>
                          {isAdmitted ? (
                            <strong className="text-[11px] text-slate-800 leading-snug block mt-0.5">
                              {[floorName, ward?.name].filter(Boolean).join(" · ")}
                              {room ? ` · Room ${room.room_number}` : ""} · Bed {bed.bed_label}
                            </strong>
                          ) : (
                            <span className="text-[10px] text-amber-800 block mt-0.5">Awaiting bed assignment at the admissions desk</span>
                          )}
                          {activeAdmission.admitted_at && (
                            <span className="text-[9px] text-slate-400 block mt-0.5">Since {new Date(activeAdmission.admitted_at).toLocaleString("en-GB")}</span>
                          )}
                        </div>
                      );
                    })()}
                  </div>

                  {/* CLINICAL ALERT & LAB PANEL TABS (Authentic Solid Badges) */}
                  <div className="flex flex-col gap-1.5">
                    <div className="text-[10px] text-[#2a5178] font-bold uppercase tracking-wider mt-1 px-0.5 flex items-center justify-between border-b border-[#c2d5e7] pb-0.5 shrink-0">
                      <span>Interactive Lab Panels</span>
                      <span className="text-[8px] font-mono font-medium text-slate-400">Click to expand metrics</span>
                    </div>

                    {/* Dynamic Lab Result Panel Tabs */}
                    {patientLabs.map((lab) => {
                      const isExpanded = expandedLabId === lab.id;
                      const bgClass =
                        lab.status === "Danger" ? "bg-[#c05654] border-red-700 hover:bg-red-600" :
                        lab.status === "Warning" ? "bg-[#8f6d1e] border-amber-700 hover:bg-amber-600" :
                        "bg-[#35795c] border-emerald-700 hover:bg-[var(--theme-accent-bg)]merald-600";

                      return (
                        <div key={lab.id} className="flex flex-col gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => setExpandedLabId(isExpanded ? null : lab.id)}
                            className={`w-full ${bgClass} text-white font-extrabold text-[10px] p-1.5 rounded text-center tracking-wider uppercase shadow-xs cursor-pointer flex items-center justify-between px-3 transition-all border`}
                          >
                            <span>{lab.value_display}</span>
                            <span className="text-[8px] font-mono bg-white/20 px-1.5 py-0.5 rounded uppercase">
                              {isExpanded ? "▲ CLOSE" : "▼ VIEW PANEL"}
                            </span>
                          </button>

                          {isExpanded && (
                            <div className="bg-slate-50 border border-slate-200 rounded p-2 flex flex-col gap-1.5 shadow-xs animate-in slide-in-from-top-1 duration-150">
                              <div className="flex justify-between items-center border-b pb-1">
                                <span className="font-extrabold text-[#2a5178] text-[10px] uppercase">{lab.panel_name}</span>
                                <span className="text-[8px] text-slate-400 font-mono">Coll: {formatDateDDMMYYYY(lab.collected_at)}</span>
                              </div>

                              <div className="flex flex-col gap-1">
                                {lab.components.map((comp, cIdx) => {
                                  const flagColor =
                                    comp.flag === "HIGH" ? "text-red-600 font-bold" :
                                    comp.flag === "LOW" ? "text-amber-600 font-bold" :
                                    "text-slate-600";
                                  return (
                                    <div key={cIdx} className="flex justify-between items-center text-[9.5px] border-b border-slate-100/60 pb-0.5 last:border-0 last:pb-0">
                                      <div className="flex flex-col">
                                        <span className="font-semibold text-slate-800">{comp.name}</span>
                                        <span className="text-[8px] text-slate-400">Ref: {comp.reference_range}</span>
                                      </div>
                                      <div className="text-right">
                                        <span className={`${flagColor}`}>{comp.value} {comp.unit}</span>
                                        {comp.flag !== "NORMAL" && (
                                          <span className={`ml-1 text-[7px] font-extrabold px-1 rounded uppercase ${
                                            comp.flag === "HIGH" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
                                          }`}>
                                            {comp.flag}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}

                  </div>

                  {/* High Density Demographics Data -- only real, database-backed fields are shown here */}
                  <div className="bg-white/80 rounded-md border border-slate-200 p-2.5 flex flex-col gap-1.5 text-[11px]">
                    <div>
                      <span className="text-slate-400 font-bold uppercase text-[9px] block">Contact Phone</span>
                      <strong className="text-slate-700">{selectedPatient.phone || "No phone logged"}</strong>
                    </div>
                    <div className="border-t border-slate-100 pt-1">
                      <span className="text-slate-400 font-bold uppercase text-[9px] block">Home Address</span>
                      <strong className="text-slate-700">{selectedPatient.address || "No address logged"}</strong>
                    </div>
                    {selectedPatient.national_id && (
                      <div className="border-t border-slate-100 pt-1">
                        <span className="text-slate-400 font-bold uppercase text-[9px] block">National ID</span>
                        <strong className="text-slate-700">{selectedPatient.national_id}</strong>
                      </div>
                    )}
                    {(selectedPatient.nationality || selectedPatient.place_of_birth) && (
                      <div className="border-t border-slate-100 pt-1">
                        <span className="text-slate-400 font-bold uppercase text-[9px] block">Nationality / Birthplace</span>
                        <strong className="text-slate-700">{[selectedPatient.nationality, selectedPatient.place_of_birth].filter(Boolean).join(" — ")}</strong>
                      </div>
                    )}
                    {(selectedPatient.blood_type || selectedPatient.marital_status || selectedPatient.occupation) && (
                      <div className="border-t border-slate-100 pt-1">
                        <span className="text-slate-400 font-bold uppercase text-[9px] block">Blood / Marital / Occupation</span>
                        <strong className="text-slate-700">{[selectedPatient.blood_type, selectedPatient.marital_status, selectedPatient.occupation].filter(Boolean).join(" • ")}</strong>
                      </div>
                    )}
                    {selectedPatient.emergency_contact_name && (
                      <div className="border-t border-slate-100 pt-1">
                        <span className="text-slate-400 font-bold uppercase text-[9px] block">Emergency Contact</span>
                        <strong className="text-slate-700">
                          {selectedPatient.emergency_contact_name}
                          {selectedPatient.emergency_contact_relation ? ` (${selectedPatient.emergency_contact_relation})` : ""}
                          {selectedPatient.emergency_contact_phone ? ` — ${selectedPatient.emergency_contact_phone}` : ""}
                        </strong>
                      </div>
                    )}
                    {selectedPatient.insurance_provider && (
                      <div className="border-t border-slate-100 pt-1">
                        <span className="text-slate-400 font-bold uppercase text-[9px] block">Insurance</span>
                        <strong className="text-slate-700">{[selectedPatient.insurance_provider, selectedPatient.insurance_number].filter(Boolean).join(" — ")}</strong>
                      </div>
                    )}
                  </div>

                  {/* CLINICAL VITALS BOX */}
                  <div className="bg-[#2a5178]/5 border border-[#c2d5e7] rounded-md p-2.5 flex flex-col gap-2">
                    <div className="flex justify-between items-center border-b border-[#c2d5e7] pb-1">
                      <span className="text-[#2a5178] font-black text-[10px] uppercase tracking-wider block">Physical Metrics & Vitals</span>
                      <button
                        onClick={() => {
                          if (patientVitals && patientVitals.length > 0) {
                            setVitalsHeightInput(String(patientVitals[0].height || ""));
                            setVitalsWeightInput(String(patientVitals[0].weight || ""));
                            setVitalsBpInput(patientVitals[0].blood_pressure || "");
                            setVitalsHrInput(patientVitals[0].heart_rate || "");
                          } else {
                            setVitalsHeightInput("");
                            setVitalsWeightInput("");
                            setVitalsBpInput("");
                            setVitalsHrInput("");
                          }
                          setIsVitalsModalOpen(true);
                        }}
                        className="text-[9px] bg-[#2a5178] hover:bg-[#2a5178] text-white font-bold px-1.5 py-0.5 rounded cursor-pointer transition-colors"
                      >
                        Update & History
                      </button>
                    </div>

                    {isVitalsLoading ? (
                      <div className="text-[10px] text-slate-500 font-mono italic animate-pulse py-2 text-center">Loading physical metrics...</div>
                    ) : (() => {
                      const latest = patientVitals && patientVitals[0];
                      const heightVal = latest ? latest.height : null;
                      const weightVal = latest ? latest.weight : null;
                      const bpVal = latest ? latest.blood_pressure : null;
                      const hrVal = latest ? latest.heart_rate : null;

                      const bmiData = calculateBMI(heightVal || 0, weightVal || 0);

                      return (
                        <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono">
                          <div className="bg-white/90 p-1.5 rounded border border-[#c2d5e7] flex flex-col justify-between">
                            <span className="block text-slate-400 font-sans font-bold text-[8px] uppercase">Height</span>
                            <strong className="text-slate-800 text-xs">
                              {heightVal ? `${heightVal} cm` : "None logged"}
                            </strong>
                          </div>
                          <div className="bg-white/90 p-1.5 rounded border border-[#c2d5e7] flex flex-col justify-between">
                            <span className="block text-slate-400 font-sans font-bold text-[8px] uppercase">Weight</span>
                            <strong className="text-slate-800 text-xs">
                              {weightVal ? `${weightVal} kg` : "None logged"}
                            </strong>
                          </div>
                          <div className="bg-white/90 p-1.5 rounded border border-[#c2d5e7] col-span-2">
                            <span className="block text-slate-400 font-sans font-bold text-[8px] uppercase">Body Mass Index (BMI)</span>
                            <strong className="text-slate-800 text-xs flex justify-between items-center">
                              {bmiData.bmi ? (
                                <>
                                  <span>{bmiData.bmi}</span>
                                  <span className={`font-sans text-[8px] font-bold px-1.5 py-0.2 rounded-full bg-slate-100 ${bmiData.color}`}>
                                    {bmiData.category}
                                  </span>
                                </>
                              ) : (
                                <span className="text-slate-400">--</span>
                              )}
                            </strong>
                          </div>
                          {(bpVal || hrVal) && (
                            <div className="bg-white/90 p-1 border border-[#c2d5e7] col-span-2 rounded text-[8px] text-slate-600 flex justify-between px-1.5">
                              {bpVal && <span>Blood Pressure: <strong className="text-slate-800">{bpVal}</strong></span>}
                              {hrVal && <span>Heart Rate: <strong className="text-slate-800">{hrVal} bpm</strong></span>}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>

                  {/* CARE GAPS */}
                  <div className="mt-auto pt-2">
                    <div className="bg-amber-50 border border-amber-200 p-2 rounded text-[10px] leading-relaxed text-amber-900">
                      <strong>CARE GAP DETECTED:</strong> COVID-19 Vaccine (1 - 2025 Series) has no booster confirmation logged.
                    </div>
                  </div>

                </div>

                {/* COLUMN B: MAIN WORKSPACE CHART REVIEW / ACTIVE TAB CONTENT (Width 53% or 66.6% on lg depending on right panel) */}
                <div className={`col-span-12 ${showNoteWorkspace || activeWorkspaceTab === "orders" ? "lg:col-span-5" : "lg:col-span-9"} bg-white border border-slate-300 rounded-lg flex flex-col overflow-hidden shadow-xs`}>

                  {/* MAIN WORKSPACE SECTION TABS (horizontal, top of content area) */}
              <div className="bg-slate-100 border-b border-slate-200 px-3 py-2 flex items-center justify-between gap-4 max-sm:flex-col max-sm:items-stretch">
                <div className="flex items-center gap-1 flex-wrap">
                  <button
                    onClick={() => setActiveWorkspaceTab("chart_review")}
                    className={`px-3 py-1.5 rounded text-[11px] font-bold transition-all flex items-center gap-1.5 border cursor-pointer ${
                      activeWorkspaceTab === "chart_review"
                        ? "bg-[var(--theme-accent)] text-white border-[var(--theme-accent)] shadow-xs"
                        : "bg-white text-slate-600 hover:bg-slate-50 border-slate-200"
                    }`}
                  >
                    <FileText size={12} /> Chart Review
                  </button>
                  <button
                    onClick={() => setActiveWorkspaceTab("synopsis")}
                    className={`px-3 py-1.5 rounded text-[11px] font-bold transition-all flex items-center gap-1.5 border cursor-pointer ${
                      activeWorkspaceTab === "synopsis"
                        ? "bg-[var(--theme-accent)] text-white border-[var(--theme-accent)] shadow-xs"
                        : "bg-white text-slate-600 hover:bg-slate-50 border-slate-200"
                    }`}
                  >
                    <Activity size={12} /> Synopsis Trends
                  </button>
                  <button
                    onClick={() => setActiveWorkspaceTab("assessment")}
                    className={`px-3 py-1.5 rounded text-[11px] font-bold transition-all flex items-center gap-1.5 border cursor-pointer ${
                      activeWorkspaceTab === "assessment"
                        ? "bg-[var(--theme-accent)] text-white border-[var(--theme-accent)] shadow-xs"
                        : "bg-white text-slate-600 hover:bg-slate-50 border-slate-200"
                    }`}
                  >
                    <Heart size={12} /> Active Screenings
                  </button>
                  <button
                    onClick={() => setActiveWorkspaceTab("plan")}
                    className={`px-3 py-1.5 rounded text-[11px] font-bold transition-all flex items-center gap-1.5 border cursor-pointer ${
                      activeWorkspaceTab === "plan"
                        ? "bg-[var(--theme-accent)] text-white border-[var(--theme-accent)] shadow-xs"
                        : "bg-white text-slate-600 hover:bg-slate-50 border-slate-200"
                    }`}
                  >
                    <ClipboardList size={12} /> Plan of Care
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveWorkspaceTab("orders")}
                    className={`px-3 py-1.5 rounded text-[11px] font-bold transition-all flex items-center gap-1.5 border cursor-pointer ${
                      activeWorkspaceTab === "orders"
                        ? "bg-[var(--theme-accent)] text-white border-[var(--theme-accent)] shadow-xs"
                        : "bg-white text-slate-600 hover:bg-slate-50 border-slate-200"
                    }`}
                  >
                    <Syringe size={12} /> Orders
                    {patientOrders.filter(o => o.status === "active").length > 0 && (
                      <span className="bg-white/25 px-1.5 rounded-full text-[9px]">{patientOrders.filter(o => o.status === "active").length}</span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveWorkspaceTab("medications")}
                    className={`px-3 py-1.5 rounded text-[11px] font-bold transition-all flex items-center gap-1.5 border cursor-pointer ${
                      activeWorkspaceTab === "medications"
                        ? "bg-[var(--theme-accent)] text-white border-[var(--theme-accent)] shadow-xs"
                        : "bg-white text-slate-600 hover:bg-slate-50 border-slate-200"
                    }`}
                  >
                    <Pill size={12} /> Medications
                    {patientMedications.length > 0 && (
                      <span className="bg-white/25 px-1.5 rounded-full text-[9px]">{patientMedications.length}</span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveWorkspaceTab("contact_log")}
                    className={`px-3 py-1.5 rounded text-[11px] font-bold transition-all flex items-center gap-1.5 border cursor-pointer ${
                      activeWorkspaceTab === "contact_log"
                        ? "bg-[var(--theme-accent)] text-white border-[var(--theme-accent)] shadow-xs"
                        : "bg-white text-slate-600 hover:bg-slate-50 border-slate-200"
                    }`}
                  >
                    <PhoneCall size={12} /> Contact Log
                    {contactLog.length > 0 && (
                      <span className="bg-white/25 px-1.5 rounded-full text-[9px]">{contactLog.length}</span>
                    )}
                  </button>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider bg-slate-200 px-2 py-0.5 rounded">
                    MRN: {formatMRNDisplay(selectedPatient.mrn)}
                  </span>
                </div>
              </div>

                  {/* CHART REVIEW TABS (horizontal, under the section tabs) */}
                  {activeWorkspaceTab === "chart_review" && (
                    <div className="bg-slate-50 border-b flex items-center gap-1 px-2 py-1 text-[11px] overflow-x-auto shrink-0">
                      {[
                        { key: "notes", label: "Note" },
                        { key: "note_template", label: "Note Templates" },
                        { key: "photos", label: `Photo Timeline (${patientPhotos.length})` },
                        { key: "labs", label: `Labs (${patientLabs.length})` },
                        { key: "encounters", label: `Encounters & Appts (${patientAppointments.length})` },
                      ].map(t => {
                        const isActive = t.key === "labs"
                          ? ["labs", "lab_trends", "all_labs", "media"].includes(chartReviewSubTab)
                          : chartReviewSubTab === t.key;
                        return (
                          <button
                            key={t.key}
                            type="button"
                            onClick={() => setChartReviewSubTab(t.key as any)}
                            className={`px-3 py-1.5 font-bold transition-all border-b-2 -mb-[1px] cursor-pointer whitespace-nowrap ${
                              isActive ? "border-[var(--theme-accent)] text-[var(--theme-accent)]" : "border-transparent text-slate-500"
                            }`}
                          >
                            {t.label}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <div className="flex-1 flex flex-col overflow-hidden min-w-0">

                  {/* TAB RENDERER BASED ON activeWorkspaceTab */}
                  {activeWorkspaceTab === "chart_review" && (
                    <div className="flex-1 flex flex-col">
                      {/* LABS HUB: every lab view lives under the single "Labs" tab */}
                      {["labs", "lab_trends", "all_labs", "media"].includes(chartReviewSubTab) && (
                        <div className="bg-slate-100 border-b flex items-center gap-1 px-2 py-1 text-[11px] shrink-0">
                          <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider mr-1.5">Labs</span>
                          <button
                            onClick={() => setChartReviewSubTab("labs")}
                            className={`px-3 py-1.5 font-bold transition-all border-b-2 -mb-[1px] cursor-pointer ${
                              chartReviewSubTab === "labs" ? "border-[var(--theme-accent)] text-[var(--theme-accent)]" : "border-transparent text-slate-500"
                            }`}
                          >
                            Results ({patientLabs.length})
                          </button>
                          <button
                            onClick={() => setChartReviewSubTab("lab_trends")}
                            className={`px-3 py-1.5 font-bold transition-all border-b-2 -mb-[1px] cursor-pointer ${
                              chartReviewSubTab === "lab_trends" ? "border-[var(--theme-accent)] text-[var(--theme-accent)]" : "border-transparent text-slate-500"
                            }`}
                          >
                            Trends 📈
                          </button>
                          <button
                            onClick={() => setChartReviewSubTab("all_labs")}
                            className={`px-3 py-1.5 font-bold transition-all border-b-2 -mb-[1px] cursor-pointer ${
                              chartReviewSubTab === "all_labs" ? "border-[var(--theme-accent)] text-[var(--theme-accent)]" : "border-transparent text-slate-500"
                            }`}
                          >
                            Full Table 📋
                          </button>
                          <button
                            onClick={() => setChartReviewSubTab("media")}
                            className={`px-3 py-1.5 font-bold transition-all border-b-2 -mb-[1px] cursor-pointer ${
                              chartReviewSubTab === "media" ? "border-[var(--theme-accent)] text-[var(--theme-accent)]" : "border-transparent text-slate-500"
                            }`}
                          >
                            Media / Extract 📄
                          </button>
                        </div>
                      )}

                      {/* Timeline table toolbar - only shown on Note and Note Templates sub-tabs */}
                      {(chartReviewSubTab === "notes" || chartReviewSubTab === "note_template") && (
                        <div className="p-2.5 bg-slate-50 border-b border-slate-200 flex flex-col gap-2 shrink-0">
                          <div className="flex items-center justify-between text-[11px] gap-2 flex-wrap">
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={fetchPatients}
                                className="bg-white hover:bg-slate-100 border p-1 rounded font-bold text-[10px] flex items-center gap-1 text-slate-600 cursor-pointer"
                              >
                                <RefreshCw size={11} /> Refresh Chart
                              </button>
                              <span className="text-slate-300">|</span>
                              <span className="font-extrabold text-slate-500 uppercase text-[9px] tracking-wider">Advanced Chronological Filtering</span>
                            </div>

                            <button
                              type="button"
                              onClick={handleCreateNewBlankNote}
                              className="bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-dark)] text-white font-bold px-2 py-1 rounded text-[10px] flex items-center gap-1 cursor-pointer"
                            >
                              <Plus size={11} /> Write Note
                            </button>
                          </div>

                          {/* Granular Filtering Bar (Selects & Checkboxes) */}
                          <div className="bg-white p-2 rounded border border-slate-200/80 flex flex-wrap items-center justify-between gap-2.5 text-[10px]">
                            <div className="flex items-center gap-3.5 flex-wrap">
                              <div className="flex items-center gap-1">
                                <span className="font-bold text-slate-400 uppercase text-[9px]">Dept:</span>
                                <select
                                  value={departmentFilter}
                                  onChange={(e) => setDepartmentFilter(e.target.value as any)}
                                  className="bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5 text-[10px] font-bold text-[#2a5178] focus:outline-none"
                                >
                                  <option value="All">All Departments</option>
                                  <option value="Cardiology">Cardiology</option>
                                  <option value="Internal Medicine">Internal Medicine</option>
                                  <option value="Rheumatology">Rheumatology</option>
                                  <option value="General">General / Family Medicine</option>
                                </select>
                              </div>

                              <div className="flex items-center gap-1">
                                <span className="font-bold text-slate-400 uppercase text-[9px]">Author:</span>
                                <select
                                  value={authorFilter}
                                  onChange={(e) => setAuthorFilter(e.target.value as any)}
                                  className="bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5 text-[10px] font-bold text-[#2a5178] focus:outline-none"
                                >
                                  <option value="All">All Authors</option>
                                  {Array.from(new Set(patientNotes.map(n => n.doctor_name).filter(Boolean))).map((name) => (
                                    <option key={name} value={name}>{name}</option>
                                  ))}
                                </select>
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5">
                              <input
                                type="checkbox"
                                id="hide-additional-notes-check"
                                checked={hideAddlNotes}
                                onChange={(e) => setHideAddlNotes(e.target.checked)}
                                className="rounded text-[var(--theme-accent)] focus:ring-[var(--theme-accent)] h-3.5 w-3.5 cursor-pointer"
                              />
                              <label htmlFor="hide-additional-notes-check" className="font-bold text-slate-500 uppercase text-[9px] tracking-wide cursor-pointer select-none">
                                Hide Add'l Notes
                              </label>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Tab content displays */}
                      <div className="flex-1 overflow-y-auto p-3 text-xs">

                        {chartReviewSubTab === "notes" && (
                          <div className="flex flex-col gap-4">

                            {/* CHRONOLOGICAL SEGMENT 1: RECENT CLINICAL NOTES */}
                            <div>
                              <div className="border-b-2 border-slate-200 pb-1 mb-2 text-[#2a5178] font-extrabold text-[11px] flex items-center justify-between">
                                <span>Recent Encounter Drafts / Notes</span>
                                <span className="text-[10px] text-[var(--theme-accent)] font-bold">Active</span>
                              </div>

                              {(() => {
                                const list = patientNotes.filter(n => {
                                  if (authorFilter !== "All" && n.doctor_name && !n.doctor_name.toLowerCase().includes(authorFilter.split(",")[0].toLowerCase().trim())) return false;
                                  if (departmentFilter === "General" && n.content?.includes("Endocrinology")) return false;
                                  return true;
                                });

                                if (list.length === 0) {
                                  return (
                                    <div className="text-center py-6 bg-slate-50 border border-dashed rounded-lg text-slate-400 text-[11px]">
                                      No recent notes match active filter selections.
                                    </div>
                                  );
                                }

                                return (
                                  <div className="flex flex-col gap-2">
                                    {list.map((note) => {
                                      const isSelected = activeMyNote?.id === note.id;
                                      const noteDate = note.created_at ? new Date(note.created_at).toLocaleDateString("en-GB") : new Date().toLocaleDateString("en-GB");
                                      return (
                                        <button
                                          key={note.id}
                                          type="button"
                                          onClick={() => handleSelectNoteForEdit(note)}
                                          className={`w-full text-left p-3 rounded-lg border transition-all flex flex-col gap-1 cursor-pointer ${
                                            isSelected
                                              ? "bg-[#edf3f8] border-[var(--theme-accent)] shadow-xs"
                                              : "bg-white hover:bg-slate-50 border-slate-200"
                                          }`}
                                        >
                                          <div className="flex justify-between items-center gap-2">
                                            <div className="flex items-center gap-2">
                                              <span className="font-bold text-[#2a5178]">{noteDate} 10:30</span>
                                              {note.content?.includes("[SIGNED ELECTRONICALLY]") ? (
                                                <span className="bg-[var(--theme-accent-bg)]merald-100 text-emerald-800 text-[9px] font-black px-1.5 py-0.5 rounded border border-emerald-200 uppercase">Signed</span>
                                              ) : (
                                                <span className="bg-amber-100 text-amber-800 text-[9px] font-black px-1.5 py-0.5 rounded border border-amber-200 uppercase">Draft</span>
                                              )}
                                            </div>
                                            <span className="font-semibold text-slate-400 text-[10px]">{note.doctor_name || "Unassigned Provider"}</span>
                                          </div>

                                          <div className="text-slate-600 truncate text-[11px] leading-snug">
                                            {note.content ? stripHtmlTags(note.content).substring(0, 120) + "..." : "Empty note content draft..."}
                                          </div>

                                          {note.note_data?.totalScore !== undefined && (
                                            <div className="mt-1 flex items-center gap-1 text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded w-fit">
                                              <ClipboardList size={11} />
                                              <span>GAD-7 Anxiety Scale: {note.note_data.totalScore}/21 ({note.note_data.severity})</span>
                                            </div>
                                          )}
                                        </button>
                                      );
                                    })}
                                  </div>
                                );
                              })()}
                            </div>

                            {/* CHRONOLOGICAL ARCHIVES */}
                            {!hideAddlNotes && (() => {
                              const archives = getArchivedNotesForPatient(selectedPatient.name);
                              const filtered = archives.filter(arch => {
                                if (departmentFilter !== "All" && arch.department !== departmentFilter) return false;
                                if (authorFilter !== "All" && arch.author !== authorFilter) return false;
                                return true;
                              });

                              if (filtered.length === 0) return null;

                              // Group them by time periods
                              const periods = ["6 Months Ago", "3 Years Ago", "5 Years Ago"] as const;

                              return periods.map(period => {
                                const periodNotes = filtered.filter(n => n.timePeriod === period);
                                if (periodNotes.length === 0) return null;

                                return (
                                  <div key={period} className="mt-3">
                                    <div className="border-b border-slate-200 pb-1 mb-2 text-slate-400 font-extrabold text-[10px] uppercase tracking-wider flex justify-between items-center">
                                      <span>{period} Encounter Archives</span>
                                      <span className="text-[9px] text-slate-400">{periodNotes.length} Note{periodNotes.length > 1 ? "s" : ""}</span>
                                    </div>
                                    <div className="flex flex-col gap-2">
                                      {periodNotes.map(arch => {
                                        const isExpanded = expandedArchiveId === arch.id;
                                        return (
                                          <div
                                            key={arch.id}
                                            className="bg-white border rounded-lg overflow-hidden hover:border-[var(--theme-accent)]/60 transition-all shadow-xs"
                                          >
                                            <button
                                              type="button"
                                              onClick={() => setExpandedArchiveId(isExpanded ? null : arch.id)}
                                              className="w-full text-left p-3 text-slate-500 leading-normal flex justify-between items-center hover:bg-slate-50/50 cursor-pointer"
                                            >
                                              <div>
                                                <strong className="text-slate-700 block text-[11px] font-bold">{arch.title} ({arch.dateStr})</strong>
                                                <span className="text-[10px] block mt-0.5">Author: {arch.author} &bull; Dept: {arch.department}</span>
                                              </div>
                                              <div className="flex items-center gap-1.5 shrink-0">
                                                <span className="bg-slate-100 text-slate-500 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase">Archived</span>
                                                <span className="text-xs text-slate-400">{isExpanded ? "▲" : "▼"}</span>
                                              </div>
                                            </button>

                                            {isExpanded && (
                                              <div className="bg-slate-50 border-t p-3 text-[11px] text-slate-600 space-y-2 animate-in fade-in duration-200">
                                                <p className="font-sans whitespace-pre-wrap leading-relaxed italic bg-white p-2.5 rounded border border-slate-200 shadow-inner">
                                                  "{arch.content}"
                                                </p>
                                                <div className="flex justify-end gap-1.5">
                                                  <button
                                                    type="button"
                                                    onClick={() => {
                                                      setActiveNoteContent(prev => {
                                                        const insertHeader = prev ? `\n\n--- Imported from ${arch.title} (${arch.dateStr}) ---\n` : "";
                                                        return prev ? prev + insertHeader + arch.content : arch.content;
                                                      });
                                                      triggerToast(`Appended archived note content to My Note Workspace!`);
                                                    }}
                                                    className="bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-dark)] text-white font-bold text-[9px] px-2 py-1 rounded flex items-center gap-1 cursor-pointer transition-colors"
                                                  >
                                                    <PlusCircle size={10} /> Insert into Workspace
                                                  </button>
                                                </div>
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                );
                              });
                            })()}

                          </div>
                        )}

                        {chartReviewSubTab === "note_template" && (
                          <div className="flex flex-col gap-4 animate-in fade-in duration-200">
                            {/* Template Selector dropdown */}
                            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                              <label className="block text-[10px] font-extrabold uppercase text-slate-500 mb-1 tracking-wide">
                                Select Note Template / Clinical Test
                              </label>
                              <select
                                value={selectedTemplateId}
                                onChange={(e) => setSelectedTemplateId(e.target.value)}
                                className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-xs text-slate-700 font-medium focus:ring-1 focus:ring-[var(--theme-accent)] focus:border-[var(--theme-accent)] outline-none cursor-pointer"
                              >
                                <optgroup label="Clinical Tests & Scales">
                                  <option value="gad-7">GAD-7 Anxiety Scale</option>
                                </optgroup>
                                <optgroup label="Standard Note Templates">
                                  <option value="temp-soap">SOAP Progress Note</option>
                                  <option value="temp-cardio">Cardiology Follow-up</option>
                                  <option value="temp-hema">Hematology Lab Review</option>
                                  <option value="temp-pediatric">Pediatric Well-Child Exam</option>
                                </optgroup>
                                {customTemplates.length > 0 && (
                                  <optgroup label="My Custom Templates">
                                    {customTemplates.map(temp => (
                                      <option key={temp.id} value={temp.id}>{temp.title}</option>
                                    ))}
                                  </optgroup>
                                )}
                              </select>
                            </div>

                            {/* GAD-7 CLINICAL TEST SCALE */}
                            {selectedTemplateId === "gad-7" && (
                              <div className="bg-white border rounded-lg p-4 space-y-4 shadow-2xs">
                                <div className="border-b pb-2">
                                  <div className="flex justify-between items-center gap-2 flex-wrap">
                                    <h4 className="font-bold text-xs text-[var(--theme-accent)] flex items-center gap-1">
                                      <ClipboardList size={14} /> GAD-7 Anxiety Scale
                                    </h4>
                                    {(() => {
                                      const score = gad7Answers.reduce((a, b) => a + b, 0);
                                      let sev = "Minimal";
                                      let color = "bg-green-100 text-green-800 border-green-200";
                                      if (score >= 15) { sev = "Severe"; color = "bg-red-100 text-red-800 border-red-200"; }
                                      else if (score >= 10) { sev = "Moderate"; color = "bg-amber-100 text-amber-800 border-amber-200"; }
                                      else if (score >= 5) { sev = "Mild"; color = "bg-blue-100 text-blue-800 border-blue-200"; }
                                      return (
                                        <span className={`px-2 py-0.5 rounded font-black text-[10px] border uppercase tracking-wider ${color}`}>
                                          Score: {score}/21 ({sev})
                                        </span>
                                      );
                                    })()}
                                  </div>
                                  <p className="text-[10px] text-slate-500 italic mt-1 leading-normal">
                                    Over the last two weeks, how often have you been bothered by the following problems?
                                  </p>
                                </div>

                                <div className="space-y-3">
                                  {[
                                    "Feeling nervous, anxious, or on edge",
                                    "Not being able to stop or control worrying",
                                    "Worrying too much about different things",
                                    "Trouble relaxing",
                                    "Being so restless that it's hard to sit still",
                                    "Becoming easily annoyed or irritable",
                                    "Feeling afraid, as if something awful might happen"
                                  ].map((qText, idx) => {
                                    const currentVal = gad7Answers[idx];
                                    return (
                                      <div key={idx} className="space-y-1.5 p-2 bg-slate-50 rounded border border-slate-100/80">
                                        <div className="text-[11px] font-semibold text-slate-700 leading-normal">
                                          {idx + 1}. {qText}
                                        </div>
                                        <div className="grid grid-cols-4 gap-1">
                                          {[
                                            { val: 0, label: "Not at all" },
                                            { val: 1, label: "Several days" },
                                            { val: 2, label: "Half the days" },
                                            { val: 3, label: "Nearly daily" }
                                          ].map(opt => (
                                            <button
                                              key={opt.val}
                                              type="button"
                                              onClick={() => {
                                                const updated = [...gad7Answers];
                                                updated[idx] = opt.val;
                                                setGad7Answers(updated);
                                              }}
                                              className={`py-1 px-1 rounded text-[9px] font-bold border transition-all cursor-pointer ${
                                                currentVal === opt.val
                                                  ? "bg-[var(--theme-accent)] text-white border-[var(--theme-accent)]"
                                                  : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"
                                              }`}
                                            >
                                              {opt.val} - {opt.label}
                                            </button>
                                          ))}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>

                                {/* GAD-7 Difficulty Question */}
                                <div className="bg-slate-50 border border-slate-200 rounded p-2.5 space-y-1.5">
                                  <label className="block text-[10px] font-extrabold uppercase text-slate-500 tracking-wide">
                                    Functional Impact / Difficulty
                                  </label>
                                  <p className="text-[10px] text-slate-500 leading-normal italic">
                                    If you checked off any problems, how difficult have these problems made it for you to do your work, take care of things at home, or get along with other people?
                                  </p>
                                  <select
                                    value={gad7Difficulty}
                                    onChange={(e) => setGad7Difficulty(e.target.value)}
                                    className="w-full bg-white border border-slate-300 rounded px-2.5 py-1 text-xs text-slate-700 font-medium focus:ring-1 focus:ring-[var(--theme-accent)] outline-none cursor-pointer"
                                  >
                                    <option value="Not difficult at all">Not difficult at all</option>
                                    <option value="Somewhat difficult">Somewhat difficult</option>
                                    <option value="Very difficult">Very difficult</option>
                                    <option value="Extremely difficult">Extremely difficult</option>
                                  </select>
                                </div>

                                {/* Actions for GAD-7 */}
                                <div className="flex gap-2 justify-end flex-wrap">
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      // Save Completed GAD-7 as a signed Note in Patient's records
                                      const score = gad7Answers.reduce((a, b) => a + b, 0);
                                      let sev = "Minimal anxiety";
                                      let interp = "Minimal clinical symptoms of generalized anxiety.";
                                      if (score >= 15) { sev = "Severe anxiety"; interp = "Severe generalized anxiety symptoms. Clinical intervention highly recommended."; }
                                      else if (score >= 10) { sev = "Moderate anxiety"; interp = "Moderate generalized anxiety symptoms. Clinical monitoring and diagnostic review warranted."; }
                                      else if (score >= 5) { sev = "Mild anxiety"; interp = "Mild generalized anxiety symptoms. Supportive counselling and routine follow-up suggested."; }

                                      const reportText = `--- CLINICAL SCALE REPORT: GAD-7 ANXIETY SCALE ---
Patient Name: ${selectedPatient.name}
Completed At: ${new Date().toLocaleString("en-GB")}

RESPONSES:
1. Feeling nervous, anxious, or on edge: ${gad7Answers[0]}
2. Not being able to stop or control worrying: ${gad7Answers[1]}
3. Worrying too much about different things: ${gad7Answers[2]}
4. Trouble relaxing: ${gad7Answers[3]}
5. Being so restless that it's hard to sit still: ${gad7Answers[4]}
6. Becoming easily annoyed or irritable: ${gad7Answers[5]}
7. Feeling afraid, as if something awful might happen: ${gad7Answers[6]}

Difficulty rating: ${gad7Difficulty}

TOTAL SCORE: ${score} / 21
SEVERITY: ${sev}
INTERPRETATION: ${interp}

[SIGNED ELECTRONICALLY]
Assessing Provider: ${currentUser?.name || "Unassigned Provider"}
Registry Status: VERIFIED`;

                                      const notePayload = {
                                        patient_id: selectedPatient.id || null,
                                        doctor_id: currentUser?.id || null,
                                        content: reportText,
                                        blood_pressure: activeNoteBp || null,
                                        heart_rate: activeNoteHr || null,
                                        diagnosis: "F41.1 Generalized Anxiety Disorder",
                                        follow_up_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                                        visit_date: new Date().toISOString(),
                                        created_by: currentUser?.id || null,
                                        note_data: {
                                          formId: "gad-7",
                                          title: "GAD-7 Anxiety Scale Assessment",
                                          completedAt: new Date().toISOString(),
                                          totalScore: score,
                                          severity: sev,
                                          interpretation: interp,
                                          answers: {
                                            q1: gad7Answers[0],
                                            q2: gad7Answers[1],
                                            q3: gad7Answers[2],
                                            q4: gad7Answers[3],
                                            q5: gad7Answers[4],
                                            q6: gad7Answers[5],
                                            q7: gad7Answers[6],
                                            difficulty: gad7Difficulty
                                          }
                                        }
                                      };

                                      try {
                                        const { data, error } = await supabase
                                          .from("visit_notes")
                                          .insert([notePayload])
                                          .select();
                                        if (error) throw error;

                                        // Update notes list in UI
                                        if (data && data[0]) {
                                          setPatientNotes(prev => [data[0], ...prev]);
                                        }
                                        triggerToast(`GAD-7 assessment successfully saved to ${selectedPatient.name}'s Note file!`);
                                      } catch (err: any) {
                                        // Local state fallback in case of connection limits
                                        const fallbackItem = {
                                          id: `sim-note-${Date.now()}`,
                                          ...notePayload,
                                          created_at: new Date().toISOString()
                                        };
                                        setPatientNotes(prev => [fallbackItem, ...prev]);
                                        triggerToast(`Saved GAD-7 assessment to ${selectedPatient.name}'s offline file!`);
                                      }
                                    }}
                                    className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[9px] px-2.5 py-1.5 rounded flex items-center gap-1 cursor-pointer transition-colors"
                                  >
                                    <Save size={11} /> Save to Patient Notes
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => {
                                      const score = gad7Answers.reduce((a, b) => a + b, 0);
                                      let sev = "Minimal anxiety";
                                      if (score >= 15) sev = "Severe anxiety";
                                      else if (score >= 10) sev = "Moderate anxiety";
                                      else if (score >= 5) sev = "Mild anxiety";

                                      const formatReport = `--- GAD-7 Anxiety Scale Assessment ---
Completed At: ${formatDateDDMMYYYY(new Date())}
Total Score: ${score}/21 (${sev})
Difficulty: ${gad7Difficulty}
Question Responses: [${gad7Answers.join(", ")}]`;

                                      setActiveNoteContent(prev => prev ? prev + "\n\n" + formatReport : formatReport);
                                      triggerToast("Inserted completed GAD-7 summary into note workspace!");
                                    }}
                                    className="bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-dark)] text-white font-bold text-[9px] px-2.5 py-1.5 rounded flex items-center gap-1 cursor-pointer transition-colors"
                                  >
                                    <PlusCircle size={11} /> Insert GAD-7 into Note
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* STANDARD AND CUSTOM TEXT TEMPLATES */}
                            {selectedTemplateId !== "gad-7" && (() => {
                              const standardTemplatesList = [
                                {
                                  id: "temp-soap",
                                  title: "SOAP Progress Note",
                                  category: "General Practice",
                                  content: "SUBJECTIVE:\nPatient reports:\n\nOBJECTIVE:\nVital signs reviewed. Physical exam:\n\nASSESSMENT:\nClinical findings:\n\nPLAN:\n1. Medications:\n2. Follow-up diagnostic tests:\n3. Return parameters:"
                                },
                                {
                                  id: "temp-cardio",
                                  title: "Cardiology Follow-up",
                                  category: "Specialist",
                                  content: "CHIEF COMPLAINT:\nChest pain or shortness of breath updates:\n\nCARDIAC ASSESSMENT:\nHeart sounds:\nECG findings (if available):\n\nASSESSMENT & PLAN:\nHypertension / CAD management details:\nMedication adjustments:"
                                },
                                {
                                  id: "temp-hema",
                                  title: "Hematology Lab Review",
                                  category: "Lab Review",
                                  content: "LAB REVIEW SUMMARY:\nRed blood cells, white blood cells, and platelets overview:\nAbnormal indicators flagged:\n\nDIAGNOSTIC WORKUP:\nReview of underlying marrow or peripheral pathology:\n\nTHERAPEUTIC PLAN:\nIron infusion, vitamins, or pharmaceutical therapeutics:\nNext blood panel schedule:"
                                },
                                {
                                  id: "temp-pediatric",
                                  title: "Pediatric Well-Child Exam",
                                  category: "Pediatrics",
                                  content: "DEVELOPMENTAL MILESTONES:\nCognitive and motor milestones updates:\n\nPHYSICAL EXAMINATION:\nWeight & height percentiles:\nAbdominal, ENT, and respiratory reviews:\n\nIMMUNIZATIONS:\nVaccinations administered today:\nNext scheduled immunization:"
                                }
                              ];

                              const standardTemp = standardTemplatesList.find(t => t.id === selectedTemplateId);
                              const customTemp = customTemplates.find(t => t.id === selectedTemplateId);
                              const templateToRender = standardTemp || customTemp;

                              if (!templateToRender) return null;

                              return (
                                <div className="bg-white border rounded-lg p-4 space-y-3 shadow-2xs">
                                  <div>
                                    <div className="flex justify-between items-center gap-2">
                                      <h4 className="font-bold text-xs text-[var(--theme-accent)]">{templateToRender.title}</h4>
                                      <span className="bg-slate-100 text-slate-500 font-extrabold text-[9px] px-1.5 py-0.5 rounded border border-slate-200/50 uppercase tracking-wide">
                                        {templateToRender.category || "Custom"}
                                      </span>
                                    </div>
                                    <p className="text-[9px] text-slate-400 mt-1 uppercase tracking-wider font-extrabold">Template Text Preview:</p>
                                  </div>

                                  <div className="border border-slate-200 rounded p-2.5 bg-slate-50 font-mono text-[11px] whitespace-pre-wrap leading-relaxed text-slate-600 select-all shadow-inner">
                                    {templateToRender.content}
                                  </div>

                                  <div className="flex gap-2 justify-end">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (editorRef.current) {
                                          insertTemplateAtCursor(templateToRender.content);
                                        } else {
                                          const interpolated = interpolateTemplate(templateToRender.content);
                                          const htmlFormatted = interpolated.replace(/\n/g, "<br/>");
                                          setActiveNoteContent(prev => prev ? prev + "<br/><br/>" + htmlFormatted : htmlFormatted);
                                          triggerToast(`Applied template: ${templateToRender.title}`);
                                        }
                                      }}
                                      className="bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-dark)] text-white font-bold text-[9px] px-2.5 py-1.5 rounded flex items-center gap-1 cursor-pointer transition-colors"
                                    >
                                      <PlusCircle size={11} /> Insert Template into Note
                                    </button>
                                  </div>
                                </div>
                              );
                            })()}

                            {/* SAVE NEW CUSTOM NOTE TEMPLATE SECTION */}
                            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
                              <h4 className="font-extrabold text-slate-600 text-[10px] uppercase tracking-wider flex items-center gap-1">
                                <Sparkles size={12} className="text-[var(--theme-accent)]" /> Save New Custom Note Template
                              </h4>
                              <p className="text-[10px] text-slate-500 leading-normal">
                                Create a reusable structured template layout. It will be immediately saved and accessible in the dropdown selection.
                              </p>

                              <div className="space-y-2">
                                <div>
                                  <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Template Title</label>
                                  <input
                                    type="text"
                                    placeholder="e.g. Neurology Intake Assessment"
                                    value={newTemplateTitle}
                                    onChange={(e) => setNewTemplateTitle(e.target.value)}
                                    className="w-full bg-white border border-slate-300 rounded px-2.5 py-1 text-xs text-slate-700 placeholder-slate-400 focus:ring-1 focus:ring-[var(--theme-accent)] outline-none"
                                  />
                                </div>

                                <div>
                                  <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Category</label>
                                  <input
                                    type="text"
                                    placeholder="e.g. Neurology, Follow-up, Well-child"
                                    value={newTemplateCategory}
                                    onChange={(e) => setNewTemplateCategory(e.target.value)}
                                    className="w-full bg-white border border-slate-300 rounded px-2.5 py-1 text-xs text-slate-700 placeholder-slate-400 focus:ring-1 focus:ring-[var(--theme-accent)] outline-none"
                                  />
                                </div>

                                <div>
                                  <label className="block text-[10px] font-bold text-slate-500 mb-1">Select Template Icon</label>
                                  <div className="flex gap-1.5 flex-wrap">
                                    {["📋", "🩺", "🧠", "❤️", "🫁", "📊", "👶", "🤰", "🧬", "🧪", "🦴", "👁️", "🩹"].map((emoji) => (
                                      <button
                                        key={emoji}
                                        type="button"
                                        onClick={() => setNewTemplateIcon(emoji)}
                                        className={`w-7 h-7 flex items-center justify-center rounded border transition-all text-sm ${
                                          newTemplateIcon === emoji
                                            ? "border-[var(--theme-accent)] bg-[var(--theme-accent)]/10 font-bold scale-110 shadow-sm"
                                            : "border-slate-200 bg-white hover:bg-slate-50"
                                        }`}
                                      >
                                        {emoji}
                                      </button>
                                    ))}
                                  </div>
                                </div>

                                <div>
                                  <label className="block text-[10px] font-bold text-slate-500 mb-0.5">Template Body Text</label>
                                  <textarea
                                    rows={4}
                                    placeholder="Type your clinical template with placeholders here..."
                                    value={newTemplateContent}
                                    onChange={(e) => setNewTemplateContent(e.target.value)}
                                    className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-xs text-slate-700 placeholder-slate-400 focus:ring-1 focus:ring-[var(--theme-accent)] outline-none font-mono"
                                  />
                                </div>

                                <div className="flex justify-end pt-1">
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      if (!newTemplateTitle || !newTemplateContent) {
                                        triggerToast("Please fill in both the Template Title and Template Body.");
                                        return;
                                      }
                                      const encodedCategory = `Custom|${newTemplateCategory || "Custom"}|${newTemplateIcon}`;
                                      const newTemp = {
                                        id: `custom-temp-${Date.now()}`,
                                        title: newTemplateTitle,
                                        category: encodedCategory,
                                        content: newTemplateContent
                                      };
                                      
                                      // 1. Update local state immediately for responsive feel
                                      setCustomTemplates(prev => [...prev, newTemp]);
                                      setSelectedTemplateId(newTemp.id);
                                      setNewTemplateTitle("");
                                      setNewTemplateContent("");
                                      triggerToast(`Saved Custom Template: ${newTemp.title}`);

                                      // 2. Persist to database in background
                                      try {
                                        const { error } = await supabase
                                          .from("note_templates")
                                          .insert([
                                            {
                                              id: newTemp.id,
                                              title: newTemp.title,
                                              category: newTemp.category,
                                              content: newTemp.content,
                                              created_by: currentUser?.username || "anonymous"
                                            }
                                          ]);
                                        if (error) {
                                          console.error("Failed to write to note_templates table:", error);
                                        } else {
                                          console.log("Custom template saved successfully to database!");
                                          // Refresh from DB to guarantee sync
                                          fetchCustomTemplates();
                                        }
                                      } catch (dbErr) {
                                        console.warn("Offline or failed database insert. Local copy remains.", dbErr);
                                      }
                                    }}
                                    className="bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-dark)] text-white font-bold text-[10px] px-3 py-1.5 rounded flex items-center gap-1 cursor-pointer transition-colors"
                                  >
                                    <Plus size={11} /> Save Custom Template
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

                        {chartReviewSubTab === "media" && (
                          <div className="flex flex-col gap-4 animate-in fade-in duration-200">
                            <div className="flex items-center justify-between border-b pb-2 mb-1">
                              <h4 className="font-bold text-[#2a5178] flex items-center gap-1.5">
                                <FileText size={16} /> Media & Document Extractor
                              </h4>
                              <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-bold uppercase tracking-wider">
                                Patient-Specific Intake
                              </span>
                            </div>

                            {uploadError && (
                              <div className="bg-red-50 border border-red-200 text-red-800 text-[11px] p-3 rounded-lg flex items-start gap-2">
                                <AlertCircle size={15} className="shrink-0 mt-0.5 text-red-600" />
                                <div className="flex-1">
                                  <strong className="block font-bold">Extraction Warning</strong>
                                  <p className="mt-0.5">{uploadError}</p>
                                </div>
                                <button 
                                  onClick={() => setUploadError(null)}
                                  className="text-red-500 hover:text-red-700 font-bold ml-1"
                                >
                                  &times;
                                </button>
                              </div>
                            )}

                            {isAnalyzingMedia ? (
                              <div className="bg-slate-50 border border-slate-200 rounded-xl p-8 text-center flex flex-col items-center justify-center min-h-[300px]">
                                <Activity className="h-10 w-10 text-[var(--theme-accent)] animate-pulse mb-3" />
                                <strong className="text-slate-700 text-sm animate-bounce">Analyzing Laboratory Investigation Report</strong>
                                <p className="text-xs text-[#2a5178] mt-1 font-mono">{analysisProgressMsg}</p>
                                <div className="w-full max-w-xs bg-slate-200 h-1.5 rounded-full mt-4 overflow-hidden">
                                  <div className="bg-[var(--theme-accent)] h-full rounded-full animate-infinite-loading" style={{ width: '45%' }}></div>
                                </div>
                                <div className="mt-6 text-[10px] text-slate-400 font-sans italic max-w-xs leading-relaxed">
                                  "Using Claude server-side parser to translate unstructured PDF scan parameters into validated database records."
                                </div>
                              </div>
                            ) : validationComponents.length > 0 ? (
                              <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col gap-4 shadow-xs">
                                <div className="bg-indigo-50/50 border border-indigo-100 p-3 rounded-lg flex flex-col gap-1 text-slate-700">
                                  <span className="text-[9px] font-bold text-indigo-600 uppercase tracking-wider">Clinical Verification Sandbox</span>
                                  <h5 className="text-xs font-extrabold text-indigo-900">Review & Approve Extracted Lab Metrics</h5>
                                  <p className="text-[10px] text-slate-500 leading-relaxed">
                                    Below are the parameters parsed by the AI. Verify their values, units, and references against the source document. Click save when ready.
                                  </p>
                                </div>

                                {/* General Report Metadata Fields */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                                  <div>
                                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Laboratory / Facility Name</label>
                                    <input 
                                      type="text"
                                      value={validationFacility}
                                      onChange={(e) => setValidationFacility(e.target.value)}
                                      className="w-full bg-slate-50 border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-[var(--theme-accent)] focus:bg-white text-slate-800"
                                      placeholder="e.g. PHD Labs"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Report Collection Date</label>
                                    <input 
                                      type="date"
                                      value={validationReportDate}
                                      onChange={(e) => setValidationReportDate(e.target.value)}
                                      className="w-full bg-slate-50 border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-[var(--theme-accent)] focus:bg-white text-slate-800 font-mono"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Clinical Lab Category</label>
                                    <select
                                      value={validationLabType}
                                      onChange={(e) => setValidationLabType(e.target.value)}
                                      className="w-full bg-slate-50 border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-[var(--theme-accent)] focus:bg-white text-slate-800 font-bold"
                                    >
                                      <option value="HEMATOLOGY">HEMATOLOGY (CBC, WBC, RBC)</option>
                                      <option value="MICROBIOLOGY">MICROBIOLOGY (Urine, Culturing)</option>
                                      <option value="BIO CHEMISTRY">BIO CHEMISTRY (Cholesterol, Lipids, Glucose)</option>
                                      <option value="ENDOCRINOLOGY">ENDOCRINOLOGY (Thyroid, Hormones, TSH)</option>
                                      <option value="SEROLOGY">SEROLOGY (CRP, Rheumatology, Blood Type)</option>
                                    </select>
                                  </div>
                                  <div>
                                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Panel Name</label>
                                    <input 
                                      type="text"
                                      value={validationPanelName}
                                      onChange={(e) => setValidationPanelName(e.target.value)}
                                      className="w-full bg-slate-50 border rounded px-2 py-1 text-xs focus:ring-1 focus:ring-[var(--theme-accent)] focus:bg-white text-slate-800 font-bold"
                                      placeholder="e.g. Complete Blood Count"
                                    />
                                  </div>
                                </div>

                                {/* Components Table */}
                                <div className="border rounded-lg overflow-hidden mt-2">
                                  <table className="w-full border-collapse text-left text-[11px]">
                                    <thead>
                                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold">
                                        <th className="p-2 w-1/3">Test / Parameter</th>
                                        <th className="p-2 w-1/6">Value</th>
                                        <th className="p-2 w-1/6">Unit</th>
                                        <th className="p-2 w-1/6">Ref. Range</th>
                                        <th className="p-2 w-1/6">Alert Flag</th>
                                        <th className="p-2 w-10"></th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                      {validationComponents.map((comp, idx) => (
                                        <tr key={idx} className="hover:bg-slate-50/50">
                                          <td className="p-1">
                                            <input 
                                              type="text"
                                              value={comp.name}
                                              onChange={(e) => {
                                                const updated = [...validationComponents];
                                                updated[idx].name = e.target.value;
                                                setValidationComponents(updated);
                                              }}
                                              className="w-full bg-transparent border-0 focus:bg-white focus:ring-1 focus:ring-slate-300 rounded p-1 text-[11px] font-semibold text-slate-800"
                                            />
                                          </td>
                                          <td className="p-1">
                                            <input 
                                              type="text"
                                              value={comp.value}
                                              onChange={(e) => {
                                                const updated = [...validationComponents];
                                                updated[idx].value = e.target.value;
                                                setValidationComponents(updated);
                                              }}
                                              className="w-full bg-transparent border-0 focus:bg-white focus:ring-1 focus:ring-slate-300 rounded p-1 text-[11px] font-mono font-extrabold text-slate-900"
                                            />
                                          </td>
                                          <td className="p-1">
                                            <input 
                                              type="text"
                                              value={comp.unit}
                                              onChange={(e) => {
                                                const updated = [...validationComponents];
                                                updated[idx].unit = e.target.value;
                                                setValidationComponents(updated);
                                              }}
                                              className="w-full bg-transparent border-0 focus:bg-white focus:ring-1 focus:ring-slate-300 rounded p-1 text-[11px] text-slate-500"
                                            />
                                          </td>
                                          <td className="p-1">
                                            <input 
                                              type="text"
                                              value={comp.reference_range}
                                              onChange={(e) => {
                                                const updated = [...validationComponents];
                                                updated[idx].reference_range = e.target.value;
                                                setValidationComponents(updated);
                                              }}
                                              className="w-full bg-transparent border-0 focus:bg-white focus:ring-1 focus:ring-slate-300 rounded p-1 text-[11px] text-slate-400 font-mono"
                                            />
                                          </td>
                                          <td className="p-1">
                                            <select
                                              value={comp.flag}
                                              onChange={(e) => {
                                                const updated = [...validationComponents];
                                                updated[idx].flag = e.target.value;
                                                setValidationComponents(updated);
                                              }}
                                              className="w-full bg-transparent border-0 focus:bg-white focus:ring-1 focus:ring-slate-300 rounded p-1 text-[10px] font-bold text-slate-700"
                                            >
                                              <option value="NORMAL">NORMAL</option>
                                              <option value="HIGH">HIGH (Abnormal)</option>
                                              <option value="LOW">LOW (Abnormal)</option>
                                            </select>
                                          </td>
                                          <td className="p-1 text-center">
                                            <button 
                                              type="button"
                                              onClick={() => {
                                                setValidationComponents(validationComponents.filter((_, i) => i !== idx));
                                              }}
                                              className="text-slate-400 hover:text-red-500 cursor-pointer p-1 rounded"
                                            >
                                              <Trash2 size={13} />
                                            </button>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>

                                <div className="flex justify-between items-center mt-2">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setValidationComponents([...validationComponents, { name: "New parameter", value: "0", unit: "", reference_range: "", flag: "NORMAL" }]);
                                    }}
                                    className="border border-dashed border-[var(--theme-accent)] hover:bg-slate-50 text-[var(--theme-accent)] text-[10px] px-2.5 py-1 rounded flex items-center gap-1 cursor-pointer font-bold"
                                  >
                                    <Plus size={11} /> Add Parameter Row
                                  </button>

                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setValidationComponents([]);
                                        setUploadError(null);
                                      }}
                                      className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-bold px-3 py-1.5 rounded cursor-pointer"
                                    >
                                      Cancel / Clear
                                    </button>
                                    <button
                                      type="button"
                                      disabled={isSavingValidatedLab}
                                      onClick={handleSaveValidatedLab}
                                      className="bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-dark)] disabled:bg-slate-300 text-white text-[10px] font-extrabold px-3 py-1.5 rounded flex items-center gap-1.5 cursor-pointer shadow-xs"
                                    >
                                      {isSavingValidatedLab ? (
                                        <>Saving...</>
                                      ) : (
                                        <><Save size={12} /> Save to Supabase</>
                                      )}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div className="flex flex-col gap-4">
                                <p className="text-[11px] text-slate-500 leading-relaxed">
                                  Select or drag-and-drop clinical investigation reports (like the <strong>PHD Laboratory Investigation Report PDF</strong> or image scans) below. Claude will scan, structure and pre-fill the parameters for your confirmation.
                                </p>

                                <div className="border-2 border-dashed border-slate-300 hover:border-[var(--theme-accent)] rounded-xl p-8 bg-slate-50 hover:bg-[#edf3f8]/30 text-center transition-all cursor-pointer relative group">
                                  <input 
                                    type="file"
                                    accept=".pdf,image/*"
                                    onChange={handleMediaUploadAndAnalyze}
                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                  />
                                  <PlusCircle className="h-10 w-10 text-slate-400 group-hover:text-[var(--theme-accent)] mx-auto mb-3 transition-colors" />
                                  <strong className="text-slate-700 block text-xs font-bold">Upload Laboratory PDF or Image Scan</strong>
                                  <span className="text-[10px] text-slate-400 mt-1 block">Supports PDF and image formats (PNG, JPEG) up to 20MB</span>
                                  <button className="mt-4 bg-[#edf3f8] group-hover:bg-[var(--theme-accent)] text-indigo-600 group-hover:text-white border border-indigo-200 group-hover:border-transparent font-extrabold text-[10px] px-3 py-1.5 rounded-lg transition-all inline-flex items-center gap-1 cursor-pointer">
                                    <FileText size={11} /> Browse Pathology Report
                                  </button>
                                </div>

                                <label className="border border-slate-200 hover:border-[var(--theme-accent)] rounded-xl p-3 bg-white hover:bg-[#edf3f8]/30 text-center transition-all cursor-pointer relative flex items-center justify-center gap-2 text-[11px] font-bold text-slate-600">
                                  <input
                                    type="file"
                                    accept="image/*"
                                    capture="environment"
                                    onChange={handleMediaUploadAndAnalyze}
                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                  />
                                  <Camera size={13} className="text-[var(--theme-accent)]" /> Take a Photo of the Lab Report
                                </label>

                                <div className="border border-slate-200/60 rounded-xl p-3 bg-white flex flex-col gap-1.5 text-slate-600">
                                  <span className="text-[9px] font-bold text-[#2a5178] uppercase tracking-wider">Clinical Guidance Memo</span>
                                  <p className="text-[10px] leading-relaxed">
                                    When you select a lab report, our full-stack processor extracts name indexes, hemoglobin indices, liver profile values (ALT, ALP), serum creatinine, and endocrine markers (TSH) safely without exposing API keys to the browser, and structures them into validation forms instantly.
                                  </p>
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {chartReviewSubTab === "photos" && (
                          <div className="flex flex-col gap-4 animate-in fade-in duration-200 p-4">
                            <div className="flex items-center justify-between border-b pb-2 mb-1">
                              <h4 className="font-bold text-[#2a5178] flex items-center gap-1.5">
                                <Camera size={16} /> Photo Timeline
                              </h4>
                              <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-bold uppercase tracking-wider">
                                Condition / Follow-Up Photos
                              </span>
                            </div>

                            {photoUploadError && (
                              <div className="bg-red-50 border border-red-200 text-red-800 text-[11px] p-3 rounded-lg flex items-start gap-2">
                                <AlertCircle size={15} className="shrink-0 mt-0.5 text-red-600" />
                                <div className="flex-1">{photoUploadError}</div>
                                <button onClick={() => setPhotoUploadError(null)} className="text-red-500 hover:text-red-700 font-bold ml-1">&times;</button>
                              </div>
                            )}

                            <div className="border border-slate-200 rounded-xl p-3 bg-slate-50 flex flex-col gap-2">
                              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                                Caption (e.g. "Left forearm rash, day 3")
                              </label>
                              <input
                                type="text"
                                value={newPhotoCaption}
                                onChange={(e) => setNewPhotoCaption(e.target.value)}
                                placeholder="Optional note about this photo"
                                className="w-full bg-white border rounded px-2 py-1.5 text-xs focus:ring-1 focus:ring-[var(--theme-accent)] text-slate-800"
                              />
                              <div className="flex gap-2 mt-1">
                                <label className="flex-1 flex items-center justify-center gap-2 border-2 border-dashed border-slate-300 hover:border-[var(--theme-accent)] rounded-lg p-3 bg-white cursor-pointer text-[11px] font-bold text-slate-600 relative">
                                  <input
                                    type="file"
                                    accept="image/*"
                                    capture="environment"
                                    onChange={handleUploadConditionPhoto}
                                    disabled={isUploadingPhoto}
                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                  />
                                  <Camera size={13} className="text-[var(--theme-accent)]" />
                                  {isUploadingPhoto ? "Uploading..." : "Take Photo"}
                                </label>
                                <label className="flex-1 flex items-center justify-center gap-2 border-2 border-dashed border-slate-300 hover:border-[var(--theme-accent)] rounded-lg p-3 bg-white cursor-pointer text-[11px] font-bold text-slate-600 relative">
                                  <input
                                    type="file"
                                    accept="image/*"
                                    onChange={handleUploadConditionPhoto}
                                    disabled={isUploadingPhoto}
                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                  />
                                  <PlusCircle size={13} className="text-[var(--theme-accent)]" />
                                  {isUploadingPhoto ? "Uploading..." : "Upload from Gallery"}
                                </label>
                              </div>
                            </div>

                            {isPhotosLoading ? (
                              <div className="text-center text-[11px] text-slate-400 py-6">Loading photos…</div>
                            ) : patientPhotos.length === 0 ? (
                              <div className="text-center text-[11px] text-slate-400 py-6">
                                No photos logged for this patient yet.
                              </div>
                            ) : (
                              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                {patientPhotos.map((photo) => (
                                  <div key={photo.id} className="border border-slate-200 rounded-lg overflow-hidden bg-white flex flex-col shadow-xs">
                                    {photo.signedUrl ? (
                                      <img src={photo.signedUrl} alt={photo.caption || "Patient photo"} className="w-full h-32 object-cover" />
                                    ) : (
                                      <div className="w-full h-32 bg-slate-100 flex items-center justify-center text-slate-300 text-[10px]">No preview</div>
                                    )}
                                    <div className="p-2 flex flex-col gap-1">
                                      <span className="text-[9px] text-slate-400 font-mono">
                                        {new Date(photo.taken_at).toLocaleString("en-GB")}
                                      </span>
                                      {photo.caption && (
                                        <span className="text-[11px] text-slate-700">{photo.caption}</span>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => handleDeletePatientPhoto(photo)}
                                        className="text-[9px] text-red-500 hover:text-red-700 font-bold self-end mt-1"
                                      >
                                        Remove
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {chartReviewSubTab === "labs" && (
                          <div className="flex flex-col gap-4 animate-in fade-in duration-200">
                            <div className="flex items-center justify-between border-b pb-2 mb-1 flex-wrap gap-2">
                              <h4 className="font-bold text-[#2a5178] flex items-center gap-1.5">
                                <Activity size={16} /> Patient Lab Panels & Pathology Results
                              </h4>
                              <div className="flex items-center gap-2">
                                {/* Date Selector Dropdown */}
                                {patientLabs.length > 0 && (() => {
                                  const uniqueCollectedAts = Array.from(new Set(patientLabs.map(lab => (lab as any).collected_at as string))) as string[];
                                  uniqueCollectedAts.sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
                                  return (
                                    <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-md px-2 py-1">
                                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Date Filter:</span>
                                      <select
                                        value={selectedLabDate}
                                        onChange={(e) => setSelectedLabDate(e.target.value)}
                                        className="bg-transparent border-0 text-[10px] font-bold text-[#2a5178] focus:ring-0 focus:outline-none cursor-pointer py-0.5"
                                      >
                                        <option value="all">📅 All Dates ({uniqueCollectedAts.length})</option>
                                        {uniqueCollectedAts.map(date => (
                                          <option key={date} value={date}>
                                            {formatDateDDMMYYYY(date as string)}
                                          </option>
                                        ))}
                                      </select>
                                    </div>
                                  );
                                })()}
                                <button
                                  type="button"
                                  onClick={() => setChartReviewSubTab("media")}
                                  className="text-[var(--theme-accent)] hover:text-[#2a5178] font-bold text-[10px] flex items-center gap-1.5 border border-slate-200 bg-white hover:bg-slate-50 px-2 py-1 rounded"
                                >
                                  <Plus size={11} /> Upload New Report
                                </button>
                              </div>
                            </div>

                            {/* Render Structured Interactive Lab Panels */}
                            {patientLabs.length === 0 ? (
                              <div className="text-center py-10 bg-slate-50 border border-dashed rounded-lg">
                                <Activity className="h-8 w-8 text-slate-300 mx-auto mb-2 animate-pulse" />
                                <p className="font-semibold text-slate-600">No structured lab panels loaded</p>
                                <p className="text-[11px] text-slate-400 mt-1">Upload clinical scans via the 'Media' tab to extract and validate interactive lab results!</p>
                              </div>
                            ) : (
                              <div className="flex flex-col gap-3">
                                {patientLabs
                                  .filter(lab => selectedLabDate === "all" || lab.collected_at === selectedLabDate)
                                  .map((lab) => {
                                  const isExpanded = expandedLabId === lab.id;
                                  const borderClass = 
                                    lab.status === "Danger" ? "border-l-4 border-l-[#c05654]" :
                                    lab.status === "Warning" ? "border-l-4 border-l-[#8f6d1e]" :
                                    "border-l-4 border-l-[#35795c]";
                                  
                                  const bgHeader = 
                                    lab.status === "Danger" ? "bg-red-50/50 hover:bg-red-50" :
                                    lab.status === "Warning" ? "bg-amber-50/40 hover:bg-amber-50/70" :
                                    "bg-[var(--theme-accent-bg)]merald-50/30 hover:bg-[var(--theme-accent-bg)]merald-50/60";

                                  return (
                                    <div key={lab.id} className={`border rounded-lg overflow-hidden bg-white shadow-xs ${borderClass} transition-all`}>
                                      <button
                                        type="button"
                                        onClick={() => setExpandedLabId(isExpanded ? null : lab.id)}
                                        className={`w-full ${bgHeader} p-3 text-left flex items-center justify-between gap-3 cursor-pointer border-b border-slate-100`}
                                      >
                                        <div className="flex-1">
                                          <div className="flex items-center gap-2 flex-wrap">
                                            <strong className="text-xs text-slate-800 font-extrabold">{lab.panel_name}</strong>
                                            <span className="text-[9px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono font-bold tracking-wider uppercase">
                                              {lab.lab_type}
                                            </span>
                                            {lab.facility_name && (
                                              <span className="text-[10px] text-slate-400 font-bold bg-slate-50 border border-slate-100 px-1.5 py-0.5 rounded">
                                                🏥 {lab.facility_name}
                                              </span>
                                            )}
                                          </div>
                                          <p className="text-[11px] text-slate-500 mt-0.5 font-medium">
                                            Summary: <span className="font-semibold text-slate-700">{lab.value_display}</span>
                                          </p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <span className="text-[9px] text-slate-400 font-mono">
                                            {formatDateDDMMYYYY(lab.collected_at)}
                                          </span>
                                          <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded border ${
                                            lab.status === "Danger" ? "bg-red-100 text-red-700 border-red-200" :
                                            lab.status === "Warning" ? "bg-amber-100 text-amber-700 border-amber-200" :
                                            "bg-[var(--theme-accent-bg)]merald-100 text-emerald-700 border-emerald-200"
                                          }`}>
                                            {lab.status}
                                          </span>
                                        </div>
                                      </button>

                                      {isExpanded && (
                                        <div className="p-3 bg-slate-50/50 border-t border-slate-100 animate-in slide-in-from-top-1 duration-150">
                                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                            {lab.components?.map((comp: any, cIdx: number) => {
                                              const isAbnormal = comp.flag && comp.flag !== "NORMAL";
                                              return (
                                                <div key={cIdx} className="bg-white border rounded p-2.5 flex items-center justify-between gap-3 hover:shadow-xs transition-shadow">
                                                  <div>
                                                    <span className="font-bold text-slate-800 text-[11px] block leading-tight">{comp.name}</span>
                                                    <span className="text-[9px] text-slate-400 font-medium block mt-0.5 font-mono">Ref Range: {comp.reference_range || "N/A"}</span>
                                                  </div>
                                                  <div className="text-right flex flex-col items-end">
                                                    <span className={`font-mono text-xs font-extrabold ${isAbnormal ? "text-red-600" : "text-slate-700"}`}>
                                                      {comp.value} <span className="text-[10px] text-slate-400 font-normal">{comp.unit}</span>
                                                    </span>
                                                    {isAbnormal && (
                                                      <span className={`text-[7px] font-black uppercase px-1 rounded mt-0.5 tracking-wider ${
                                                        comp.flag === "HIGH" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
                                                      }`}>
                                                        {comp.flag}
                                                      </span>
                                                    )}
                                                  </div>
                                                </div>
                                              );
                                            })}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            {/* Raw documents list bottom collapse */}
                            <div className="mt-4 border-t pt-4">
                              <h5 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Raw Document Archive & Pathology Files ({patientRecords.length})</h5>
                              {patientRecords.length > 0 ? (
                                <div className="flex flex-col gap-2">
                                  {patientRecords.map((rec) => (
                                    <div key={rec.id} className="border border-slate-100 rounded-lg p-2.5 bg-slate-50/50 hover:bg-slate-50 transition-colors">
                                      <div className="flex justify-between items-start text-[10px]">
                                        <strong className="text-slate-700 font-bold">Pathology Report Scan #{rec.id}</strong>
                                        <span className="text-slate-400 font-mono">{formatDateDDMMYYYY(rec.created_at)}</span>
                                      </div>
                                      <p className="text-[10px] text-slate-500 mt-1 line-clamp-2 italic leading-relaxed">
                                        "{rec.extracted_json?.capsule_summary || rec.raw_text_backup?.substring(0, 200)}"
                                      </p>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-[10px] text-slate-400 italic">No raw clinical text files archived.</span>
                              )}
                            </div>
                          </div>
                        )}

                        {chartReviewSubTab === "lab_trends" && (() => {
                          const availableCategories = Array.from(new Set(patientLabs.map(lab => lab.lab_type))).filter(Boolean);
                          const availableTests = Array.from(
                            new Set(
                              patientLabs
                                .filter(lab => selectedTrendCategory === "ALL" || lab.lab_type === selectedTrendCategory)
                                .flatMap(lab => lab.components?.map(c => c.name) || [])
                            )
                          ).filter(Boolean);

                          const trendPoints = patientLabs
                            .flatMap(lab => {
                              const comp = lab.components?.find(c => c.name === selectedTrendTest);
                              if (!comp) return [];
                              const valNum = parseFloat(comp.value.replace(/[^0-9.-]/g, ''));
                              return [{
                                date: new Date(lab.collected_at),
                                dateStr: formatDateDDMMYYYY(lab.collected_at),
                                panel: lab.panel_name,
                                valueStr: comp.value,
                                valNum: isNaN(valNum) ? 0 : valNum,
                                unit: comp.unit || "",
                                reference_range: comp.reference_range || "",
                                flag: comp.flag,
                                status: lab.status,
                                collected_at: lab.collected_at
                              }];
                            })
                            .sort((a, b) => new Date(a.collected_at).getTime() - new Date(b.collected_at).getTime());

                          const numericPoints = trendPoints.filter(p => !isNaN(p.valNum));
                          const latestPoint = trendPoints[trendPoints.length - 1];
                          const hasTrend = trendPoints.length > 1;

                          let trendDirection: "increasing" | "decreasing" | "stable" | "none" = "none";
                          if (hasTrend && numericPoints.length > 1) {
                            const firstVal = numericPoints[0].valNum;
                            const lastVal = numericPoints[numericPoints.length - 1].valNum;
                            const diff = lastVal - firstVal;
                            if (Math.abs(diff) < 0.01) trendDirection = "stable";
                            else if (diff > 0) trendDirection = "increasing";
                            else trendDirection = "decreasing";
                          }

                          return (
                            <div className="flex flex-col gap-4 p-4 animate-in fade-in duration-200">
                              <div className="flex items-center justify-between border-b pb-2 mb-1">
                                <h4 className="font-bold text-[#2a5178] flex items-center gap-1.5 text-xs">
                                  <TrendingUp size={16} /> Patient Lab Parameter Trends
                                </h4>
                                <span className="text-[9px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                                  Dynamic SVG Plotting
                                </span>
                              </div>

                              {/* Dropdowns row */}
                              <div className="grid grid-cols-2 gap-3 bg-slate-50 border border-slate-200 p-2.5 rounded-lg">
                                <div>
                                  <label className="block text-[9px] font-black text-slate-500 uppercase tracking-wider mb-1">
                                    Filter Panel Category
                                  </label>
                                  <select
                                    value={selectedTrendCategory}
                                    onChange={(e) => {
                                      setSelectedTrendCategory(e.target.value);
                                    }}
                                    className="w-full bg-white border border-slate-200 rounded p-1.5 text-xs text-slate-700 font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                                  >
                                    <option value="ALL">Show All Categories</option>
                                    {availableCategories.map(cat => (
                                      <option key={cat} value={cat}>{cat}</option>
                                    ))}
                                  </select>
                                </div>

                                <div>
                                  <label className="block text-[9px] font-black text-slate-500 uppercase tracking-wider mb-1">
                                    Select Parameter / Lab Test
                                  </label>
                                  <select
                                    value={selectedTrendTest}
                                    onChange={(e) => setSelectedTrendTest(e.target.value)}
                                    className="w-full bg-white border border-slate-200 rounded p-1.5 text-xs text-slate-700 font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                                    disabled={availableTests.length === 0}
                                  >
                                    {availableTests.length === 0 ? (
                                      <option value="">No Parameters Found</option>
                                    ) : (
                                      availableTests.map(t => (
                                        <option key={t} value={t}>{t}</option>
                                      ))
                                    )}
                                  </select>
                                </div>
                              </div>

                              {/* Render Content */}
                              {patientLabs.length === 0 ? (
                                <div className="text-center py-12 bg-slate-50 border border-dashed rounded-lg">
                                  <Activity className="h-8 w-8 text-slate-300 mx-auto mb-2 animate-pulse" />
                                  <p className="font-semibold text-slate-600 text-xs">No clinical records loaded</p>
                                  <p className="text-[10px] text-slate-400 mt-1">Upload clinical files or complete virtual assessments to establish trends!</p>
                                </div>
                              ) : !selectedTrendTest ? (
                                <div className="text-center py-12 bg-slate-50 border border-dashed rounded-lg text-slate-400 italic text-xs">
                                  Please select a valid lab parameter to track trend analysis.
                                </div>
                              ) : trendPoints.length === 0 ? (
                                <div className="text-center py-12 bg-slate-50 border border-dashed rounded-lg text-slate-400 italic text-xs">
                                  No measurement datapoints found for the selected parameter.
                                </div>
                              ) : (
                                <div className="flex flex-col gap-3">
                                  {/* Stats Banner */}
                                  <div className="grid grid-cols-3 gap-2.5">
                                    <div className="bg-slate-50 border border-slate-200 p-2 rounded-lg flex flex-col justify-between">
                                      <span className="text-[8px] text-slate-400 font-bold uppercase tracking-wider">Latest Value</span>
                                      <div className="flex items-baseline gap-1 mt-0.5">
                                        <span className="text-xs font-extrabold text-slate-800">
                                          {latestPoint.valueStr}
                                        </span>
                                      </div>
                                    </div>
                                    <div className="bg-slate-50 border border-slate-200 p-2 rounded-lg flex flex-col justify-between">
                                      <span className="text-[8px] text-slate-400 font-bold uppercase tracking-wider">Datapoints</span>
                                      <span className="text-xs font-extrabold text-indigo-700 mt-0.5">
                                        {trendPoints.length} test{trendPoints.length > 1 ? "s" : ""}
                                      </span>
                                    </div>
                                    <div className="bg-slate-50 border border-slate-200 p-2 rounded-lg flex flex-col justify-between">
                                      <span className="text-[8px] text-slate-400 font-bold uppercase tracking-wider">Trend Line</span>
                                      <div className="flex items-center gap-1 mt-0.5 text-[10px] font-bold">
                                        {trendDirection === "increasing" && (
                                          <span className="text-amber-600 flex items-center gap-0.5">
                                            <ArrowUpRight size={12} /> Rising
                                          </span>
                                        )}
                                        {trendDirection === "decreasing" && (
                                          <span className="text-emerald-600 flex items-center gap-0.5">
                                            <ArrowDownRight size={12} /> Falling
                                          </span>
                                        )}
                                        {trendDirection === "stable" && (
                                          <span className="text-slate-600 flex items-center gap-0.5">
                                            Stable
                                          </span>
                                        )}
                                        {trendDirection === "none" && (
                                          <span className="text-slate-400">
                                            Single Value
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </div>

                                  {/* SVG Graph Canvas */}
                                  <div className="relative bg-white border border-slate-200 rounded-lg p-3 shadow-xs">
                                    {trendPoints.length === 1 ? (
                                      <div className="h-[140px] flex flex-col items-center justify-center text-center p-4">
                                        <div className="h-6 w-6 rounded-full bg-[var(--theme-accent-bg)]merald-100 flex items-center justify-center text-emerald-700 font-bold text-xs mb-2">
                                          1
                                        </div>
                                        <p className="font-bold text-slate-700 text-[11px]">Single Measurement Recorded</p>
                                        <p className="text-[9px] text-slate-400 mt-0.5 max-w-[280px]">
                                          Value: <strong className="text-[#2a5178]">{latestPoint.valueStr}</strong> on {latestPoint.dateStr}. Upload more reports to generate the complete visual line timeline.
                                        </p>
                                      </div>
                                    ) : (() => {
                                      const valNums = trendPoints.map(p => p.valNum);
                                      let maxVal = Math.max(...valNums);
                                      let minVal = Math.min(...valNums);

                                      if (minVal === maxVal) {
                                        minVal = minVal - 1;
                                        maxVal = maxVal + 1;
                                      }
                                      const valDiff = maxVal - minVal;
                                      const yMin = minVal - valDiff * 0.15;
                                      const yMax = maxVal + valDiff * 0.15;
                                      const rangeY = (yMax - yMin) || 1;

                                      const chartWidth = 420;
                                      const chartHeight = 110;
                                      const paddingLeft = 45;
                                      const paddingTop = 15;

                                      const points = trendPoints.map((p, i) => {
                                        const x = paddingLeft + (i / (trendPoints.length - 1)) * chartWidth;
                                        const y = paddingTop + chartHeight - ((p.valNum - yMin) / rangeY) * chartHeight;
                                        return { x, y, data: p, index: i };
                                      });

                                      const pointsString = points.map(p => `${p.x},${p.y}`).join(" ");
                                      const fillPathString = `M ${paddingLeft},${paddingTop + chartHeight} ` +
                                        points.map(p => `L ${p.x},${p.y}`).join(" ") +
                                        ` L ${paddingLeft + chartWidth},${paddingTop + chartHeight} Z`;

                                      const yGrids = [];
                                      for (let i = 0; i <= 3; i++) {
                                        const val = yMin + (rangeY / 3) * i;
                                        const yPos = paddingTop + chartHeight - (i / 3) * chartHeight;
                                        yGrids.push({ value: val.toFixed(1), y: yPos });
                                      }

                                      return (
                                        <>
                                          <svg viewBox="0 0 500 160" className="w-full h-auto overflow-visible font-sans select-none">
                                            <defs>
                                              <linearGradient id="trend-fill-gradient" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="0%" stopColor="var(--theme-accent)" stopOpacity="0.25" />
                                                <stop offset="100%" stopColor="var(--theme-accent)" stopOpacity="0.0" />
                                              </linearGradient>
                                            </defs>

                                            {yGrids.map((grid, idx) => (
                                              <g key={idx} className="opacity-70">
                                                <line
                                                  x1={paddingLeft}
                                                  y1={grid.y}
                                                  x2={paddingLeft + chartWidth}
                                                  y2={grid.y}
                                                  stroke="#dee4eb"
                                                  strokeWidth={1}
                                                  strokeDasharray={idx === 0 || idx === 3 ? "0" : "3,3"}
                                                />
                                                <text
                                                  x={paddingLeft - 8}
                                                  y={grid.y + 3}
                                                  textAnchor="end"
                                                  className="fill-slate-400 text-[8px] font-mono font-semibold"
                                                >
                                                  {grid.value}
                                                </text>
                                              </g>
                                            ))}

                                            <path d={fillPathString} fill="url(#trend-fill-gradient)" />

                                            <polyline
                                              fill="none"
                                              stroke="var(--theme-accent)"
                                              strokeWidth={2.5}
                                              strokeLinecap="round"
                                              strokeLinejoin="round"
                                              points={pointsString}
                                              className="drop-shadow-sm"
                                            />

                                            {hoveredPointIndex !== null && points[hoveredPointIndex] && (
                                              <line
                                                x1={points[hoveredPointIndex].x}
                                                y1={paddingTop}
                                                x2={points[hoveredPointIndex].x}
                                                y2={paddingTop + chartHeight}
                                                stroke="var(--theme-accent)"
                                                strokeWidth={1}
                                                strokeDasharray="2,2"
                                                className="transition-all duration-75"
                                              />
                                            )}

                                            {points.map((pt, i) => {
                                              const isHovered = hoveredPointIndex === i;
                                              const hasAnomaly = pt.data.flag !== "NORMAL";
                                              const fillColour = hasAnomaly ? "#8f6d1e" : "var(--theme-accent)";

                                              return (
                                                <g
                                                  key={i}
                                                  className="cursor-pointer"
                                                  onMouseEnter={() => setHoveredPointIndex(i)}
                                                  onMouseLeave={() => setHoveredPointIndex(null)}
                                                  onClick={() => setHoveredPointIndex(i)}
                                                >
                                                  <circle cx={pt.x} cy={pt.y} r={14} fill="transparent" />
                                                  
                                                  {isHovered && (
                                                    <circle
                                                      cx={pt.x}
                                                      cy={pt.y}
                                                      r={9}
                                                      fill="none"
                                                      stroke={fillColour}
                                                      strokeWidth={1}
                                                      className="animate-ping opacity-60"
                                                    />
                                                )}

                                                  <circle
                                                    cx={pt.x}
                                                    cy={pt.y}
                                                    r={isHovered ? 6 : 4.5}
                                                    fill={isHovered ? "#fcfdfe" : fillColour}
                                                    stroke={fillColour}
                                                    strokeWidth={isHovered ? 3.5 : 1.5}
                                                    className="transition-all duration-100"
                                                  />
                                                </g>
                                              );
                                            })}

                                            {points.map((pt, i) => {
                                              const shouldShowText = points.length <= 6 || i === 0 || i === points.length - 1 || (points.length > 1 && i === Math.floor(points.length / 2));
                                              if (!shouldShowText) return null;

                                              return (
                                                <g key={i}>
                                                  <line
                                                    x1={pt.x}
                                                    y1={paddingTop + chartHeight}
                                                    x2={pt.x}
                                                    y2={paddingTop + chartHeight + 4}
                                                    stroke="#c9d2dc"
                                                    strokeWidth={1}
                                                  />
                                                  <text
                                                    x={pt.x}
                                                    y={paddingTop + chartHeight + 14}
                                                    textAnchor="middle"
                                                    className="fill-slate-500 font-mono text-[8px] font-bold"
                                                  >
                                                    {pt.data.dateStr}
                                                  </text>
                                                </g>
                                              );
                                            })}
                                          </svg>

                                          {hoveredPointIndex !== null && points[hoveredPointIndex] ? (
                                            <div className="mt-2 bg-slate-900 text-white rounded-lg p-2 text-[10px] flex items-center justify-between gap-4 animate-in fade-in slide-in-from-bottom-1 duration-150">
                                              <div>
                                                <span className="text-slate-400 block font-mono text-[8px] uppercase">Measurement Value</span>
                                                <strong className="text-emerald-400 text-[11px] font-bold">
                                                  {points[hoveredPointIndex].data.valueStr} {points[hoveredPointIndex].data.unit}
                                                </strong>
                                              </div>
                                              <div>
                                                <span className="text-slate-400 block font-mono text-[8px] uppercase">Collected Date</span>
                                                <strong className="font-semibold text-slate-200">{points[hoveredPointIndex].data.dateStr}</strong>
                                              </div>
                                              <div>
                                                <span className="text-slate-400 block font-mono text-[8px] uppercase">Ref Range</span>
                                                <strong className="text-slate-300">{points[hoveredPointIndex].data.reference_range || "N/A"}</strong>
                                              </div>
                                              <div>
                                                <span className="text-slate-400 block font-mono text-[8px] uppercase">Flag</span>
                                                <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase ${
                                                  points[hoveredPointIndex].data.flag === "HIGH" || points[hoveredPointIndex].data.flag === "LOW" || points[hoveredPointIndex].data.flag === "ABNORMAL"
                                                    ? "bg-amber-500/20 text-amber-300 border border-amber-500/40" 
                                                    : "bg-[var(--theme-accent-bg)]merald-500/20 text-emerald-300 border border-emerald-500/40"
                                                }`}>
                                                  {points[hoveredPointIndex].data.flag || "NORMAL"}
                                                </span>
                                              </div>
                                            </div>
                                          ) : (
                                            <div className="mt-2 bg-slate-50 border border-slate-200 text-slate-400 rounded-lg py-2.5 px-3 text-[10px] text-center italic">
                                              Hover or tap on chart nodes to view detailed measurement telemetry.
                                            </div>
                                          )}
                                        </>
                                      );
                                    })()}
                                  </div>

                                  {/* Detailed Historical Ledger Table */}
                                  <div className="border border-slate-200 rounded-lg overflow-hidden bg-white mt-1 shadow-xs">
                                    <div className="bg-slate-100 px-3 py-2 border-b flex justify-between items-center">
                                      <span className="text-[9px] font-extrabold text-slate-500 uppercase tracking-widest">Historical Measurement Ledger</span>
                                      <span className="text-[8px] font-mono font-bold text-indigo-700">Sorted Chronologically</span>
                                    </div>
                                    <table className="w-full text-left border-collapse">
                                      <thead>
                                        <tr className="border-b bg-slate-50/50 text-[9px] text-slate-400 font-extrabold uppercase tracking-wider">
                                          <th className="px-3 py-1.5">Date Collected</th>
                                          <th className="px-3 py-1.5">Panel Name</th>
                                          <th className="px-3 py-1.5">Value Result</th>
                                          <th className="px-3 py-1.5">Ref Range</th>
                                          <th className="px-3 py-1.5 text-right">Status</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {trendPoints.map((pt, i) => (
                                          <tr key={i} className="border-b last:border-b-0 hover:bg-slate-50/30 text-[10px] transition-colors">
                                            <td className="px-3 py-2 font-mono font-bold text-slate-600">{pt.dateStr}</td>
                                            <td className="px-3 py-2 text-slate-500">{pt.panel}</td>
                                            <td className="px-3 py-2 font-bold text-slate-800">
                                              {pt.valueStr} <span className="text-slate-400 font-normal">{pt.unit}</span>
                                            </td>
                                            <td className="px-3 py-2 text-slate-400 font-mono">{pt.reference_range || "N/A"}</td>
                                            <td className="px-3 py-2 text-right">
                                              <span className={`inline-block px-1.5 py-0.5 rounded text-[8px] font-black uppercase ${
                                                pt.flag === "HIGH" || pt.flag === "LOW" || pt.flag === "ABNORMAL"
                                                  ? "bg-amber-100 text-amber-700 border border-amber-200"
                                                  : "bg-[var(--theme-accent-bg)]merald-100 text-emerald-700 border border-emerald-200"
                                              }`}>
                                                {pt.flag || "NORMAL"}
                                              </span>
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        {chartReviewSubTab === "all_labs" && (() => {
                          interface LabRow {
                            labId: string;
                            category: string;
                            panel: string;
                            dateStr: string;
                            collectedAt: string;
                            name: string;
                            value: string;
                            unit: string;
                            reference_range: string;
                            flag: string;
                          }

                          const allLabRows: LabRow[] = patientLabs.flatMap(lab => {
                            const labType = lab.lab_type || "OTHER";
                            const panelName = lab.panel_name || "General Panel";
                            const collectedAt = lab.collected_at;
                            const dateStr = formatDateDDMMYYYY(collectedAt);
                            
                            return (lab.components || []).map(comp => ({
                              labId: lab.id,
                              category: labType,
                              panel: panelName,
                              dateStr,
                              collectedAt,
                              name: comp.name,
                              value: comp.value,
                              unit: comp.unit || "",
                              reference_range: comp.reference_range || "",
                              flag: comp.flag || "NORMAL"
                            }));
                          });

                          // Get unique collection dates across ALL labs for this patient, sorted newest to oldest (left to right)
                          const uniqueCollectedAts = Array.from(new Set(allLabRows.map(r => r.collectedAt)));
                          uniqueCollectedAts.sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

                          // Group by category (normalized to uppercase)
                          const categories = Array.from(new Set(allLabRows.map(r => r.category.toUpperCase())));
                          categories.sort(); // alphabetize categories

                          return (
                            <div className="flex flex-col gap-4 p-4 animate-in fade-in duration-200">
                              {/* Tab Toolbar */}
                              <div className="flex items-center justify-between border-b pb-2 mb-1 flex-wrap gap-2">
                                <div className="flex flex-col gap-0.5">
                                  <h4 className="font-bold text-[#2a5178] flex items-center gap-1.5 text-xs">
                                    <ClipboardList size={16} /> Cumulative Labs Directory (Grouped by Category)
                                  </h4>
                                  <p className="text-[10px] text-slate-500">
                                    Observe chronological trends side-by-side across historical visits
                                  </p>
                                </div>
                                
                                <div className="flex items-center gap-2 flex-wrap">
                                  {/* Date Selector Dropdown */}
                                  {uniqueCollectedAts.length > 0 && (
                                    <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-md px-2 py-1">
                                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Date Filter:</span>
                                      <select
                                        value={selectedLabDate}
                                        onChange={(e) => setSelectedLabDate(e.target.value)}
                                        className="bg-transparent border-0 text-[10px] font-bold text-[#2a5178] focus:ring-0 focus:outline-none cursor-pointer py-0.5"
                                      >
                                        <option value="all">📅 All Dates ({uniqueCollectedAts.length})</option>
                                        {uniqueCollectedAts.map(date => (
                                          <option key={date} value={date}>
                                            {formatDateDDMMYYYY(date)}
                                          </option>
                                        ))}
                                      </select>
                                    </div>
                                  )}

                                  {/* View Mode Toggle */}
                                  <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-md border border-slate-200">
                                    <button
                                      onClick={() => setAllLabsViewMode("timeline")}
                                      className={`px-2 py-0.5 rounded text-[9px] font-bold transition-all cursor-pointer ${
                                        allLabsViewMode === "timeline"
                                          ? "bg-white text-[var(--theme-accent)] shadow-xs border border-slate-200/50"
                                          : "text-slate-500 hover:text-slate-800"
                                      }`}
                                    >
                                      Timeline Pivot 📊
                                    </button>
                                    <button
                                      onClick={() => setAllLabsViewMode("list")}
                                      className={`px-2 py-0.5 rounded text-[9px] font-bold transition-all cursor-pointer ${
                                        allLabsViewMode === "list"
                                          ? "bg-white text-[var(--theme-accent)] shadow-xs border border-slate-200/50"
                                          : "text-slate-500 hover:text-slate-800"
                                      }`}
                                    >
                                      Flat List 📋
                                    </button>
                                  </div>
                                </div>
                              </div>

                              {patientLabs.length === 0 ? (
                                <div className="text-center py-12 bg-slate-50 border border-dashed rounded-lg">
                                  <Activity className="h-8 w-8 text-slate-300 mx-auto mb-2 animate-pulse" />
                                  <p className="font-semibold text-slate-600 text-xs">No clinical records loaded</p>
                                  <p className="text-[10px] text-slate-400 mt-1">Upload clinical files or complete virtual assessments to establish cumulative tables!</p>
                                </div>
                              ) : allLabsViewMode === "timeline" ? (
                                /* Unified Timeline / Pivot Comparison View */
                                (() => {
                                  const displayedCollectedAts = selectedLabDate === "all"
                                    ? uniqueCollectedAts
                                    : uniqueCollectedAts.filter(d => d === selectedLabDate);

                                  return (
                                    <div className="border border-slate-200 rounded-lg overflow-hidden bg-white shadow-xs">
                                      {/* Unified horizontal and vertical scroll container with max-height constraint */}
                                      <div className="overflow-auto max-h-[480px]">
                                        <table className="w-full text-left border-collapse">
                                          <thead>
                                            <tr className="border-b bg-slate-100 text-[9px] text-slate-400 font-extrabold uppercase tracking-wider">
                                              <th className="px-3 py-2 min-w-[180px] sticky top-0 bg-slate-100 z-20 border-b border-slate-200 shadow-xs">Test Parameter</th>
                                              <th className="px-3 py-2 sticky top-0 bg-slate-100 z-20 border-b border-slate-200 shadow-xs">Ref Range</th>
                                              <th className="px-3 py-2 font-mono sticky top-0 bg-slate-100 z-20 border-b border-slate-200 shadow-xs">Unit</th>
                                              
                                              {/* Historical Dates as columns (X-Axis representation - Newest on the Left) */}
                                              {displayedCollectedAts.map(date => (
                                                <th 
                                                  key={date} 
                                                  className="px-3 py-2 text-center border-l border-slate-200 bg-slate-100/95 font-mono text-[9px] text-[#2a5178] font-extrabold whitespace-nowrap sticky top-0 z-20 border-b border-slate-200 shadow-xs"
                                                >
                                                  {formatDateDDMMYYYY(date)}
                                                </th>
                                              ))}

                                              {/* Historical Direction / Trend Column */}
                                              <th className="px-3 py-2 border-l border-slate-200 min-w-[140px] sticky top-0 bg-slate-100 z-20 border-b border-slate-200 shadow-xs">Trend Comparison</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {categories.map(cat => {
                                              const rowsInCat = allLabRows.filter(r => r.category.toUpperCase() === cat);
                                              
                                              // Get unique parameter names in this category
                                              const paramNames = Array.from(new Set(rowsInCat.map(r => r.name)));
                                              paramNames.sort();

                                              // Extract parameter meta details (reference range, unit, panel source)
                                              const paramInfo = paramNames.reduce((acc, name) => {
                                                const match = rowsInCat.find(r => r.name === name);
                                                acc[name] = {
                                                  reference_range: match?.reference_range || "",
                                                  unit: match?.unit || "",
                                                  panel: match?.panel || ""
                                                };
                                                return acc;
                                              }, {} as Record<string, { reference_range: string; unit: string; panel: string }>);

                                              return (
                                                <React.Fragment key={cat}>
                                                  {/* Category Header Row inside single table */}
                                                  <tr className="bg-slate-50 border-y border-slate-200/80">
                                                    <td 
                                                      colSpan={3 + displayedCollectedAts.length + 1} 
                                                      className="px-3 py-1.5 font-black text-slate-700 uppercase tracking-wider text-[10px]"
                                                    >
                                                      <div className="flex justify-between items-center">
                                                        <span className="text-[#2a5178]">Category: {cat}</span>
                                                        <span className="text-[8px] font-mono font-bold text-[#2a5178] bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded">
                                                          {paramNames.length} Parameters
                                                        </span>
                                                      </div>
                                                    </td>
                                                  </tr>

                                                  {paramNames.map(paramName => {
                                                    const info = paramInfo[paramName];
                                                    
                                                    return (
                                                      <tr key={paramName} className="border-b last:border-b-0 hover:bg-slate-50/20 text-[10px] transition-colors">
                                                        {/* Parameter details */}
                                                        <td className="px-3 py-2.5 font-bold text-slate-800">
                                                          <div className="flex flex-col">
                                                            <span>{paramName}</span>
                                                            <span className="text-[8px] text-slate-400 font-normal mt-0.5 font-sans truncate max-w-[200px]" title={info.panel}>
                                                              {info.panel}
                                                            </span>
                                                          </div>
                                                        </td>
                                                        <td className="px-3 py-2.5 text-slate-500 font-mono font-medium">{info.reference_range || "N/A"}</td>
                                                        <td className="px-3 py-2.5 text-slate-400 font-mono">{info.unit || "-"}</td>

                                                        {/* Side-by-side values per date */}
                                                        {displayedCollectedAts.map(date => {
                                                          const match = rowsInCat.find(r => r.name === paramName && r.collectedAt === date);
                                                          
                                                          if (!match) {
                                                            return (
                                                              <td key={date} className="px-3 py-2.5 text-center text-slate-300 font-medium border-l border-slate-100 italic bg-slate-50/10">
                                                                -
                                                              </td>
                                                            );
                                                          }

                                                          const isAbnormal = match.flag === "HIGH" || match.flag === "LOW" || match.flag === "ABNORMAL";
                                                          return (
                                                            <td key={date} className="px-3 py-2.5 text-center border-l border-slate-100 font-bold bg-white">
                                                              <div className="flex flex-col items-center justify-center gap-0.5">
                                                                <span className={`text-[11px] font-black ${isAbnormal ? "text-amber-600" : "text-slate-900"}`}>
                                                                  {match.value}
                                                                </span>
                                                                <span className={`text-[7px] font-black uppercase px-1 py-0.2 rounded-xs border ${
                                                                  isAbnormal 
                                                                    ? "bg-amber-100 text-amber-700 border-amber-200" 
                                                                    : "bg-[var(--theme-accent-bg)]merald-100 text-emerald-700 border-emerald-200"
                                                                }`}>
                                                                  {match.flag || "NORMAL"}
                                                                </span>
                                                              </div>
                                                            </td>
                                                          );
                                                        })}

                                                        {/* Trend calculations */}
                                                        <td className="px-3 py-2.5 border-l border-slate-200">
                                                          {(() => {
                                                            const historicalEntries = rowsInCat
                                                              .filter(r => r.name === paramName)
                                                              .sort((a, b) => new Date(a.collectedAt).getTime() - new Date(b.collectedAt).getTime());

                                                            if (historicalEntries.length >= 2) {
                                                              const firstEntry = historicalEntries[0];
                                                              const lastEntry = historicalEntries[historicalEntries.length - 1];
                                                              
                                                              const firstVal = parseFloat(firstEntry.value);
                                                              const lastVal = parseFloat(lastEntry.value);

                                                              if (!isNaN(firstVal) && !isNaN(lastVal)) {
                                                                const diff = lastVal - firstVal;
                                                                const changePct = firstVal !== 0 ? ((diff / firstVal) * 100) : 0;
                                                                const sign = diff > 0 ? "+" : "";
                                                                
                                                                return (
                                                                  <div className="flex items-center gap-1 flex-wrap">
                                                                    {diff > 0 ? (
                                                                      <span className="text-amber-600 font-bold flex items-center gap-0.5 text-[9px] bg-amber-50 px-1 rounded border border-amber-100">
                                                                        ▲ {sign}{changePct.toFixed(0)}%
                                                                      </span>
                                                                    ) : diff < 0 ? (
                                                                      <span className="text-emerald-600 font-bold flex items-center gap-0.5 text-[9px] bg-[var(--theme-accent-bg)]merald-50 px-1 rounded border border-emerald-100">
                                                                        ▼ {changePct.toFixed(0)}%
                                                                      </span>
                                                                    ) : (
                                                                      <span className="text-slate-400 font-bold text-[9px] bg-slate-50 px-1 rounded border border-slate-200">
                                                                        ➔ 0%
                                                                      </span>
                                                                    )}
                                                                    <span className="text-[8px] font-mono text-slate-400">
                                                                      ({firstEntry.value} ➔ {lastEntry.value})
                                                                    </span>
                                                                  </div>
                                                                );
                                                              }
                                                            }
                                                            return <span className="text-slate-300 text-[9px] font-mono italic">Single measure</span>;
                                                          })()}
                                                        </td>
                                                      </tr>
                                                    );
                                                  })}
                                                </React.Fragment>
                                              );
                                            })}
                                          </tbody>
                                        </table>
                                      </div>
                                    </div>
                                  );
                                })()
                              ) : (
                                /* Standard Flat List View */
                                <div className="flex flex-col gap-5">
                                  {categories.map(cat => {
                                    const rowsInCat = allLabRows
                                      .filter(r => r.category.toUpperCase() === cat)
                                      .filter(r => selectedLabDate === "all" || r.collectedAt === selectedLabDate);

                                    if (rowsInCat.length === 0) return null;

                                    // Sort by Date Collected descending, then by parameter name
                                    rowsInCat.sort((a, b) => {
                                      const timeDiff = new Date(b.collectedAt).getTime() - new Date(a.collectedAt).getTime();
                                      if (timeDiff !== 0) return timeDiff;
                                      return a.name.localeCompare(b.name);
                                    });

                                    return (
                                      <div key={cat} className="border border-slate-200 rounded-lg overflow-hidden bg-white shadow-xs">
                                        {/* Category Header */}
                                        <div className="bg-slate-50 px-3 py-1.5 border-b flex justify-between items-center">
                                          <span className="text-[10px] font-black text-slate-700 uppercase tracking-wider">
                                            Category: {cat}
                                          </span>
                                          <span className="text-[8px] font-mono font-bold text-[#2a5178] bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded">
                                            {rowsInCat.length} Parameters
                                          </span>
                                        </div>

                                        {/* Table */}
                                        <div className="overflow-x-auto">
                                          <table className="w-full text-left border-collapse">
                                            <thead>
                                              <tr className="border-b bg-slate-50/30 text-[9px] text-slate-400 font-extrabold uppercase tracking-wider">
                                                <th className="px-3 py-1.5">Test Parameter</th>
                                                <th className="px-3 py-1.5">Panel Source</th>
                                                <th className="px-3 py-1.5">Result Value</th>
                                                <th className="px-3 py-1.5 font-mono">Ref Range</th>
                                                <th className="px-3 py-1.5">Date Collected</th>
                                                <th className="px-3 py-1.5 text-right">Flag Status</th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {rowsInCat.map((row, i) => {
                                                const isAbnormal = row.flag === "HIGH" || row.flag === "LOW" || row.flag === "ABNORMAL";
                                                return (
                                                  <tr key={i} className="border-b last:border-b-0 hover:bg-slate-50/20 text-[10px] transition-colors">
                                                    <td className="px-3 py-2 font-bold text-slate-800">{row.name}</td>
                                                    <td className="px-3 py-2 text-slate-500 font-medium truncate max-w-[150px]" title={row.panel}>
                                                      {row.panel}
                                                    </td>
                                                    <td className="px-3 py-2 font-bold text-slate-900">
                                                      {row.value} <span className="text-slate-400 font-normal">{row.unit}</span>
                                                    </td>
                                                    <td className="px-3 py-2 text-slate-400 font-mono font-medium">{row.reference_range || "N/A"}</td>
                                                    <td className="px-3 py-2 font-mono text-slate-500">{row.dateStr}</td>
                                                    <td className="px-3 py-2 text-right">
                                                      <span className={`inline-block px-1.5 py-0.5 rounded text-[8px] font-black uppercase ${
                                                        isAbnormal
                                                          ? "bg-amber-100 text-amber-700 border border-amber-200"
                                                          : "bg-[var(--theme-accent-bg)]merald-100 text-emerald-700 border border-emerald-200"
                                                      }`}>
                                                        {row.flag || "NORMAL"}
                                                      </span>
                                                    </td>
                                                  </tr>
                                                );
                                              })}
                                            </tbody>
                                          </table>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        {chartReviewSubTab === "encounters" && (
                          <div className="flex flex-col gap-3">
                            <h4 className="font-bold text-[#2a5178] border-b pb-1 mb-2">Scheduled Outpatient Encounters</h4>
                            {patientAppointments.length === 0 ? (
                              <div className="text-center py-10 bg-slate-50 border border-dashed rounded-lg text-slate-400 italic">
                                No scheduling encounters currently active in local directory logs.
                              </div>
                            ) : (
                              <div className="flex flex-col gap-2">
                                {patientAppointments.map((appt) => {
                                  const d = new Date(appt.schedule_time);
                                  return (
                                    <div key={appt.id} className="p-3 bg-slate-50 border rounded-lg flex justify-between items-center gap-4 hover:border-slate-300 transition-colors">
                                      <div>
                                        <strong className="text-slate-800 text-xs">{isNaN(d.getTime()) ? appt.schedule_time : d.toLocaleString("en-GB")}</strong>
                                        <p className="text-[11px] text-slate-500 mt-0.5">Physician: {appt.doctor_name} &bull; Location: Suite {appt.room} &bull; Status: Confirmed</p>
                                      </div>
                                      <span className="bg-[var(--theme-accent-bg)]merald-50 text-emerald-700 text-[10px] font-black border border-emerald-200 px-2 py-0.5 rounded uppercase">Active</span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}

                      </div>
                    </div>
                  )}

                  {activeWorkspaceTab === "synopsis" && (
                    <div className="flex-1 p-4 overflow-y-auto">
                      <h4 className="text-xs font-bold text-[#2a5178] uppercase tracking-wider mb-2 border-b pb-1">Synopsis Timeline Trends</h4>
                      <div className="bg-slate-50 border p-4 rounded-xl text-center text-slate-400 my-4 flex flex-col items-center justify-center min-h-[220px]">
                        <Activity className="h-10 w-10 text-[var(--theme-accent)] animate-pulse mb-2" />
                        <strong className="text-slate-700 text-xs">Vitals Trend Analysis</strong>
                        <p className="text-[11px] text-slate-400 mt-1 max-w-xs">
                          Generating clinical graph trend representing blood pressure (BP), heart rate, and weight fluctuations over the last 5 encounters.
                        </p>
                        <div className="mt-4 flex gap-4 text-[10px] font-mono text-slate-600 bg-white p-2 rounded border">
                          <span>BP: 120/80 mmHg (Normal)</span>
                          <span>HR: 72 bpm (Normal)</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {activeWorkspaceTab === "assessment" && (
                    <div className="flex-1 p-4 overflow-y-auto">
                      <h4 className="text-xs font-bold text-[#2a5178] uppercase tracking-wider mb-2 border-b pb-1">Interactive Diagnostic Screenings</h4>
                      <p className="text-[11px] text-slate-500 mb-3 leading-relaxed">
                        To run the fully functional GAD-7 Anxiety Assessment or review details, open the patient encounter or click the <strong>Write Note / Resume Draft</strong> tab on the right panel. Clinical forms are integrated seamlessly.
                      </p>
                      
                      {patientNotes.some(n => n.note_data) ? (
                        <div className="flex flex-col gap-3">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Completed Assessments:</span>
                          {patientNotes.map((note) => {
                            if (!note.note_data) return null;
                            return (
                              <ClinicalFormReadOnlyView key={note.id} data={note.note_data} />
                            );
                          })}
                        </div>
                      ) : (
                        <div className="bg-slate-50 border p-4 rounded-xl text-center text-slate-400 italic">
                          No diagnostic screenings stored for this patient yet. GAD-7 form inputs can be accessed inside any visit note session on the right block.
                        </div>
                      )}
                    </div>
                  )}

                  {activeWorkspaceTab === "plan" && (
                    <div className="flex-1 p-4 overflow-y-auto">
                      <h4 className="text-xs font-bold text-[#2a5178] uppercase tracking-wider mb-2 border-b pb-1">Outpatient Plan of Care</h4>
                      <div className="bg-[#edf3f8] border border-[#c2d5e7] p-3 rounded-lg mb-3">
                        <span className="text-[10px] font-bold text-[#2a5178] uppercase block mb-1">Declared Medical History</span>
                        <p className="text-xs text-slate-700 whitespace-pre-line leading-relaxed italic">
                          "{selectedPatient.history || "No pre-existing clinical history declared."}"
                        </p>
                      </div>

                      <div className="bg-white border rounded-lg p-3 text-xs leading-relaxed">
                        <strong className="text-slate-700 block mb-1">Standard Discharge Checklist Instructions:</strong>
                        <ul className="list-disc pl-4 text-slate-600 flex flex-col gap-1 text-[11px]">
                          <li>Monitor BP twice daily (morning & night), logging values.</li>
                          <li>Follow up with clinical endocrinology as scheduled.</li>
                          <li>Report any experiences of severe anxiety or restless sleep immediately to PCP.</li>
                        </ul>
                      </div>
                    </div>
                  )}

                  {activeWorkspaceTab === "orders" && (
                    <div className="flex-1 p-4 overflow-y-auto">
                      <div className="flex items-center justify-between mb-3 border-b pb-2">
                        <h4 className="text-xs font-bold text-[#2a5178] uppercase tracking-wider">Medication & Nursing Orders</h4>
                        {SHOW_LEGACY_ORDER_FORM && (
                          <button
                            type="button"
                            onClick={() => { setOrderError(null); setIsAddingOrder(v => !v); }}
                            className="bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-dark)] text-white font-bold px-2.5 py-1.5 rounded text-[10px] flex items-center gap-1 cursor-pointer"
                          >
                            <Plus size={11} /> {isAddingOrder ? "Cancel" : "New Order"}
                          </button>
                        )}
                      </div>

                      {SHOW_LEGACY_ORDER_FORM && isAddingOrder && (
                        <form onSubmit={handleCreateOrder} className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-4 flex flex-col gap-2.5">
                          {orderError && <div className="bg-red-50 border border-red-100 text-red-600 text-[10px] font-semibold px-2.5 py-1.5 rounded">{orderError}</div>}
                          <div className="flex gap-2">
                            <button type="button" onClick={() => setOrderForm({ ...orderForm, order_type: "medication" })} className={`flex-1 text-[10px] font-bold py-1.5 rounded border cursor-pointer ${orderForm.order_type === "medication" ? "bg-[var(--theme-accent)] text-white border-[var(--theme-accent)]" : "bg-white text-slate-600 border-slate-200"}`}>
                              <Syringe size={11} className="inline mr-1" /> Medication
                            </button>
                            <button type="button" onClick={() => setOrderForm({ ...orderForm, order_type: "task" })} className={`flex-1 text-[10px] font-bold py-1.5 rounded border cursor-pointer ${orderForm.order_type === "task" ? "bg-[var(--theme-accent)] text-white border-[var(--theme-accent)]" : "bg-white text-slate-600 border-slate-200"}`}>
                              <ClipboardList size={11} className="inline mr-1" /> Nursing Task
                            </button>
                          </div>

                          <div className="flex gap-2">
                            <button type="button" onClick={() => setOrderForm({ ...orderForm, is_one_time: false })} className={`flex-1 text-[10px] font-bold py-1.5 rounded border cursor-pointer ${!orderForm.is_one_time ? "bg-slate-700 text-white border-slate-700" : "bg-white text-slate-600 border-slate-200"}`}>
                              <RotateCw size={11} className="inline mr-1" /> Repeats
                            </button>
                            <button type="button" onClick={() => setOrderForm({ ...orderForm, is_one_time: true })} className={`flex-1 text-[10px] font-bold py-1.5 rounded border cursor-pointer ${orderForm.is_one_time ? "bg-slate-700 text-white border-slate-700" : "bg-white text-slate-600 border-slate-200"}`}>
                              One-time
                            </button>
                          </div>

                          {orderForm.order_type === "medication" ? (
                            <div className="grid grid-cols-2 gap-2">
                              <div className="col-span-2">
                                <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">Drug</label>
                                <input
                                  required
                                  type="text"
                                  list="order-drug-options"
                                  placeholder="Type a drug name or pick from the list..."
                                  value={orderForm.drug_input}
                                  onChange={(e) => setOrderForm({ ...orderForm, drug_input: e.target.value })}
                                  className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg"
                                />
                                <datalist id="order-drug-options">
                                  {orderInventory.map((i: any) => <option key={i.id} value={getDrugLabel(i)} />)}
                                </datalist>
                                <p className="text-[9px] text-slate-400 mt-1">Pick a drug from the pharmacy catalog, or type one that isn't stocked here.</p>
                              </div>
                              <div>
                                <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">Dose (qty per administration)</label>
                                <input required type="number" min="0" step="0.5" value={orderForm.dose_quantity} onChange={(e) => setOrderForm({ ...orderForm, dose_quantity: e.target.value })} className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg" />
                              </div>
                              <div>
                                <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">Route</label>
                                <select value={orderForm.route} onChange={(e) => setOrderForm({ ...orderForm, route: e.target.value })} className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg">
                                  <option value="">Select route...</option>
                                  {MEDICATION_ROUTES.map((r) => <option key={r} value={r}>{r}</option>)}
                                </select>
                              </div>
                              {!orderForm.is_one_time && (
                                <div>
                                  <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">Every (hours)</label>
                                  <input required type="number" min="0.5" step="0.5" value={orderForm.frequency_hours} onChange={(e) => setOrderForm({ ...orderForm, frequency_hours: e.target.value })} className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg" />
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="grid grid-cols-2 gap-2">
                              <div className="col-span-2">
                                <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">Task Name</label>
                                <input required type="text" placeholder="e.g. Vitals Check, Wound Dressing" value={orderForm.task_name} onChange={(e) => setOrderForm({ ...orderForm, task_name: e.target.value })} className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg" />
                              </div>
                              {!orderForm.is_one_time && (
                                <>
                                  <div>
                                    <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">Every (hours)</label>
                                    <input required type="number" min="0.5" step="0.5" value={orderForm.frequency_hours} onChange={(e) => setOrderForm({ ...orderForm, frequency_hours: e.target.value })} className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg" />
                                  </div>
                                  <div>
                                    <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">Total Occurrences (optional)</label>
                                    <input type="number" min="1" placeholder="Ongoing" value={orderForm.total_occurrences} onChange={(e) => setOrderForm({ ...orderForm, total_occurrences: e.target.value })} className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg" />
                                  </div>
                                </>
                              )}
                            </div>
                          )}

                          {orderForm.is_one_time ? (
                            <p className="text-[9.5px] text-slate-500 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5">
                              This order is given once. It will drop off the nurse's queue automatically after it's completed.
                            </p>
                          ) : orderForm.order_type === "medication" && (
                            <div>
                              <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">Total Occurrences (optional)</label>
                              <input type="number" min="1" placeholder="Ongoing until discontinued" value={orderForm.total_occurrences} onChange={(e) => setOrderForm({ ...orderForm, total_occurrences: e.target.value })} className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg" />
                            </div>
                          )}

                          <div>
                            <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">Instructions (optional)</label>
                            <input type="text" placeholder="e.g. Give with food; hold if BP < 100/60" value={orderForm.instructions} onChange={(e) => setOrderForm({ ...orderForm, instructions: e.target.value })} className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg" />
                          </div>

                          <button type="submit" className="bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-dark)] text-white font-bold px-3 py-1.5 rounded text-[10px] self-start cursor-pointer">
                            Place Order
                          </button>
                        </form>
                      )}

                      {SHOW_LEGACY_ORDER_FORM && !isAddingOrder && (
                        <p className="text-[11px] text-slate-400 text-center py-6">
                          All orders for this patient are listed in the <strong className="text-slate-500">Order History</strong> panel on the right. Click <strong className="text-slate-500">New Order</strong> to place one.
                        </p>
                      )}

                      {/* Free-text quick order entry -- type an order, press Enter, it lands
                          below as a draft. Nothing here is visible to nursing/pharmacy until
                          it's signed. */}
                      <form onSubmit={handleQuickOrderSubmit} className="flex flex-col gap-1.5 mb-4">
                        {orderError && <div className="bg-red-50 border border-red-100 text-red-600 text-[10px] font-semibold px-2.5 py-1.5 rounded">{orderError}</div>}
                        <div className="flex gap-2 items-center">
                          <input
                            ref={quickOrderInputRef}
                            type="text"
                            autoFocus
                            value={quickOrderText}
                            onChange={(e) => setQuickOrderText(e.target.value)}
                            placeholder='Type an order and press Enter... e.g. "Paracetamol 500mg PO q8h x5" or "Vitals check every 4h"'
                            className="flex-1 px-3 py-2 text-xs border border-slate-200 rounded-lg"
                          />
                          <button
                            type="submit"
                            disabled={!quickOrderText.trim() || isSubmittingQuickOrder}
                            className="bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-dark)] disabled:opacity-40 text-white font-bold px-3 py-2 rounded text-[10px] flex items-center gap-1 cursor-pointer shrink-0"
                          >
                            <Plus size={11} /> Add
                          </button>
                        </div>
                        <p className="text-[9.5px] text-slate-400">
                          Write freely -- drug, dose, route, and frequency are picked up automatically where possible. Each order stays a <strong className="text-slate-500">draft</strong> below until you sign it.
                        </p>
                      </form>

                      <div className="mb-2 flex items-center justify-between">
                        <h5 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                          Drafts{draftOrders.length > 0 && ` (${draftOrders.length})`}
                        </h5>
                        {draftOrders.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleSignOrders(draftOrders.map((o: any) => o.id))}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-2.5 py-1 rounded text-[10px] flex items-center gap-1 cursor-pointer"
                          >
                            <Check size={11} /> Sign All ({draftOrders.length})
                          </button>
                        )}
                      </div>

                      {draftOrders.length === 0 ? (
                        <p className="text-[11px] text-slate-400 text-center py-4 border border-dashed border-slate-200 rounded-lg mb-4">
                          No drafts yet -- type an order above and press Enter.
                        </p>
                      ) : (
                        <div className="flex flex-col gap-2 mb-4">
                          {draftOrders.map((order: any) => {
                            const isSigning = signingOrderIds.has(order.id);
                            return (
                              <div key={order.id} className="bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                                {editingDraftId === order.id ? (
                                  <div className="flex gap-2 items-center">
                                    <input
                                      type="text"
                                      autoFocus
                                      value={editingDraftText}
                                      onChange={(e) => setEditingDraftText(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") { e.preventDefault(); handleSaveEditDraft(order.id); }
                                        if (e.key === "Escape") setEditingDraftId(null);
                                      }}
                                      className="flex-1 px-2 py-1 text-xs border border-slate-200 rounded"
                                    />
                                    <button type="button" onClick={() => handleSaveEditDraft(order.id)} className="text-[10px] font-bold text-emerald-600 hover:text-emerald-800 cursor-pointer">Save</button>
                                    <button type="button" onClick={() => setEditingDraftId(null)} className="text-[10px] font-bold text-slate-400 hover:text-slate-600 cursor-pointer">Cancel</button>
                                  </div>
                                ) : (
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="flex-1 cursor-pointer" onClick={() => handleStartEditDraft(order)}>
                                      <p className="text-xs text-slate-700">{order.raw_order_text}</p>
                                      <p className="text-[9px] text-slate-400 mt-0.5">
                                        {order.order_type === "medication" ? (
                                          <><Syringe size={9} className="inline mr-0.5" /> Medication</>
                                        ) : (
                                          <><ClipboardList size={9} className="inline mr-0.5" /> Task</>
                                        )}
                                        {order.route && ` · ${order.route}`}
                                        {order.total_occurrences === 1 ? " · one-time" : ` · every ${order.frequency_hours}h`}
                                        {" · click to edit"}
                                      </p>
                                    </div>
                                    <div className="flex gap-1 items-center shrink-0">
                                      <button
                                        type="button"
                                        disabled={isSigning}
                                        onClick={() => handleSignOrders([order.id])}
                                        className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-bold px-2 py-1 rounded text-[10px] flex items-center gap-1 cursor-pointer"
                                      >
                                        <Check size={10} /> Sign
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleDiscontinueOrder(order.id)}
                                        className="text-[10px] font-bold text-red-500 hover:text-red-700 border border-red-200 hover:border-red-400 rounded px-2 py-1 cursor-pointer"
                                      >
                                        Discard
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {activeWorkspaceTab === "medications" && (
                    <div className="flex-1 p-4 overflow-y-auto">
                      <div className="flex items-center justify-between mb-3 border-b pb-2">
                        <div>
                          <h4 className="text-xs font-bold text-[#2a5178] uppercase tracking-wider">Current Medications</h4>
                          <p className="text-[10px] text-slate-400 mt-0.5">What the patient is currently taking. Separate from standing Orders / nurse Care Queue.</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => { isAddingMedication ? handleCancelMedicationForm() : (resetMedForm(), setEditingMedId(null), setMedError(null), setIsAddingMedication(true)); }}
                          className="bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-dark)] text-white font-bold px-2.5 py-1.5 rounded text-[10px] flex items-center gap-1 cursor-pointer"
                        >
                          <Plus size={11} /> {isAddingMedication ? "Cancel" : "Add Medication"}
                        </button>
                      </div>

                      {isAddingMedication && (
                        <form onSubmit={handleSaveMedication} className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-4 flex flex-col gap-2.5">
                          {medError && <div className="bg-red-50 border border-red-100 text-red-600 text-[10px] font-semibold px-2.5 py-1.5 rounded">{medError}</div>}
                          <div>
                            <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">Drug Name</label>
                            <input
                              required
                              type="text"
                              placeholder="e.g. Metformin 500mg"
                              value={medForm.drug_name}
                              onChange={(e) => setMedForm({ ...medForm, drug_name: e.target.value })}
                              className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg"
                            />
                          </div>
                          <div>
                            <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">Dose / Route / Frequency Note (optional)</label>
                            <input
                              type="text"
                              placeholder="e.g. 500mg PO BID with food"
                              value={medForm.note}
                              onChange={(e) => setMedForm({ ...medForm, note: e.target.value })}
                              className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg"
                            />
                          </div>
                          <div className="flex gap-2">
                            <button type="submit" className="bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-dark)] text-white font-bold px-3 py-1.5 rounded text-[10px] self-start cursor-pointer">
                              {editingMedId ? "Save Changes" : "Add to List"}
                            </button>
                            <button type="button" onClick={handleCancelMedicationForm} className="bg-white hover:bg-slate-100 border border-slate-200 text-slate-500 font-bold px-3 py-1.5 rounded text-[10px] self-start cursor-pointer">
                              Cancel
                            </button>
                          </div>
                        </form>
                      )}

                      <div className="flex flex-col gap-2">
                        {isMedsLoading && (
                          <p className="text-[11px] text-slate-400 text-center py-6">Loading medications...</p>
                        )}
                        {!isMedsLoading && patientMedications.length === 0 && (
                          <p className="text-[11px] text-slate-400 text-center py-6">No current medications logged for this patient yet.</p>
                        )}
                        {patientMedications.map((med: any) => (
                          <div key={med.id} className="border border-slate-200 bg-white rounded-lg p-2.5">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-start gap-1.5">
                                <Pill size={12} className="text-[var(--theme-accent)] mt-0.5 shrink-0" />
                                <div>
                                  <div className="text-xs font-bold text-slate-700">{med.drug_name}</div>
                                  {med.note && <div className="text-[10px] text-slate-500 mt-0.5">{med.note}</div>}
                                  <div className="text-[9px] text-slate-400 mt-1">Added by {med.profiles?.full_name || "Unknown"} · {new Date(med.created_at).toLocaleDateString("en-GB")}</div>
                                </div>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <button type="button" onClick={() => handleEditMedication(med)} title="Edit" className="text-slate-400 hover:text-[var(--theme-accent)] cursor-pointer p-1">
                                  <Edit3 size={13} />
                                </button>
                                <button type="button" onClick={() => handleDeleteMedication(med.id)} title="Delete" className="text-slate-400 hover:text-red-500 cursor-pointer p-1">
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {activeWorkspaceTab === "contact_log" && (
                    <div className="flex-1 p-4 overflow-y-auto">
                      <div className="flex items-center justify-between mb-3 border-b pb-2">
                        <div>
                          <h4 className="text-xs font-bold text-[#2a5178] uppercase tracking-wider">Contact Log</h4>
                          <p className="text-[10px] text-slate-400 mt-0.5">Calls, messages, and staff contact with this patient -- plus every scheduled/rescheduled/cancelled appointment. Not the same as clinical notes.</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => isLoggingContact ? setIsLoggingContact(false) : openLogContactForm()}
                          className="bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-dark)] text-white font-bold px-2.5 py-1.5 rounded text-[10px] flex items-center gap-1 cursor-pointer shrink-0"
                        >
                          <Plus size={11} /> {isLoggingContact ? "Cancel" : "Log Contact"}
                        </button>
                      </div>

                      {isLoggingContact && (
                        <form onSubmit={handleLogContact} className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-4 flex flex-col gap-2.5">
                          {clError && <div className="bg-red-50 border border-red-100 text-red-600 text-[10px] font-semibold px-2.5 py-1.5 rounded">{clError}</div>}

                          <div className="grid grid-cols-2 gap-2.5">
                            <div>
                              <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">Type</label>
                              <select value={clEntryType} onChange={(e) => setClEntryType(e.target.value as any)} className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white">
                                <option value="phone_call">Phone Call</option>
                                <option value="message">Message</option>
                                <option value="nurse_contact">Nurse Contact</option>
                                <option value="provider_contact">Provider Contact</option>
                                <option value="secretary_contact">Secretary Contact</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">Who initiated it</label>
                              <select value={clActor} onChange={(e) => setClActor(e.target.value as any)} className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white">
                                <option value="patient">Patient</option>
                                <option value="secretary">Secretary</option>
                                <option value="nurse">Nurse</option>
                                <option value="provider">Provider</option>
                                <option value="admin">Admin</option>
                                <option value="other">Other</option>
                              </select>
                            </div>
                          </div>

                          <div>
                            <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">Summary (always visible to anyone who can see this log)</label>
                            <input
                              required
                              type="text"
                              placeholder="e.g. Called to confirm insurance details"
                              value={clSummary}
                              onChange={(e) => setClSummary(e.target.value)}
                              className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg"
                            />
                          </div>

                          <label className="flex items-center gap-2 text-[10px] font-bold text-slate-500 cursor-pointer select-none">
                            <input type="checkbox" checked={clAttachNote} onChange={(e) => setClAttachNote(e.target.checked)} />
                            Attach a note visible only to specific staff
                          </label>

                          {clAttachNote && (
                            <div className="bg-white border border-slate-200 rounded-lg p-2.5 flex flex-col gap-2.5">
                              <div>
                                <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">Note content</label>
                                <textarea
                                  rows={2}
                                  placeholder="Details that shouldn't show up in the general log line..."
                                  value={clNoteBody}
                                  onChange={(e) => setClNoteBody(e.target.value)}
                                  className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg resize-none"
                                />
                              </div>
                              <p className="text-[9px] text-slate-400 -mt-1">
                                Doctors, nurses, psychologists, occupational/physical therapists, pharmacy, and admin always see this. Leave the fields below blank to keep it clinical-only.
                              </p>
                              <div className="grid grid-cols-2 gap-2.5">
                                <div>
                                  <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">Also route to role (optional)</label>
                                  <select value={clRecipientRole} onChange={(e) => setClRecipientRole(e.target.value)} className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white">
                                    <option value="">-- none --</option>
                                    <option value="secretary">Secretary</option>
                                    <option value="admissions">Admissions</option>
                                    <option value="hr">HR</option>
                                    <option value="pharmacy">Pharmacy</option>
                                  </select>
                                </div>
                                <div>
                                  <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">Also route to person (optional)</label>
                                  <select value={clRecipientUserId} onChange={(e) => setClRecipientUserId(e.target.value)} className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white">
                                    <option value="">-- none --</option>
                                    {staffDirectory.map(s => <option key={s.id} value={s.id}>{s.full_name} ({s.role})</option>)}
                                  </select>
                                </div>
                              </div>
                            </div>
                          )}

                          <div className="flex gap-2">
                            <button type="submit" disabled={clSaving} className="bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-dark)] text-white font-bold px-3 py-1.5 rounded text-[10px] self-start cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed">
                              {clSaving ? "Saving..." : "Save to Log"}
                            </button>
                            <button type="button" onClick={() => setIsLoggingContact(false)} className="bg-white hover:bg-slate-100 border border-slate-200 text-slate-500 font-bold px-3 py-1.5 rounded text-[10px] self-start cursor-pointer">
                              Cancel
                            </button>
                          </div>
                        </form>
                      )}

                      <div className="flex flex-col gap-2">
                        {isContactLogLoading && (
                          <p className="text-[11px] text-slate-400 text-center py-6">Loading Contact Log...</p>
                        )}
                        {!isContactLogLoading && contactLog.length === 0 && (
                          <p className="text-[11px] text-slate-400 text-center py-6">No contact logged for this patient yet.</p>
                        )}
                        {contactLog.map((entry: any) => {
                          const isAppointmentEvent = entry.entry_type.startsWith("appointment_");
                          const Icon = isAppointmentEvent ? CalendarClock : entry.entry_type === "message" ? MessageSquare : PhoneCall;
                          return (
                            <div key={entry.id} className="border border-slate-200 bg-white rounded-lg p-2.5">
                              <div className="flex items-start gap-1.5">
                                <Icon size={12} className="text-[var(--theme-accent)] mt-0.5 shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-xs font-bold text-slate-700">{CONTACT_LOG_TYPE_LABELS[entry.entry_type] || entry.entry_type}</span>
                                    <span className="text-[9px] text-slate-400 uppercase tracking-wider bg-slate-100 px-1.5 py-0.5 rounded-full">by {entry.actor}</span>
                                  </div>
                                  {entry.summary && <div className="text-[11px] text-slate-600 mt-0.5">{entry.summary}</div>}
                                  {entry.staff_note_id && (
                                    entry.staff_notes ? (
                                      <div className="mt-1.5 bg-amber-50 border border-amber-100 rounded p-1.5 text-[10px] text-amber-900">
                                        {entry.staff_notes.body}
                                      </div>
                                    ) : (
                                      <div className="mt-1.5 text-[10px] text-slate-400 italic flex items-center gap-1">
                                        <Lock size={9} /> Note attached -- not routed to you
                                      </div>
                                    )
                                  )}
                                  <div className="text-[9px] text-slate-400 mt-1">
                                    {entry.profiles?.full_name || "Unknown"} &bull; {new Date(entry.occurred_at).toLocaleString("en-GB")}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  </div>
                </div>

                {/* COLUMN C: MY NOTE WORKSPACE (Right Panel) - Width 27% on lg */}
                {showNoteWorkspace && (
                  <div className="col-span-12 lg:col-span-4 bg-white border border-slate-300 rounded-lg flex flex-col overflow-hidden shadow-xs">
                    
                    {/* Tab labels row */}
                    <div className="bg-slate-100 border-b flex items-center justify-between px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider shrink-0">
                      <span className="text-[#2a5178] flex items-center gap-1">
                        <Edit3 size={11} /> MY NOTE WORKSPACE
                      </span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-400 text-[9px] hidden sm:inline">SIMA DRAFT v4.2</span>
                      </div>
                    </div>

                  {activeMyNote ? (
                    <div className="flex-1 flex flex-col min-h-0">
                      
                      {/* Encounter details sub-banner */}
                      <div className="bg-slate-50 p-2.5 border-b border-slate-200/80 flex flex-col gap-1 text-[11px] shrink-0">
                        <div className="flex justify-between items-center">
                          <span className="font-bold text-slate-700">Type: <span className="text-slate-500 font-normal">Progress Notes</span></span>
                          label
                        </div>
                        <div className="flex items-center gap-1">
                          <input 
                            type="checkbox" 
                            id="cosign-required"
                            checked={activeNoteCosign}
                            onChange={(e) => setActiveNoteCosign(e.target.checked)}
                            className="rounded text-[var(--theme-accent)] focus:ring-[var(--theme-accent)] h-3 w-3"
                          />
                          <label htmlFor="cosign-required" className="text-slate-500 font-semibold cursor-pointer">Cosign Required?</label>
                        </div>
                      </div>
                      {/* MICROSOFT WORD STYLE EDITING TOOLBAR */}
                      <div className="bg-slate-100 border-b p-1.5 flex flex-col gap-1.5 shrink-0">
                        {/* FIRST ROW: FONT FAMILY, SIZE, COLORS AND ACTIONS */}
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {/* Font Family selector */}
                          <div className="flex items-center bg-white border border-slate-300 rounded overflow-hidden">
                            <span className="pl-1.5 pr-0.5 text-[9px] text-slate-400 font-bold uppercase shrink-0">Font</span>
                            <select
                              onChange={(e) => executeFormat("fontName", e.target.value)}
                              disabled={isNoteSigned}
                              className="bg-transparent hover:bg-slate-50 px-1 py-0.5 text-[10px] font-medium text-slate-700 focus:outline-none cursor-pointer border-l border-slate-200"
                              title="Font Family"
                            >
                              <option value="Inter">Default (Inter)</option>
                              <option value="Space Grotesk">Space Grotesk</option>
                              <option value="JetBrains Mono">JetBrains Mono</option>
                              <option value="Arial">Arial</option>
                              <option value="Times New Roman">Times New Roman</option>
                              <option value="Georgia">Georgia</option>
                              <option value="Courier New">Courier New</option>
                            </select>
                          </div>

                          {/* Font Size selector */}
                          <div className="flex items-center bg-white border border-slate-300 rounded overflow-hidden">
                            <span className="pl-1.5 pr-0.5 text-[9px] text-slate-400 font-bold uppercase shrink-0">Size</span>
                            <select
                              onChange={(e) => executeFormat("fontSize", e.target.value)}
                              disabled={isNoteSigned}
                              className="bg-transparent hover:bg-slate-50 px-1 py-0.5 text-[10px] font-medium text-slate-700 focus:outline-none cursor-pointer border-l border-slate-200"
                              title="Font Size"
                            >
                              <option value="2">Normal (12px)</option>
                              <option value="1">Small (10px)</option>
                              <option value="3">Medium (14px)</option>
                              <option value="4">Large (18px)</option>
                              <option value="5">X-Large (24px)</option>
                              <option value="6">Heading (32px)</option>
                            </select>
                          </div>

                          {/* Text Color selector */}
                          <div className="flex items-center bg-white border border-slate-300 rounded overflow-hidden" title="Text Color">
                            <span className="pl-1.5 pr-1 text-[9px] text-slate-400 font-bold uppercase shrink-0">Color</span>
                            <select
                              onChange={(e) => executeFormat("foreColor", e.target.value)}
                              disabled={isNoteSigned}
                              className="bg-transparent hover:bg-slate-50 px-1 py-0.5 text-[10px] font-medium text-slate-700 focus:outline-none cursor-pointer border-l border-slate-200"
                            >
                              <option value="#3c4b5c">Charcoal</option>
                              <option value="#c05654">Red</option>
                              <option value="#4a7ba6">Blue</option>
                              <option value="#438a6a">Green</option>
                              <option value="#cfa34d">Orange</option>
                              <option value="#4a7ba6">Purple</option>
                              <option value="var(--theme-accent)">Teal</option>
                            </select>
                          </div>

                          {/* Highlight background Color selector */}
                          <div className="flex items-center bg-white border border-slate-300 rounded overflow-hidden" title="Text Highlight Color">
                            <span className="pl-1.5 pr-1 text-[9px] text-slate-400 font-bold uppercase shrink-0">Highlight</span>
                            <select
                              onChange={(e) => executeFormat("hiliteColor", e.target.value)}
                              disabled={isNoteSigned}
                              className="bg-transparent hover:bg-slate-50 px-1 py-0.5 text-[10px] font-medium text-slate-700 focus:outline-none cursor-pointer border-l border-slate-200"
                            >
                              <option value="transparent">None</option>
                              <option value="#ead096">Yellow</option>
                              <option value="#b5d6c5">Green</option>
                              <option value="#c2d5e7">Blue</option>
                              <option value="#fbcfe8">Pink</option>
                              <option value="#ead096">Orange</option>
                            </select>
                          </div>

                          <div className="h-4 w-px bg-slate-300 self-center hidden sm:block" />

                          {/* Undo & Redo Action Buttons */}
                          <div className="flex items-center border border-slate-300 rounded bg-white overflow-hidden">
                            <button
                              type="button"
                              onClick={() => executeFormat("undo")}
                              disabled={isNoteSigned}
                              className="hover:bg-slate-50 p-1 border-r border-slate-200 text-slate-600 disabled:opacity-40 transition-colors"
                              title="Undo last change"
                            >
                              <RotateCcw size={11} />
                            </button>
                            <button
                              type="button"
                              onClick={() => executeFormat("redo")}
                              disabled={isNoteSigned}
                              className="hover:bg-slate-50 p-1 text-slate-600 disabled:opacity-40 transition-colors"
                              title="Redo next change"
                            >
                              <RotateCw size={11} />
                            </button>
                          </div>
                        </div>

                        {/* SECOND ROW: FORMATTING BUTTONS & TEMPLATE SELECTOR */}
                        <div className="flex items-center justify-between gap-1.5 flex-wrap">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {/* Formatting group */}
                            <div className="flex items-center border border-slate-300 rounded bg-white overflow-hidden">
                              <button 
                                type="button" 
                                onClick={() => executeFormat("bold")}
                                disabled={isNoteSigned}
                                className="hover:bg-slate-50 p-1.5 border-r border-slate-200 text-slate-700 disabled:opacity-40"
                                title="Bold (Ctrl+B)"
                              >
                                <Bold size={11} />
                              </button>
                              <button 
                                type="button" 
                                onClick={() => executeFormat("italic")}
                                disabled={isNoteSigned}
                                className="hover:bg-slate-50 p-1.5 border-r border-slate-200 text-slate-700 disabled:opacity-40"
                                title="Italic (Ctrl+I)"
                              >
                                <Italic size={11} />
                              </button>
                              <button 
                                type="button" 
                                onClick={() => executeFormat("underline")}
                                disabled={isNoteSigned}
                                className="hover:bg-slate-50 p-1.5 border-r border-slate-200 text-slate-700 disabled:opacity-40"
                                title="Underline (Ctrl+U)"
                              >
                                <Underline size={11} />
                              </button>
                              <button 
                                type="button" 
                                onClick={() => executeFormat("strikeThrough")}
                                disabled={isNoteSigned}
                                className="hover:bg-slate-50 p-1.5 text-slate-700 disabled:opacity-40"
                                title="Strikethrough"
                              >
                                <Strikethrough size={11} />
                              </button>
                            </div>

                            {/* Lists group */}
                            <div className="flex items-center border border-slate-300 rounded bg-white overflow-hidden">
                              <button 
                                type="button" 
                                onClick={() => executeFormat("insertUnorderedList")}
                                disabled={isNoteSigned}
                                className="hover:bg-slate-50 p-1.5 border-r border-slate-200 text-slate-700 disabled:opacity-40"
                                title="Bulleted List"
                              >
                                <List size={11} />
                              </button>
                              <button 
                                type="button" 
                                onClick={() => executeFormat("insertOrderedList")}
                                disabled={isNoteSigned}
                                className="hover:bg-slate-50 p-1.5 text-slate-700 disabled:opacity-40"
                                title="Numbered List"
                              >
                                <ListOrdered size={11} />
                              </button>
                            </div>

                            {/* Alignment group */}
                            <div className="flex items-center border border-slate-300 rounded bg-white overflow-hidden">
                              <button 
                                type="button" 
                                onClick={() => executeFormat("justifyLeft")}
                                disabled={isNoteSigned}
                                className="hover:bg-slate-50 p-1.5 border-r border-slate-200 text-slate-700 disabled:opacity-40"
                                title="Align Left"
                              >
                                <AlignLeft size={11} />
                              </button>
                              <button 
                                type="button" 
                                onClick={() => executeFormat("justifyCenter")}
                                disabled={isNoteSigned}
                                className="hover:bg-slate-50 p-1.5 border-r border-slate-200 text-slate-700 disabled:opacity-40"
                                title="Align Center"
                              >
                                <AlignCenter size={11} />
                              </button>
                              <button 
                                type="button" 
                                onClick={() => executeFormat("justifyRight")}
                                disabled={isNoteSigned}
                                className="hover:bg-slate-50 p-1.5 border-r border-slate-200 text-slate-700 disabled:opacity-40"
                                title="Align Right"
                              >
                                <AlignRight size={11} />
                              </button>
                              <button 
                                type="button" 
                                onClick={() => executeFormat("justifyFull")}
                                disabled={isNoteSigned}
                                className="hover:bg-slate-50 p-1.5 text-slate-700 disabled:opacity-40"
                                title="Justify"
                              >
                                <AlignJustify size={11} />
                              </button>
                            </div>

                            {/* Utility Actions group */}
                            <div className="flex items-center border border-slate-300 rounded bg-white overflow-hidden">
                              <button 
                                type="button" 
                                onClick={() => executeFormat("insertHorizontalRule")}
                                disabled={isNoteSigned}
                                className="hover:bg-slate-50 p-1.5 border-r border-slate-200 text-slate-700 disabled:opacity-40 font-bold text-[10px]"
                                title="Insert Horizontal Rule Line"
                              >
                                — Line
                              </button>
                              <button 
                                type="button" 
                                onClick={() => executeFormat("removeFormat")}
                                disabled={isNoteSigned}
                                className="hover:bg-slate-50 p-1.5 text-red-600 disabled:opacity-40 font-bold text-[10px]"
                                title="Clear All Formatting"
                              >
                                T_x (Clear)
                              </button>
                            </div>
                          </div>

                          {/* Fallback SmartText dropdown & Clinical Test dropdown */}
                          <div className="flex items-center gap-2 relative">
                            <select 
                              onChange={(e) => {
                                const val = e.target.value;
                                if (!val) return;
                                const template = getCombinedTemplates().find(t => t.id === val);
                                if (template) {
                                  appendHtmlContent(`<br><br>${template.content}`);
                                  triggerToast(`Inserted ${template.title}`);
                                }
                                e.target.value = ""; 
                              }}
                              disabled={isNoteSigned}
                              className="bg-white hover:bg-slate-100 border border-slate-300 rounded px-2 py-1 text-[10px] font-bold text-[var(--theme-accent)] focus:outline-none cursor-pointer"
                            >
                              <option value="">Insert Template (or type /)...</option>
                              {getCombinedTemplates().map(t => (
                                <option key={t.id} value={t.id}>{t.title}</option>
                              ))}
                            </select>

                            <select 
                              onChange={(e) => {
                                const val = e.target.value;
                                if (!val) return;
                                const test = getCombinedTests().find(t => t.name === val);
                                if (test) {
                                  const testHtml = test.htmlTemplate || `
<br>
<div style="border-left: 3px solid var(--theme-accent); padding: 10px 14px; margin: 8px 0; background: #f4f6f9; border-radius: 6px; border: 1px solid #dee4eb; border-left: 4px solid var(--theme-accent);">
  <strong style="font-size: 11.5px; color: #2b3949; display: block; margin-bottom: 3px;">🧪 CLINICAL ASSESSMENT: ${test.name}</strong>
  <span style="font-size: 10.5px; color: #5d6b7c; font-family: monospace; display: block; margin-bottom: 6px;">
    Code: ${test.code || "N/A"} | Category: ${test.category} | Assessment Type: ${test.sample_type || "N/A"}
  </span>
  <div style="font-size: 11px; color: #3c4b5c; margin-bottom: 8px;">
    <strong>Standard Boundary:</strong> <span style="background: #dee4eb; padding: 1px 5px; border-radius: 4px; font-weight: bold;">${test.normal_range || "N/A"} ${test.unit || ""}</span>
  </div>
  <div style="font-size: 11px; font-weight: bold; color: var(--theme-accent); margin-top: 6px;">
    Measured Result: ______________________ (Normal / Abnormal)
  </div>
</div>
<br>
`;
                                  appendHtmlContent(testHtml);
                                  triggerToast(`Inserted Assessment: ${test.name}`);
                                }
                                e.target.value = ""; 
                              }}
                              disabled={isNoteSigned}
                              className="bg-white hover:bg-slate-100 border border-slate-300 rounded px-2 py-1 text-[10px] font-bold text-[var(--theme-accent)] focus:outline-none cursor-pointer"
                            >
                              <option value="">Insert Assessment/Scale...</option>
                              {getCombinedTests().map(t => (
                                <option key={t.id || t.name} value={t.name}>{t.name} ({t.category})</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>

                      {/* RICH-TEXT WRITING WORKSPACE WITH SLASH COMMAND POPUP */}
                      <div className="flex-1 p-2 flex flex-col min-h-0 relative">
                        <div
                          ref={editorRef}
                          contentEditable={!isNoteSigned}
                          onInput={(e) => setActiveNoteContent(e.currentTarget.innerHTML)}
                          onKeyUp={handleEditorKeyUp}
                          placeholder="Write subjective complaints, physical exam findings, medical diagnostics, assessment parameters, or custom outpatient care plan... (Type / for templates, \ for assessments/tests, or .age, .height, .weight, .bp, .hr, .name, .mrn for patient data)"
                          className="flex-1 w-full bg-slate-50/50 hover:bg-slate-50 border border-slate-200 rounded-lg p-3.5 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)] font-sans leading-relaxed overflow-y-auto outline-none"
                          style={{ minHeight: "150px" }}
                        />

                        {/* FLOATING SLASH COMMAND POPUP MENU */}
                        {showSlashMenu && (
                          <div className="absolute left-4 bottom-14 z-50 w-64 bg-white border border-slate-200 rounded-lg shadow-2xl overflow-hidden flex flex-col max-h-60 animate-in fade-in slide-in-from-bottom-2 duration-150">
                            <div className="bg-slate-50 border-b px-3 py-1.5 flex justify-between items-center text-[10px] font-black text-slate-500 uppercase tracking-widest">
                              <span>Clinical Templates</span>
                              <span className="text-[9px] bg-indigo-50 border border-indigo-100 text-indigo-700 px-1 rounded font-bold">/{slashQuery}</span>
                            </div>
                            <div className="overflow-y-auto flex-1 divide-y divide-slate-100 max-h-48 animate-none">
                              {getCombinedTemplates()
                                .filter(t => t.title.toLowerCase().includes(slashQuery) || t.description.toLowerCase().includes(slashQuery) || t.id.toLowerCase().includes(slashQuery))
                                .map((template) => (
                                  <button
                                    key={template.id}
                                    type="button"
                                    onClick={() => insertTemplateAtCursor(template.content)}
                                    className="w-full text-left px-3 py-2 hover:bg-[var(--theme-accent)]/5 flex items-start gap-2.5 transition-colors cursor-pointer"
                                  >
                                    <span className="text-base shrink-0 select-none">{template.icon}</span>
                                    <div>
                                      <div className="text-[11px] font-bold text-slate-800">{template.title}</div>
                                      <div className="text-[9px] text-slate-400 font-semibold leading-relaxed">{template.description}</div>
                                    </div>
                                  </button>
                                ))}
                              {getCombinedTemplates().filter(t => t.title.toLowerCase().includes(slashQuery) || t.description.toLowerCase().includes(slashQuery) || t.id.toLowerCase().includes(slashQuery)).length === 0 && (
                                <div className="p-4 text-center text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                                  No clinical templates match
                                </div>
                              )}
                            </div>
                            <div className="bg-slate-50 border-t p-1.5 text-center text-[8px] font-bold text-slate-400 uppercase tracking-wider select-none">
                              Click template or type query to filter
                            </div>
                          </div>
                        )}

                        {/* FLOATING BACKSLASH COMMAND POPUP MENU FOR ASSESSMENTS */}
                        {showBackslashMenu && (
                          <div className="absolute left-4 bottom-14 z-50 w-72 bg-white border border-slate-200 rounded-lg shadow-2xl overflow-hidden flex flex-col max-h-60 animate-in fade-in slide-in-from-bottom-2 duration-150">
                            <div className="bg-slate-50 border-b px-3 py-1.5 flex justify-between items-center text-[10px] font-black text-slate-500 uppercase tracking-widest">
                              <span>Clinical Assessments & Scales</span>
                              <span className="text-[9px] bg-teal-50 border border-teal-100 text-teal-700 px-1 rounded font-bold">\{backslashQuery}</span>
                            </div>
                            <div className="overflow-y-auto flex-1 divide-y divide-slate-100 max-h-48 animate-none">
                              {getCombinedTests()
                                .filter(t => t.name.toLowerCase().includes(backslashQuery) || (t.code && t.code.toLowerCase().includes(backslashQuery)) || t.category.toLowerCase().includes(backslashQuery) || (t.description && t.description.toLowerCase().includes(backslashQuery)))
                                .map((test) => {
                                  const testHtml = test.htmlTemplate || `
<br>
<div style="border-left: 3px solid var(--theme-accent); padding: 10px 14px; margin: 8px 0; background: #f4f6f9; border-radius: 6px; border: 1px solid #dee4eb; border-left: 4px solid var(--theme-accent);">
  <strong style="font-size: 11.5px; color: #2b3949; display: block; margin-bottom: 3px;">🧪 CLINICAL ASSESSMENT: ${test.name}</strong>
  <span style="font-size: 10.5px; color: #5d6b7c; font-family: monospace; display: block; margin-bottom: 6px;">
    Code: ${test.code || "N/A"} | Category: ${test.category} | Assessment Type: ${test.sample_type || "N/A"}
  </span>
  <div style="font-size: 11px; color: #3c4b5c; margin-bottom: 8px;">
    <strong>Standard Boundary:</strong> <span style="background: #dee4eb; padding: 1px 5px; border-radius: 4px; font-weight: bold;">${test.normal_range || "N/A"} ${test.unit || ""}</span>
  </div>
  <div style="font-size: 11px; font-weight: bold; color: var(--theme-accent); margin-top: 6px;">
    Measured Result: ______________________ (Normal / Abnormal)
  </div>
</div>
<br>
`;
                                  return (
                                    <button
                                      key={test.id || test.name}
                                      type="button"
                                      onClick={() => insertTestAtCursor(testHtml, test.name)}
                                      className="w-full text-left px-3 py-2 hover:bg-[var(--theme-accent)]/5 flex items-start gap-2.5 transition-colors cursor-pointer"
                                    >
                                      <span className="text-xs shrink-0 select-none text-[var(--theme-accent)] p-1 bg-[var(--theme-accent)]/10 rounded-md">
                                        <FlaskConical size={12} />
                                      </span>
                                      <div className="min-w-0 flex-1">
                                        <div className="text-[11px] font-bold text-slate-800 flex items-center justify-between gap-1">
                                          <span className="truncate">{test.name}</span>
                                          {test.code && <span className="font-mono text-[8px] bg-slate-100 text-slate-500 px-1 rounded shrink-0">{test.code}</span>}
                                        </div>
                                        <div className="text-[9px] text-slate-400 font-semibold truncate leading-relaxed">
                                          {test.category} — {test.description || "No instructions"}
                                        </div>
                                      </div>
                                    </button>
                                  );
                                })}
                              {getCombinedTests().filter(t => t.name.toLowerCase().includes(backslashQuery) || (t.code && t.code.toLowerCase().includes(backslashQuery)) || t.category.toLowerCase().includes(backslashQuery) || (t.description && t.description.toLowerCase().includes(backslashQuery))).length === 0 && (
                                <div className="p-4 text-center text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                                  No clinical assessments match
                                </div>
                              )}
                            </div>
                            <div className="bg-slate-50 border-t p-1.5 text-center text-[8px] font-bold text-slate-400 uppercase tracking-wider select-none">
                              Click assessment or type query to filter
                            </div>
                          </div>
                        )}
                      </div>

                      {noteVoiceError && (
                        <div className="px-2.5 py-1 bg-red-50 border-t border-red-100 text-red-600 text-[9px] font-semibold text-center shrink-0">
                          {noteVoiceError}
                        </div>
                      )}

                      {!isNoteSigned && (
                        <div className={`px-2.5 py-1 border-t text-[9px] font-bold flex items-center gap-1 shrink-0 ${
                          activeNoteAppointmentStatus === "checked-in" ? "bg-emerald-50 text-emerald-700"
                          : activeNoteAppointmentId ? "bg-amber-50 text-amber-700"
                          : "bg-slate-50 text-slate-400"
                        }`}>
                          {activeNoteAppointmentStatus === "checked-in" ? (
                            <>Linked to today's checked-in appointment — can be signed.</>
                          ) : activeNoteAppointmentId ? (
                            <>Linked to today's appointment (not checked in yet) — check the patient in to sign.</>
                          ) : (
                            <>Not linked to an appointment — precharted draft only, can't be signed yet.</>
                          )}
                        </div>
                      )}

                      {myLocations.length > 0 && !isNoteSigned && (
                        <div className="px-2.5 py-1.5 bg-white border-t flex items-center gap-1.5 shrink-0">
                          <MapPin size={11} className="text-slate-400 shrink-0" />
                          <select
                            value={activeNoteLocationId}
                            onChange={e => setActiveNoteLocationId(e.target.value)}
                            className="flex-1 min-w-0 text-[10px] font-semibold text-slate-600 bg-slate-50 border border-slate-200 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)]"
                          >
                            <option value="">Seen at — not specified</option>
                            {myLocations.map(loc => <option key={loc.id} value={loc.id}>Seen at: {loc.name}</option>)}
                          </select>
                        </div>
                      )}

                      {/* BOTTOM ACTION COMMAND FOOTER */}
                      <div className="p-2.5 bg-slate-100 border-t flex items-center justify-between gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            if (confirm("Are you sure you want to discard changes to this note draft?")) {
                              setActiveMyNote(null);
                              setActiveNoteContent("");
                              triggerToast("Note editing session closed");
                            }
                          }}
                          className="text-red-600 hover:bg-red-50 font-bold px-2.5 py-1.5 rounded text-[10px] cursor-pointer"
                        >
                          Cancel
                        </button>

                        <div className="flex items-center gap-1.5">
                          {voiceSupported && !isNoteSigned && (
                            <button
                              type="button"
                              onClick={toggleNoteRecording}
                              title={isRecordingNote ? "Stop voice dictation" : "Dictate note by voice"}
                              className={`flex items-center gap-1 px-2.5 py-1.5 rounded text-[10px] font-bold cursor-pointer transition-colors border ${
                                isRecordingNote
                                  ? "bg-red-100 text-red-600 border-red-200 animate-pulse"
                                  : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
                              }`}
                            >
                              {isRecordingNote ? <MicOff size={11} /> : <Mic size={11} />}
                              {isRecordingNote ? "Listening..." : "Voice"}
                            </button>
                          )}
                          {isNoteSigned ? (
                            <button
                              type="button"
                              onClick={() => {
                                setIsNoteSigned(false);
                                // Strip signature block if present for editing clean draft
                                if (activeNoteContent.includes("[SIGNED ELECTRONICALLY]")) {
                                  const index = activeNoteContent.indexOf("[SIGNED ELECTRONICALLY]");
                                  setActiveNoteContent(activeNoteContent.substring(0, index).trim());
                                }
                                triggerToast("Note unlocked. You can now edit and save changes.");
                              }}
                              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-3 py-1.5 rounded text-[10px] flex items-center gap-1 cursor-pointer shadow-xs transition-colors"
                              title="Unlock this signed note to make edits"
                            >
                              <Edit3 size={11} /> Edit Note
                            </button>
                          ) : (
                            <>
                              <button 
                                type="button"
                                onClick={() => handleSaveActiveNote(false)}
                                disabled={isNoteSaving}
                                className="bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-dark)] disabled:bg-slate-200 text-white disabled:text-slate-500 font-bold px-3 py-1.5 rounded text-[10px] cursor-pointer transition-colors"
                                title="Save note draft to database (Pend)"
                              >
                                {isNoteSaving ? "Saving..." : "Save Draft"}
                              </button>
                              
                              <button
                                type="button"
                                onClick={() => handleSaveActiveNote(true)}
                                disabled={isNoteSaving || !activeNoteAppointmentId}
                                title={!activeNoteAppointmentId ? "Not linked to an appointment for today -- can't be signed" : undefined}
                                className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 text-white disabled:text-slate-500 font-extrabold px-3 py-1.5 rounded text-[10px] flex items-center gap-1 cursor-pointer shadow-xs disabled:cursor-not-allowed"
                              >
                                <Lock size={10} /> Sign Note
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-slate-400">
                      <ClipboardList size={36} className="text-slate-300 mb-2" />
                      <p className="font-bold text-xs text-slate-600">No active progress note draft loaded</p>
                      <p className="text-[10px] text-slate-400 mt-1">Select any clinical record in the center Chart Review or click "Write Note" to start.</p>
                    </div>
                  )}

                </div>
                )}

                {/* ORDER HISTORY PANEL: every order as a one-line row, click to expand */}
                {activeWorkspaceTab === "orders" && (
                  <div className="col-span-12 lg:col-span-4 bg-white border border-slate-300 rounded-lg flex flex-col overflow-hidden shadow-xs">
                    <div className="bg-slate-100 border-b flex items-center justify-between px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider shrink-0">
                      <span className="text-[#2a5178] flex items-center gap-1">
                        <Clock size={11} /> Order History
                      </span>
                      <span className="text-slate-400 normal-case">{signedOrders.filter((o: any) => o.status === "active").length} active · {signedOrders.filter((o: any) => o.status !== "active").length} past</span>
                    </div>
                    <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
                      {signedOrders.length === 0 ? (
                        <div className="p-6 text-center text-slate-400 text-[11px]">
                          <p className="font-semibold">No signed orders yet</p>
                          <p className="text-[10px] mt-0.5">Sign a draft on the left and it'll appear here.</p>
                        </div>
                      ) : (
                        // Newest first, by when the order was originally written -- not
                        // when it was signed, so a "Sign All" of several drafts still
                        // lists them in the order the doctor actually typed them.
                        [...signedOrders].sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).map((order: any) => {
                          const isExpanded = expandedHistoryOrderId === order.id;
                          const doneCount = (order.patient_order_administrations || []).filter((a: any) => a.status === "done").length;
                          const lastAdmin = (order.patient_order_administrations || []).slice().sort((a: any, b: any) => new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime())[0];
                          // Prefer showing exactly what the doctor typed; fall back to the old
                          // structured title for orders placed before free-text entry existed.
                          const title = order.raw_order_text || (order.order_type === "medication"
                            ? `${order.pharmacy_inventory?.drug_name || order.custom_drug_name || "Drug"}${order.dose_quantity ? ` — ${order.dose_quantity} ${order.pharmacy_inventory?.unit || "unit"}` : ""}`
                            : order.task_name);
                          let followUpBadge: { label: string; className: string } | null = null;
                          if (order.status === "active") {
                            const nextDue = computeOrderNextDue(order);
                            const overdue = nextDue.getTime() < new Date().getTime();
                            if (doneCount === 0) {
                              followUpBadge = overdue
                                ? { label: "Awaiting first dose — overdue", className: "bg-red-100 text-red-600" }
                                : { label: "Awaiting first dose", className: "bg-amber-100 text-amber-700" };
                            } else {
                              followUpBadge = overdue
                                ? { label: "Nurse action overdue", className: "bg-red-100 text-red-600" }
                                : { label: "Confirmed by nurse", className: "bg-emerald-100 text-emerald-700" };
                            }
                          }
                          return (
                            <div key={order.id} className={order.status === "active" ? "" : "opacity-70"}>
                              <button
                                type="button"
                                onClick={() => setExpandedHistoryOrderId(isExpanded ? null : order.id)}
                                className="w-full text-left px-3 py-2 hover:bg-slate-50 cursor-pointer transition-colors"
                              >
                                <div className="flex items-center gap-2">
                                  {order.order_type === "medication" ? <Syringe size={11} className="text-[var(--theme-accent)] shrink-0" /> : <ClipboardList size={11} className="text-[var(--theme-accent)] shrink-0" />}
                                  <span className={`text-[11px] font-bold text-slate-700 flex-1 ${isExpanded ? "whitespace-normal break-words" : "truncate"}`}>{title}</span>
                                  <ChevronRight size={12} className={`text-slate-300 shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                                </div>
                              </button>
                              {isExpanded && (
                                <div className="px-3 pb-2.5 pt-1 text-[10px] text-slate-500 flex flex-col gap-1 bg-slate-50/70 animate-in slide-in-from-top-1 duration-150">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded-full ${order.status === "active" ? "bg-emerald-100 text-emerald-700" : order.status === "completed" ? "bg-slate-200 text-slate-500" : "bg-red-100 text-red-500"}`}>{order.status}</span>
                                    {followUpBadge && <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded-full ${followUpBadge.className}`}>{followUpBadge.label}</span>}
                                    {order.route && <span className="text-[8px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-700">{order.route}</span>}
                                  </div>
                                  <div><strong className="text-slate-600">Type:</strong> {order.order_type === "medication" ? "Medication" : "Nursing Task"}</div>
                                  {order.order_type === "medication" && !order.pharmacy_inventory && order.custom_drug_name && (
                                    <div><span className="text-[8px] font-bold uppercase px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">Not stocked</span></div>
                                  )}
                                  <div><strong className="text-slate-600">Schedule:</strong> {order.total_occurrences === 1 ? "One-time order" : `Every ${order.frequency_hours}h`}{order.total_occurrences ? ` · ${doneCount}/${order.total_occurrences} given` : ` · ${doneCount} given so far`}</div>
                                  <div><strong className="text-slate-600">Ordered by:</strong> {order.profiles?.full_name || "Unknown"}</div>
                                  {order.signed_at && <div><strong className="text-slate-600">Signed:</strong> {new Date(order.signed_at).toLocaleString("en-GB")}</div>}
                                  {order.created_at && <div><strong className="text-slate-600">Placed:</strong> {new Date(order.created_at).toLocaleString("en-GB")}</div>}
                                  {order.instructions && <div><strong className="text-slate-600">Instructions:</strong> <span className="italic">{order.instructions}</span></div>}
                                  {lastAdmin && (
                                    <div className="bg-white border border-slate-100 rounded px-1.5 py-1 mt-0.5">
                                      Last given: {new Date(lastAdmin.completed_at).toLocaleString("en-GB")} by {lastAdmin.profiles?.full_name || "Unknown nurse"} — {lastAdmin.recorded_value || "No value recorded"}
                                    </div>
                                  )}
                                  <div className="flex items-center gap-1.5 mt-0.5">
                                    <button type="button" onClick={() => handleRenewOrder(order)} className="self-start text-[10px] font-bold text-[var(--theme-accent-dark)] hover:opacity-80 border border-[var(--theme-accent)] rounded px-2 py-1 flex items-center gap-1 cursor-pointer transition-colors">
                                      <RotateCw size={11} /> Renew / Change
                                    </button>
                                    {order.status === "active" && (
                                      <button type="button" onClick={() => handleDiscontinueOrder(order.id)} className="self-start text-[10px] font-bold text-red-500 hover:text-red-700 border border-red-200 hover:border-red-400 rounded px-2 py-1 flex items-center gap-1 cursor-pointer transition-colors">
                                        <Ban size={11} /> Discontinue Order
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}

              </div>

              {/* UNIVERSAL BOTTOM ACTION BAR */}
              <div className="mt-3 bg-[#edf3f8] border border-[#c2d5e7] rounded-lg p-2.5 flex items-center justify-between flex-wrap gap-3 text-xs shadow-xs">
                <div className="flex items-center gap-3.5 flex-wrap">
                  <div className="flex items-center gap-1.5 text-[#224264]">
                    <span className="font-extrabold uppercase text-[9px] bg-[var(--theme-accent)] text-white px-2 py-0.5 rounded tracking-wider">Universal Action Bar</span>
                  </div>
                  
                  {/* Diagnosis summary list */}
                  <div className="flex items-center gap-1 text-[11px]">
                    <span className="font-bold text-slate-500">Diagnoses:</span>
                    <div className="flex items-center gap-1 flex-wrap">
                      {activeDiagnoses.length === 0 ? (
                        <span className="text-slate-400 italic">None declared</span>
                      ) : (
                        activeDiagnoses.map((dx, i) => (
                          <span key={i} className="bg-white border border-slate-200 px-1.5 py-0.5 rounded font-mono text-[9.5px] text-[#224264] font-bold flex items-center gap-1">
                            <span>{dx.code}</span>
                            <button 
                              type="button" 
                              onClick={() => {
                                setActiveDiagnoses(prev => prev.filter((_, idx) => idx !== i));
                                triggerToast(`Removed Diagnosis ${dx.code}`);
                              }}
                              className="text-red-500 hover:text-red-700 font-extrabold cursor-pointer ml-1"
                              title="Delete diagnosis"
                            >
                              ×
                            </button>
                          </span>
                        ))
                      )}
                    </div>
                  </div>

                  <span className="text-slate-300">|</span>

                  {/* Orders summary list */}
                  <div className="flex items-center gap-1 text-[11px]">
                    <span className="font-bold text-slate-500">Active Orders:</span>
                    <div className="flex items-center gap-1 flex-wrap">
                      {activeOrders.length === 0 ? (
                        <span className="text-slate-400 italic">None ordered</span>
                      ) : (
                        activeOrders.map((ord, i) => (
                          <span key={i} className="bg-indigo-50 border border-indigo-150 px-1.5 py-0.5 rounded text-[9.5px] text-indigo-800 font-bold flex items-center gap-1">
                            <span>{ord.type}: {ord.name}</span>
                            <button 
                              type="button" 
                              onClick={() => {
                                setActiveOrders(prev => prev.filter((_, idx) => idx !== i));
                                triggerToast(`Cancelled Order: {ord.name}`);
                              }}
                              className="text-red-500 hover:text-red-700 font-extrabold cursor-pointer ml-1"
                              title="Cancel order"
                            >
                              ×
                            </button>
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                {/* Interactive Order/Dx/Exit CTA buttons */}
                <div className="flex items-center gap-2">
                  <button 
                    type="button"
                    onClick={() => setIsDxModalOpen(true)}
                    className="bg-white hover:bg-[#edf3f8] border border-[#c2d5e7] text-[#2a5178] font-bold px-2.5 py-1 rounded text-[10.5px] flex items-center gap-1 cursor-pointer transition-colors shadow-2xs"
                  >
                    <Plus size={11} /> + Diagnosis
                  </button>
                  <button 
                    type="button"
                    onClick={() => setIsOrderModalOpen(true)}
                    className="bg-white hover:bg-indigo-50 border border-indigo-200 text-indigo-700 font-bold px-2.5 py-1 rounded text-[10.5px] flex items-center gap-1 cursor-pointer transition-colors shadow-2xs"
                  >
                    <Plus size={11} /> + Order
                  </button>
                  <button 
                    type="button"
                    onClick={() => setIsAvsModalOpen(true)}
                    className="bg-[#2a5178] hover:bg-[var(--theme-accent-dark)] text-white font-extrabold px-3 py-1 rounded text-[10.5px] flex items-center gap-1 cursor-pointer transition-colors shadow-xs"
                  >
                    <FileText size={11} /> Exit & AVS
                  </button>
                </div>
              </div>

            </>
          ) : (
            <div className="bg-white p-12 text-center text-slate-400 flex flex-col items-center justify-center min-h-[450px]">
              <Users size={48} className="text-[var(--theme-accent)]/30 mb-4 animate-pulse" />
              <p className="font-bold text-slate-700 text-sm">No Active Patient Chart Loaded</p>
              <p className="text-xs text-slate-400 mt-1 max-w-md leading-relaxed">
                Use the <strong className="text-[var(--theme-accent)] font-bold">"Select Patient"</strong> search in the blue bar above to open a chart, or click <strong className="text-[var(--theme-accent)] font-bold">"Register Patient"</strong> to create a new profile.
              </p>
            </div>
          )}
          </div>
        </div>
      </div>

      {/* ADMIT PATIENT MODAL: find-or-register, then admission request */}
      {isAdmitModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-[99999] overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl border w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150 my-8">
            <div className="px-5 py-4 border-b bg-slate-50 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <UserPlus className="h-4 w-4 text-[var(--theme-accent)]" />
                <span className="font-bold text-xs text-slate-800 uppercase tracking-wide">
                  {admitPatient ? "Admission Request" : "Admit Patient — Find or Register"}
                </span>
              </div>
              <button onClick={() => setIsAdmitModal(false)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
            </div>

            {!admitPatient ? (
              <div className="p-5 flex flex-col gap-3 text-xs">
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search by name, MRN, or phone..."
                    value={admitSearch}
                    onChange={e => setAdmitSearch(e.target.value)}
                    autoFocus
                    className="w-full pl-8.5 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-teal-500"
                  />
                </div>
                <div className="max-h-56 overflow-y-auto divide-y divide-slate-100 border border-slate-100 rounded-lg">
                  {(() => {
                    const q = admitSearch.trim().toLowerCase();
                    const qDigits = q.replace(/\D/g, "").replace(/^0+/, "");
                    const matches = patients.filter(p => {
                      if (!q) return true;
                      if (nameMatchesQuery(p.name, q)) return true;
                      if (p.mrn !== undefined && String(p.mrn).includes(q)) return true;
                      if (qDigits && p.phone && p.phone.replace(/\D/g, "").replace(/^0+/, "").includes(qDigits)) return true;
                      return false;
                    }).slice(0, 8);
                    if (matches.length === 0) {
                      return <div className="p-4 text-center text-slate-400 text-[11px]">No matching patient.</div>;
                    }
                    return matches.map(p => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => { setAdmitError(null); setAdmitPatient(p); }}
                        className="w-full text-left p-2.5 hover:bg-slate-50 flex items-center justify-between gap-2 cursor-pointer"
                      >
                        <span className="font-bold text-[11px] text-slate-700 truncate">{p.name}</span>
                        <span className="text-[10px] text-slate-400 font-mono shrink-0">{formatDateDDMMYYYY(p.birth_date)} · MRN {p.mrn ?? p.id}</span>
                      </button>
                    ));
                  })()}
                </div>
                <button
                  type="button"
                  onClick={() => { setIsAdmitModal(false); setAdmitMode(true); setIsNewPatientModal(true); }}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-3 py-2 rounded-lg text-[11px] flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <UserPlus size={12} /> New Patient — register then admit
                </button>
              </div>
            ) : (
              <form onSubmit={handleRequestAdmission} className="p-5 flex flex-col gap-3 text-xs">
                <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-bold text-slate-800 text-[12px] truncate">{admitPatient.name}</div>
                    <div className="text-[10px] text-slate-400 font-mono">{formatDateDDMMYYYY(admitPatient.birth_date)} · MRN {admitPatient.mrn ?? admitPatient.id}</div>
                  </div>
                  <button type="button" onClick={() => setAdmitPatient(null)} className="text-[10px] font-bold text-[var(--theme-accent)] cursor-pointer shrink-0">Change</button>
                </div>

                {admitError && <div className="bg-red-50 border border-red-100 text-red-600 text-[10px] font-semibold px-2.5 py-1.5 rounded">{admitError}</div>}

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Reason / Admitting Diagnosis</label>
                  <textarea
                    rows={2}
                    required
                    placeholder="e.g. Hip fracture rehabilitation, post-op care..."
                    value={admitForm.reason}
                    onChange={e => setAdmitForm({ ...admitForm, reason: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:bg-white focus:ring-1 focus:ring-teal-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Specialty / Service</label>
                    <input
                      type="text"
                      placeholder="e.g. Internal Medicine"
                      value={admitForm.specialty}
                      onChange={e => setAdmitForm({ ...admitForm, specialty: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:bg-white focus:ring-1 focus:ring-teal-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Attending Doctor</label>
                    <select
                      value={admitForm.attendingId}
                      onChange={e => setAdmitForm({ ...admitForm, attendingId: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:bg-white focus:ring-1 focus:ring-teal-500"
                    >
                      <option value="">Unassigned</option>
                      {admitDoctors.map((d: any) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Expected Discharge (optional)</label>
                  <input
                    type="text"
                    placeholder="dd/mm/yyyy"
                    maxLength={10}
                    value={admitForm.expectedDischarge}
                    onChange={e => { let v = e.target.value.replace(/[^\d]/g, "").slice(0, 8); if (v.length > 4) v = `${v.slice(0, 2)}/${v.slice(2, 4)}/${v.slice(4)}`; else if (v.length > 2) v = `${v.slice(0, 2)}/${v.slice(2)}`; setAdmitForm({ ...admitForm, expectedDischarge: v }); }}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:bg-white focus:ring-1 focus:ring-teal-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={admitSaving}
                  className="bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-dark)] disabled:opacity-60 text-white font-bold px-4 py-2 rounded-lg text-xs self-start cursor-pointer flex items-center gap-1.5"
                >
                  <UserCheck size={12} /> {admitSaving ? "Requesting..." : "Request Admission"}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* EDIT PATIENT PROFILE MODAL */}
      {isEditPatientModal && selectedPatient && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-[99999] overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl border w-full max-w-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 my-8">
            <div className="px-5 py-4 border-b bg-slate-50 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Edit3 className="h-4 w-4 text-indigo-600" />
                <span className="font-bold text-xs text-slate-800 uppercase tracking-wide">Edit Patient Profile — MRN {formatMRNDisplay(selectedPatient.mrn)}</span>
              </div>
              <button onClick={() => setIsEditPatientModal(false)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
            </div>
            <form onSubmit={handleSaveEditPatient} className="p-5 flex flex-col gap-3 text-xs max-h-[80vh] overflow-y-auto scrollbar-thin">
              <div className="grid grid-cols-3 gap-3">
                {([["first_name", "First Name"], ["father_name", "Father Name"], ["surname", "Surname"]] as [string, string][]).map(([k, label]) => (
                  <div key={k}>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">{label}</label>
                    <input type="text" required={k !== "father_name"} value={editForm[k] || ""} onChange={e => setEditForm({ ...editForm, [k]: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500" />
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Birth Date</label>
                  <input type="text" required placeholder="dd/mm/yyyy" maxLength={10} value={editForm.birth_date || ""} onChange={e => { let v = e.target.value.replace(/[^\d]/g, "").slice(0, 8); if (v.length > 4) v = `${v.slice(0, 2)}/${v.slice(2, 4)}/${v.slice(4)}`; else if (v.length > 2) v = `${v.slice(0, 2)}/${v.slice(2)}`; setEditForm({ ...editForm, birth_date: v }); }} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Gender</label>
                  <select value={editForm.gender || "Female"} onChange={e => setEditForm({ ...editForm, gender: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500">
                    <option value="Female">Female</option>
                    <option value="Male">Male</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {([["phone", "Contact Phone"], ["email", "Email Address"], ["mother_name", "Mother Name"], ["national_id", "National ID No."], ["nationality", "Nationality"], ["place_of_birth", "Place of Birth"]] as [string, string][]).map(([k, label]) => (
                  <div key={k}>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">{label}</label>
                    <input type="text" value={editForm[k] || ""} onChange={e => setEditForm({ ...editForm, [k]: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500" />
                  </div>
                ))}
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Home Address</label>
                <input type="text" value={editForm.address || ""} onChange={e => setEditForm({ ...editForm, address: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Marital Status</label>
                  <select value={editForm.marital_status || ""} onChange={e => setEditForm({ ...editForm, marital_status: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500">
                    <option value="">—</option>
                    <option value="Single">Single</option>
                    <option value="Married">Married</option>
                    <option value="Divorced">Divorced</option>
                    <option value="Widowed">Widowed</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Blood Type</label>
                  <select value={editForm.blood_type || ""} onChange={e => setEditForm({ ...editForm, blood_type: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500">
                    <option value="">Unknown</option>
                    {["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map(bt => <option key={bt} value={bt}>{bt}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Education</label>
                  <select value={editForm.education_level || ""} onChange={e => setEditForm({ ...editForm, education_level: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500">
                    <option value="">—</option>
                    {["None", "Primary", "Secondary", "University", "Postgraduate"].map(ed => <option key={ed} value={ed}>{ed}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Occupation</label>
                <input type="text" value={editForm.occupation || ""} onChange={e => setEditForm({ ...editForm, occupation: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                {([["emergency_contact_name", "Emergency Contact"], ["emergency_contact_relation", "Relationship"], ["emergency_contact_phone", "Emergency Phone"]] as [string, string][]).map(([k, label]) => (
                  <div key={k}>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">{label}</label>
                    <input type="text" value={editForm[k] || ""} onChange={e => setEditForm({ ...editForm, [k]: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500" />
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                {([["insurance_provider", "Insurance Provider"], ["insurance_number", "Insurance / Policy No."]] as [string, string][]).map(([k, label]) => (
                  <div key={k}>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">{label}</label>
                    <input type="text" value={editForm[k] || ""} onChange={e => setEditForm({ ...editForm, [k]: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500" />
                  </div>
                ))}
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Pathology / Chronic History Overview</label>
                <textarea rows={2} value={editForm.history || ""} onChange={e => setEditForm({ ...editForm, history: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500" />
              </div>
              <button type="submit" disabled={isEditSaving} className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-bold px-4 py-2 rounded-lg text-xs self-start cursor-pointer flex items-center gap-1.5">
                <Save size={12} /> {isEditSaving ? "Saving..." : "Save Changes"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* SCHEDULE APPOINTMENT MODAL */}
      {isScheduleModal && selectedPatient && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-[99999]">
          <div className="bg-white rounded-xl shadow-2xl border w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-5 py-4 border-b bg-slate-50 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-[var(--theme-accent)]" />
                <span className="font-bold text-xs text-slate-800 uppercase tracking-wide">Schedule Appointment</span>
              </div>
              <button onClick={() => setIsScheduleModal(false)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
            </div>
            <form onSubmit={handleSaveSchedule} className="p-5 flex flex-col gap-3 text-xs">
              <p className="text-[11px] text-slate-500 -mt-1">Booking for <strong className="text-slate-700">{selectedPatient.name}</strong> (MRN {formatMRNDisplay(selectedPatient.mrn)})</p>
              {schedError && <div className="bg-red-50 border border-red-100 text-red-600 text-[10px] font-semibold px-2.5 py-1.5 rounded">{schedError}</div>}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Date</label>
                  <input type="date" required value={schedForm.date} onChange={e => setSchedForm({ ...schedForm, date: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Time</label>
                  <input type="time" required value={schedForm.time} onChange={e => setSchedForm({ ...schedForm, time: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Duration (hours)</label>
                  <input type="number" min="1" max="8" required value={schedForm.duration} onChange={e => setSchedForm({ ...schedForm, duration: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Doctor</label>
                  <select value={schedForm.doctorId} onChange={e => setSchedForm({ ...schedForm, doctorId: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500">
                    <option value="">Unassigned</option>
                    {schedDoctors.map((d: any) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
                  </select>
                </div>
              </div>
              <button type="submit" disabled={schedSaving} className="bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-dark)] disabled:opacity-60 text-white font-bold px-4 py-2 rounded-lg text-xs self-start cursor-pointer flex items-center gap-1.5">
                <Calendar size={12} /> {schedSaving ? "Booking..." : "Book Appointment"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* FIND-OR-REGISTER MODAL: search first, so a duplicate chart can be
          opened instead of accidentally creating a second one. Adapted from
          SIMA's Admit Patient modal, minus the admission-request half. */}
      {isFindOrRegisterModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-[99999] overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl border w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150 my-8">
            <div className="px-5 py-4 border-b bg-slate-50 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <UserPlus className="h-4 w-4 text-[var(--theme-accent)]" />
                <span className="font-bold text-xs text-slate-800 uppercase tracking-wide">Find or Register Patient</span>
              </div>
              <button onClick={() => setIsFindOrRegisterModal(false)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
            </div>

            <div className="p-5 flex flex-col gap-3 text-xs">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search by name, MRN, or phone..."
                  value={findOrRegisterSearch}
                  onChange={e => setFindOrRegisterSearch(e.target.value)}
                  autoFocus
                  className="w-full pl-8.5 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-teal-500"
                />
              </div>
              <div className="max-h-56 overflow-y-auto divide-y divide-slate-100 border border-slate-100 rounded-lg">
                {(() => {
                  const q = findOrRegisterSearch.trim().toLowerCase();
                  const qDigits = q.replace(/\D/g, "").replace(/^0+/, "");
                  const matches = patients.filter(p => {
                    if (!q) return true;
                    if (nameMatchesQuery(p.name, q)) return true;
                    if (p.mrn !== undefined && String(p.mrn).includes(q)) return true;
                    if (qDigits && p.phone && p.phone.replace(/\D/g, "").replace(/^0+/, "").includes(qDigits)) return true;
                    return false;
                  }).slice(0, 8);
                  if (matches.length === 0) {
                    return <div className="p-4 text-center text-slate-400 text-[11px]">No matching patient.</div>;
                  }
                  return matches.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => { setSelectedPatient(p); setIsFindOrRegisterModal(false); }}
                      className="w-full text-left p-2.5 hover:bg-slate-50 flex items-center justify-between gap-2 cursor-pointer"
                    >
                      <span className="font-bold text-[11px] text-slate-700 truncate">{p.name}</span>
                      <span className="text-[10px] text-slate-400 font-mono shrink-0">{formatDateDDMMYYYY(p.birth_date)} · MRN {p.mrn ?? p.id}</span>
                    </button>
                  ));
                })()}
              </div>
              <button
                type="button"
                onClick={() => { setIsFindOrRegisterModal(false); setIsNewPatientModal(true); }}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-3 py-2 rounded-lg text-[11px] flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <UserPlus size={12} /> Register New Patient
              </button>
            </div>
          </div>
        </div>
      )}

      {/* REGISTRATION MODAL */}
      {isNewPatientModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-[99999] overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl border w-full max-w-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 my-8">
            <div className="px-5 py-4 border-b bg-slate-50 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <UserCheck className="h-4.5 w-4.5 text-indigo-600" />
                <span className="font-bold text-xs text-slate-800 uppercase tracking-wide">Register Outpatient Profile & Check-In</span>
              </div>
              <button onClick={() => setIsNewPatientModal(false)} className="text-slate-400 hover:text-slate-600">
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleCreatePatient} className="p-5 flex flex-col gap-4 text-xs max-h-[80vh] overflow-y-auto scrollbar-thin">
              
              {/* SECTION 1: DEMOGRAPHICS */}
              <div>
                <h3 className="font-bold text-indigo-700 uppercase text-[10px] tracking-wider mb-2 pb-1 border-b">1. Patient Personal & Contact Profile</h3>
                
                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">First Name</label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Malek"
                        value={newPatientFirstName}
                        onChange={e => setNewPatientFirstName(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Father Name</label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Ahmad"
                        value={newPatientFatherName}
                        onChange={e => setNewPatientFatherName(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Surname</label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Kaddoura"
                        value={newPatientSurname}
                        onChange={e => setNewPatientSurname(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                  </div>

                  {/* Live full-name preview (auto-capitalized) */}
                  {newPatientName && (
                    <div className="bg-indigo-50/60 border border-indigo-100 rounded-lg px-3 py-1.5 text-[11px]">
                      <span className="text-indigo-400 font-bold uppercase text-[9px] tracking-wider mr-2">Full Name</span>
                      <strong className="text-indigo-800">{newPatientName}</strong>
                    </div>
                  )}

                  {/* LIVE DUPLICATE CHECK: similar already-registered patients */}
                  {(() => {
                    const tokens = `${newPatientFirstName} ${newPatientFatherName} ${newPatientSurname}`
                      .toLowerCase().split(/\s+/).filter(t => t.length >= 3);
                    if (tokens.length === 0) return null;
                    const similar = patients.filter(p => {
                      const words = p.name.toLowerCase().split(/\s+/).filter(Boolean);
                      return tokens.some(t => words.some(w => tokenMatchesWord(t, w)));
                    }).slice(0, 5);
                    if (similar.length === 0) return null;
                    return (
                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                        <div className="text-[10px] font-bold text-amber-800 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                          <AlertCircle size={11} /> Similar patients already registered — check before saving
                        </div>
                        <div className="flex flex-col gap-1">
                          {similar.map(p => (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => { setIsNewPatientModal(false); setAdmitMode(false); setSelectedPatient(p); }}
                              className="text-left bg-white border border-amber-100 hover:border-amber-400 rounded px-2 py-1.5 text-[11px] flex items-center justify-between gap-2 cursor-pointer transition-colors"
                            >
                              <span className="font-bold text-slate-700 truncate">{p.name}</span>
                              <span className="text-[10px] text-slate-400 font-mono shrink-0">
                                {formatDateDDMMYYYY(p.birth_date)} · MRN {p.mrn ?? p.id}{p.phone ? ` · ${p.phone}` : ""}
                              </span>
                            </button>
                          ))}
                        </div>
                        <p className="text-[9px] text-amber-700 mt-1.5">If one of these is the same person, click it to open their chart instead of creating a duplicate.</p>
                      </div>
                    );
                  })()}

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Birth Date</label>
                      <input
                        type="text"
                        required
                        placeholder="dd/mm/yyyy"
                        maxLength={10}
                        value={newPatientDob}
                        onChange={e => {
                          let v = e.target.value.replace(/[^\d]/g, "").slice(0, 8);
                          if (v.length > 4) v = `${v.slice(0, 2)}/${v.slice(2, 4)}/${v.slice(4)}`;
                          else if (v.length > 2) v = `${v.slice(0, 2)}/${v.slice(2)}`;
                          setNewPatientDob(v);
                        }}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Gender</label>
                      <select 
                        value={newPatientGender}
                        onChange={e => setNewPatientGender(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500"
                      >
                        <option value="Female">Female</option>
                        <option value="Male">Male</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Mother Name</label>
                      <input
                        type="text"
                        placeholder="e.g. Fatima"
                        value={newPatientMotherName}
                        onChange={e => setNewPatientMotherName(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">National ID No.</label>
                      <input
                        type="text"
                        placeholder="e.g. 000123456789"
                        value={newPatientNationalId}
                        onChange={e => setNewPatientNationalId(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Nationality</label>
                      <input
                        type="text"
                        placeholder="e.g. Lebanese"
                        value={newPatientNationality}
                        onChange={e => setNewPatientNationality(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Place of Birth</label>
                      <input
                        type="text"
                        placeholder="e.g. Beirut"
                        value={newPatientPlaceOfBirth}
                        onChange={e => setNewPatientPlaceOfBirth(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Marital Status</label>
                      <select
                        value={newPatientMaritalStatus}
                        onChange={e => setNewPatientMaritalStatus(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500"
                      >
                        <option value="">—</option>
                        <option value="Single">Single</option>
                        <option value="Married">Married</option>
                        <option value="Divorced">Divorced</option>
                        <option value="Widowed">Widowed</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Blood Type</label>
                      <select
                        value={newPatientBloodType}
                        onChange={e => setNewPatientBloodType(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500"
                      >
                        <option value="">Unknown</option>
                        <option value="A+">A+</option>
                        <option value="A-">A-</option>
                        <option value="B+">B+</option>
                        <option value="B-">B-</option>
                        <option value="AB+">AB+</option>
                        <option value="AB-">AB-</option>
                        <option value="O+">O+</option>
                        <option value="O-">O-</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Education</label>
                      <select
                        value={newPatientEducation}
                        onChange={e => setNewPatientEducation(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500"
                      >
                        <option value="">—</option>
                        <option value="None">None</option>
                        <option value="Primary">Primary</option>
                        <option value="Secondary">Secondary</option>
                        <option value="University">University</option>
                        <option value="Postgraduate">Postgraduate</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Occupation</label>
                    <input
                      type="text"
                      placeholder="e.g. Teacher"
                      value={newPatientOccupation}
                      onChange={e => setNewPatientOccupation(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Contact Phone</label>
                      <input 
                        type="text" 
                        placeholder="e.g. +1 (555) 012-3456"
                        value={newPatientPhone}
                        onChange={e => setNewPatientPhone(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Email Address</label>
                      <input 
                        type="email" 
                        placeholder="e.g. j.harris@example.com"
                        value={newPatientEmail}
                        onChange={e => setNewPatientEmail(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Home Address</label>
                    <input 
                      type="text" 
                      placeholder="e.g. 123 Health Ave, Suite 4B, Boston, MA"
                      value={newPatientAddress}
                      onChange={e => setNewPatientAddress(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Emergency Contact</label>
                      <input
                        type="text"
                        placeholder="e.g. Hala Kaddoura"
                        value={newPatientEmergencyName}
                        onChange={e => setNewPatientEmergencyName(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Relationship</label>
                      <input
                        type="text"
                        placeholder="e.g. Spouse"
                        value={newPatientEmergencyRelation}
                        onChange={e => setNewPatientEmergencyRelation(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Emergency Phone</label>
                      <input
                        type="text"
                        placeholder="e.g. 03 123 456"
                        value={newPatientEmergencyPhone}
                        onChange={e => setNewPatientEmergencyPhone(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Insurance Provider</label>
                      <input
                        type="text"
                        placeholder="e.g. NSSF / Allianz"
                        value={newPatientInsuranceProvider}
                        onChange={e => setNewPatientInsuranceProvider(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Insurance / Policy No.</label>
                      <input
                        type="text"
                        placeholder="e.g. POL-2026-00123"
                        value={newPatientInsuranceNumber}
                        onChange={e => setNewPatientInsuranceNumber(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Pathology / Chronic History Overview</label>
                    <textarea 
                      rows={2}
                      placeholder="Note allergies, medication list, surgeries, or chronic diagnosis history..."
                      value={newPatientHistory}
                      onChange={e => setNewPatientHistory(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                </div>
              </div>

              {/* SECTION 2: CLINICAL VITALS AND ENCOUNTER NOTES */}
              <div className="bg-slate-50 border rounded-xl p-3.5 mt-1">
                <div className="flex items-center gap-1.5 mb-2.5">
                  <Activity size={14} className="text-emerald-600" />
                  <h3 className="font-bold text-emerald-700 uppercase text-[10px] tracking-wider">
                    2. Check-In Vitals & Clinical Visit Note (Optional)
                  </h3>
                </div>
                <p className="text-[10px] text-slate-500 mb-3">
                  These fields are **completely manual** and will NOT be auto-filled with test data. If filled out, an initial visit note record is generated and stored in Supabase.
                </p>

                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1">Blood Pressure (BP)</label>
                      <input 
                        type="text" 
                        placeholder="e.g. 120/80"
                        value={newPatientBp}
                        onChange={e => setNewPatientBp(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1">Heart Rate (HR)</label>
                      <input 
                        type="text" 
                        placeholder="e.g. 72"
                        value={newPatientHr}
                        onChange={e => setNewPatientHr(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1">Primary Diagnosis Code (ICD)</label>
                      <input 
                        type="text" 
                        placeholder="e.g. I10 (Essential Hypertension)"
                        value={newPatientInitialDx}
                        onChange={e => setNewPatientInitialDx(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1">Follow-up Schedule</label>
                      <input 
                        type="text" 
                        placeholder="e.g. 2 weeks"
                        value={newPatientInitialFollowUp}
                        onChange={e => setNewPatientInitialFollowUp(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1">Encounter Clinical Notes / Chief Complaint</label>
                    <textarea 
                      rows={2}
                      placeholder="Type patient's reasons for check-in and initial evaluation details..."
                      value={newPatientInitialNote}
                      onChange={e => setNewPatientInitialNote(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-3 border-t border-slate-200/60 pt-2">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1">Height (cm)</label>
                      <input 
                        type="number" 
                        step="0.1"
                        placeholder="e.g. 175"
                        value={newPatientHeight}
                        onChange={e => setNewPatientHeight(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1">Weight (kg)</label>
                      <input 
                        type="number" 
                        step="0.1"
                        placeholder="e.g. 70"
                        value={newPatientWeight}
                        onChange={e => setNewPatientWeight(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1">BMI (Calculated)</label>
                      <div className="w-full bg-slate-100 border border-slate-200 rounded-lg p-2 font-mono font-bold text-slate-700 h-[34px] flex items-center justify-center text-xs">
                        {(() => {
                          const h = parseFloat(newPatientHeight);
                          const w = parseFloat(newPatientWeight);
                          if (h > 0 && w > 0) {
                            const bmi = w / ((h / 100) * (h / 100));
                            return bmi.toFixed(1);
                          }
                          return "--";
                        })()}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex gap-2.5 pt-2 justify-end border-t">
                <button 
                  type="button" 
                  onClick={() => setIsNewPatientModal(false)}
                  className="px-4 py-2 border rounded-lg text-slate-500 font-bold bg-white hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={saveLoading}
                  className="px-4 py-2 bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-dark)] text-white font-bold rounded-lg cursor-pointer flex items-center gap-1 shadow-md shadow-[var(--theme-accent)]/10 border border-[var(--theme-accent)]/20"
                >
                  {saveLoading ? "Registering..." : "Save Patient Profile"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PHYSICAL METRICS & VITALS HISTORY MODAL */}
      {isVitalsModalOpen && selectedPatient && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-[99999] overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl border w-full max-w-3xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 my-8 text-slate-700">
            <div className="px-5 py-4 border-b bg-slate-50 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-[var(--theme-accent)]" />
                <div>
                  <h2 className="font-extrabold text-xs text-slate-800 uppercase tracking-wider">Physical Metrics & Vitals History</h2>
                  <p className="text-[10px] text-slate-500 font-sans mt-0.5">Patient: <strong className="text-slate-800">{selectedPatient.name}</strong></p>
                </div>
              </div>
              <button 
                onClick={() => setIsVitalsModalOpen(false)} 
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 grid grid-cols-1 md:grid-cols-12 gap-5 max-h-[75vh] overflow-y-auto scrollbar-thin">
              {/* LEFT COLUMN: Record New Vitals (5 cols) */}
              <div className="md:col-span-5 flex flex-col gap-4 border-r md:pr-5">
                <h3 className="font-bold text-[#2a5178] uppercase text-[10px] tracking-wider pb-1 border-b">
                  Record New Metrics
                </h3>

                <form 
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSaveVitals(vitalsHeightInput, vitalsWeightInput, vitalsBpInput, vitalsHrInput);
                  }}
                  className="flex flex-col gap-3 text-xs"
                >
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Height (cm)</label>
                    <input 
                      type="number" 
                      step="0.1"
                      required
                      placeholder="e.g. 175"
                      value={vitalsHeightInput}
                      onChange={e => setVitalsHeightInput(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:bg-white focus:ring-1 focus:ring-[var(--theme-accent)]"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Weight (kg)</label>
                    <input 
                      type="number" 
                      step="0.1"
                      required
                      placeholder="e.g. 70"
                      value={vitalsWeightInput}
                      onChange={e => setVitalsWeightInput(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:bg-white focus:ring-1 focus:ring-[var(--theme-accent)]"
                    />
                  </div>

                  <div className="bg-[#2a5178]/5 border border-[#c2d5e7] rounded-lg p-3 flex justify-between items-center">
                    <div>
                      <span className="text-[9px] font-bold text-[#2a5178] uppercase tracking-wider block">Body Mass Index (BMI)</span>
                      <strong className="text-xl text-slate-800 font-mono">
                        {(() => {
                          const bmiData = calculateBMI(vitalsHeightInput, vitalsWeightInput);
                          return bmiData.bmi || "--";
                        })()}
                      </strong>
                    </div>
                    {(() => {
                      const bmiData = calculateBMI(vitalsHeightInput, vitalsWeightInput);
                      if (bmiData.bmi) {
                        return (
                          <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full bg-white border border-[#c2d5e7] ${bmiData.color}`}>
                            {bmiData.category}
                          </span>
                        );
                      }
                      return null;
                    })()}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Blood Pressure (BP)</label>
                      <input 
                        type="text" 
                        placeholder="e.g. 120/80"
                        value={vitalsBpInput}
                        onChange={e => setVitalsBpInput(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:bg-white focus:ring-1 focus:ring-[var(--theme-accent)]"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Heart Rate (HR)</label>
                      <input 
                        type="text" 
                        placeholder="e.g. 72"
                        value={vitalsHrInput}
                        onChange={e => setVitalsHrInput(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:bg-white focus:ring-1 focus:ring-[var(--theme-accent)]"
                      />
                    </div>
                  </div>

                  <button 
                    type="submit" 
                    className="w-full mt-2 bg-[#2a5178] hover:bg-[#2a5178] text-white font-bold py-2 rounded-lg cursor-pointer transition-colors shadow-sm text-xs"
                  >
                    Record & Save Entry
                  </button>
                </form>
              </div>

              {/* RIGHT COLUMN: Chronological Log / History List (7 cols) */}
              <div className="md:col-span-7 flex flex-col gap-3">
                <h3 className="font-bold text-slate-800 uppercase text-[10px] tracking-wider pb-1 border-b flex justify-between items-center">
                  <span>Previous Vitals Logged ({patientVitals.length})</span>
                  <span className="text-[9px] text-slate-400 font-sans normal-case">Latest entries first</span>
                </h3>

                {patientVitals.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-slate-400 gap-2 border border-dashed rounded-lg bg-slate-50">
                    <Activity size={24} className="text-slate-300 animate-pulse" />
                    <p className="text-[11px]">No physical metrics or vitals logged yet for this patient.</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2.5 max-h-[60vh] overflow-y-auto pr-1">
                    {patientVitals.map((vital: any) => {
                      const bmiInfo = calculateBMI(vital.height, vital.weight);
                      return (
                        <div 
                          key={vital.id}
                          className={`border rounded-lg p-3 bg-slate-50/50 flex flex-col gap-2 relative group hover:border-[#c2d5e7] transition-all ${
                            vital.is_local_fallback ? "border-amber-200 bg-amber-50/20" : "border-slate-100"
                          }`}
                        >
                          {vital.is_local_fallback && (
                            <span className="absolute top-2 right-10 text-[7px] bg-amber-100 text-amber-800 px-1 py-0.2 rounded font-bold uppercase tracking-wider">
                              Session Local Record
                            </span>
                          )}

                          <button
                            onClick={() => handleDeleteVitals(vital.id)}
                            className="absolute top-2.5 right-2.5 text-slate-400 hover:text-red-500 cursor-pointer p-1 rounded-md hover:bg-slate-100 transition-colors"
                            title="Delete this record"
                          >
                            <Trash2 size={13} />
                          </button>

                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[9px] font-bold text-slate-400">
                              {new Date(vital.created_at).toLocaleString("en-GB")}
                            </span>
                          </div>

                          <div className="grid grid-cols-3 gap-2 text-xs">
                            <div className="bg-white p-1.5 rounded border border-slate-100">
                              <span className="block text-[8px] font-bold text-slate-400 uppercase">Height</span>
                              <strong className="text-slate-700 font-mono text-[11px]">{vital.height} cm</strong>
                            </div>
                            <div className="bg-white p-1.5 rounded border border-slate-100">
                              <span className="block text-[8px] font-bold text-slate-400 uppercase">Weight</span>
                              <strong className="text-slate-700 font-mono text-[11px]">{vital.weight} kg</strong>
                            </div>
                            <div className="bg-white p-1.5 rounded border border-slate-100">
                              <span className="block text-[8px] font-bold text-slate-400 uppercase">BMI</span>
                              <strong className={`font-mono text-[11px] flex flex-col leading-tight ${bmiInfo.color}`}>
                                {bmiInfo.bmi}
                                <span className="text-[7px] font-sans font-bold uppercase tracking-tight">{bmiInfo.category}</span>
                              </strong>
                            </div>
                          </div>

                          {(vital.blood_pressure || vital.heart_rate) && (
                            <div className="bg-slate-100/60 rounded px-2 py-1 text-[9px] text-slate-500 flex gap-4 font-mono">
                              {vital.blood_pressure && (
                                <span>Blood Pressure: <strong className="text-slate-700">{vital.blood_pressure}</strong></span>
                              )}
                              {vital.heart_rate && (
                                <span>Heart Rate: <strong className="text-slate-700">{vital.heart_rate} bpm</strong></span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="px-5 py-3 border-t bg-slate-50 flex justify-end">
              <button 
                onClick={() => setIsVitalsModalOpen(false)} 
                className="px-4 py-2 bg-slate-800 text-white font-bold rounded-lg hover:bg-slate-700 cursor-pointer text-xs transition-colors"
              >
                Close Window
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DYNAMIC DIAGNOSIS REGISTRY MODAL */}
      {isDxModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-[99999]">
          <div className="bg-white rounded-xl shadow-2xl border w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150 text-slate-700">
            <div className="px-4 py-3 bg-[#edf3f8] border-b border-[#c2d5e7] flex justify-between items-center">
              <div className="flex items-center gap-2">
                <PlusCircle className="h-4.5 w-4.5 text-[var(--theme-accent)]" />
                <span className="font-extrabold text-[11px] text-[#2a5178] uppercase tracking-wider">ICD-10 Diagnosis Registry</span>
              </div>
              <button 
                type="button"
                onClick={() => setIsDxModalOpen(false)} 
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-4 flex flex-col gap-4 text-xs">
              <div className="bg-slate-50 border p-2.5 rounded-lg">
                <span className="font-bold text-[10px] text-slate-400 uppercase tracking-wider block mb-1">Select Quick Diagnostics</span>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { code: "F41.1", name: "Generalized Anxiety Disorder" },
                    { code: "E11.9", name: "Type 2 Diabetes Mellitus" },
                    { code: "I10", name: "Essential Hypertension" },
                    { code: "E03.9", name: "Hypothyroidism, Unspecified" }
                  ].map((preset, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        setNewDxCode(preset.code);
                        setNewDxName(preset.name);
                      }}
                      className="bg-white hover:bg-teal-50 border border-slate-200 hover:border-[#c2d5e7] px-2 py-1 rounded text-[10px] font-semibold text-slate-700 transition-colors cursor-pointer"
                    >
                      {preset.code} - {preset.name.substring(0, 15)}...
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-1">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">ICD-10 Code</label>
                  <input 
                    type="text" 
                    placeholder="e.g. F41.1"
                    value={newDxCode}
                    onChange={e => setNewDxCode(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:bg-white text-xs font-mono font-bold"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Diagnostic Term Description</label>
                  <input 
                    type="text" 
                    placeholder="e.g. Generalized Anxiety Disorder"
                    value={newDxName}
                    onChange={e => setNewDxName(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:bg-white text-xs"
                  />
                </div>
              </div>

              <div className="flex gap-2 justify-end pt-2 border-t">
                <button 
                  type="button" 
                  onClick={() => setIsDxModalOpen(false)}
                  className="px-3.5 py-1.5 border rounded-lg text-slate-500 font-bold bg-white hover:bg-slate-50 cursor-pointer"
                >
                  Close
                </button>
                <button 
                  type="button" 
                  onClick={() => {
                    if (!newDxCode || !newDxName) {
                      alert("Please fill in both the diagnostic code and description description");
                      return;
                    }
                    setActiveDiagnoses(prev => [...prev, { code: newDxCode.toUpperCase().trim(), name: newDxName.trim() }]);
                    triggerToast(`Added Diagnosis: ${newDxCode.toUpperCase()}`);
                    setNewDxCode("");
                    setNewDxName("");
                  }}
                  className="px-4 py-1.5 bg-[#2a5178] hover:bg-[var(--theme-accent-dark)] text-white font-bold rounded-lg cursor-pointer shadow-sm"
                >
                  Add Diagnosis
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DYNAMIC CLINICAL ORDER PLACEMENT MODAL */}
      {isOrderModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-[99999]">
          <div className="bg-white rounded-xl shadow-2xl border w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150 text-slate-700">
            <div className="px-4 py-3 bg-slate-50 border-b flex justify-between items-center">
              <div className="flex items-center gap-2">
                <ClipboardList className="h-4.5 w-4.5 text-indigo-600" />
                <span className="font-extrabold text-[11px] text-slate-800 uppercase tracking-wider">Clinical Orders Hub</span>
              </div>
              <button 
                type="button"
                onClick={() => setIsOrderModalOpen(false)} 
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-4 flex flex-col gap-4 text-xs">
              <div className="bg-slate-50 border p-2.5 rounded-lg">
                <span className="font-bold text-[10px] text-slate-400 uppercase tracking-wider block mb-1">Standard Labs & Prescriptions</span>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { type: "Lab Order", name: "Lipid Panel Serum" },
                    { type: "Lab Order", name: "Hemoglobin A1c" },
                    { type: "Prescription", name: "Metformin 500mg BID" },
                    { type: "Imaging Scan", name: "Thyroid Ultrasound" }
                  ].map((preset, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        setNewOrderType(preset.type as any);
                        setNewOrderName(preset.name);
                      }}
                      className="bg-white hover:bg-indigo-50 border border-slate-200 hover:border-indigo-200 px-2.5 py-1 rounded text-[10px] font-semibold text-slate-700 transition-colors cursor-pointer"
                    >
                      {preset.type}: {preset.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-1">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Order Type</label>
                  <select 
                    value={newOrderType}
                    onChange={e => setNewOrderType(e.target.value as any)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:bg-white text-xs font-semibold"
                  >
                    <option value="Lab Order">Lab Order</option>
                    <option value="Prescription">Prescription</option>
                    <option value="Imaging Scan">Imaging Scan</option>
                    <option value="Referral">Referral</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Order Name / Instruction</label>
                  <input 
                    type="text" 
                    placeholder="e.g. Lipid Panel, Metformin..."
                    value={newOrderName}
                    onChange={e => setNewOrderName(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 focus:outline-none focus:bg-white text-xs"
                  />
                </div>
              </div>

              <div className="flex gap-2 justify-end pt-2 border-t">
                <button 
                  type="button" 
                  onClick={() => setIsOrderModalOpen(false)}
                  className="px-3.5 py-1.5 border rounded-lg text-slate-500 font-bold bg-white hover:bg-slate-50 cursor-pointer"
                >
                  Close
                </button>
                <button 
                  type="button" 
                  onClick={() => {
                    if (!newOrderName) {
                      alert("Please type in an order description name");
                      return;
                    }
                    setActiveOrders(prev => [...prev, { type: newOrderType, name: newOrderName.trim() }]);
                    triggerToast(`Placed Order: ${newOrderName}`);
                    setNewOrderName("");
                  }}
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg cursor-pointer shadow-sm"
                >
                  Add Order
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* EXIT & AFTER VISIT SUMMARY (AVS) MODAL */}
      {isAvsModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-[99999]">
          <div className="bg-white rounded-xl shadow-2xl border w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 text-slate-700 max-h-[90vh] flex flex-col">
            
            {/* Header */}
            <div className="px-5 py-3.5 bg-[var(--theme-accent-dark)] text-white border-b flex justify-between items-center shrink-0">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-[var(--theme-accent-bg)]" />
                <span className="font-black text-xs uppercase tracking-widest">Encounter Close & After Visit Summary (AVS)</span>
              </div>
              <button 
                type="button"
                onClick={() => setIsAvsModalOpen(false)} 
                className="text-white/80 hover:text-white cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Content Body (Print high-contrast styling) */}
            <div className="p-6 flex-1 overflow-y-auto flex flex-col gap-5 text-slate-800">
              
              {/* Patient AVS Banner */}
              <div className="border-4 border-slate-900 p-4 font-sans bg-white flex flex-col gap-3">
                <div className="flex justify-between items-start border-b-2 border-slate-900 pb-2 flex-wrap gap-2">
                  <div>
                    <h2 className="text-xl font-black uppercase tracking-tight text-slate-900">After Visit Summary (AVS)</h2>
                    <span className="text-[10px] text-slate-500 font-mono font-bold uppercase tracking-wider block mt-1">EMR Document Code: EMR-{formatMRNDisplay(selectedPatient.mrn)}</span>
                  </div>
                  <div className="text-right text-[10px] font-semibold text-slate-600">
                    <p>Date: {new Date().toLocaleDateString("en-GB")}</p>
                    <p>Provider: {currentUser?.name || "Unassigned Provider"}</p>
                    <p>Dept: Outpatient Care Unit</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div>
                    <span className="text-slate-400 font-bold uppercase text-[8px] block tracking-wide">Patient Name</span>
                    <strong className="text-slate-900 text-sm">{selectedPatient.name}</strong>
                    <span className="block text-slate-500 mt-1">DOB: {formatDateDDMMYYYY(selectedPatient.birth_date)} ({calculateAge(selectedPatient.birth_date)} y.o.)</span>
                  </div>
                  <div>
                    <span className="text-slate-400 font-bold uppercase text-[8px] block tracking-wide">Physical metrics</span>
                    {(() => {
                      const latestVital = patientVitals && patientVitals.length > 0 ? patientVitals[0] : null;
                      const w = latestVital?.weight;
                      const h = latestVital?.height;
                      const bmi = w && h ? (w / ((h / 100) * (h / 100))).toFixed(1) : null;
                      if (!latestVital || (!w && !h)) {
                        return <strong className="text-slate-400 text-xs block italic">No vitals logged yet</strong>;
                      }
                      return (
                        <strong className="text-slate-900 text-xs block">
                          {w ? `Weight: ${w} kg` : "Weight: --"} {bmi ? `• BMI: ${bmi}` : ""}
                        </strong>
                      );
                    })()}
                  </div>
                </div>

                {/* ACTIVE DIAGNOSES LIST */}
                <div className="border-t border-slate-200 pt-3">
                  <span className="font-extrabold text-[10px] text-slate-900 uppercase tracking-wider block mb-2">Diagnoses Managed This Encounter:</span>
                  {activeDiagnoses.length === 0 ? (
                    <p className="text-slate-400 italic text-[11px]">No acute diagnoses entered this session.</p>
                  ) : (
                    <ul className="list-disc pl-5 text-[11px] flex flex-col gap-1 text-slate-700">
                      {activeDiagnoses.map((dx, idx) => (
                        <li key={idx}>
                          <strong className="text-slate-900">{dx.code}</strong> &mdash; {dx.name}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* ORDERS ISSUED */}
                <div className="border-t border-slate-200 pt-3">
                  <span className="font-extrabold text-[10px] text-slate-900 uppercase tracking-wider block mb-2">Prescriptions & Lab Orders Issued:</span>
                  {activeOrders.length === 0 ? (
                    <p className="text-slate-400 italic text-[11px]">No clinical laboratory scans or prescriptions ordered during this encounter.</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      {activeOrders.map((ord, idx) => (
                        <div key={idx} className="bg-slate-50 border p-2 rounded text-[11px]">
                          <strong className="text-indigo-800 uppercase text-[9px] block font-mono">{ord.type}</strong>
                          <span className="font-bold text-slate-800">{ord.name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Patient Addendum Signature Row */}
              <div className="bg-[#edf3f8] border border-[#c2d5e7] p-4 rounded-lg flex flex-col gap-3">
                <div>
                  <h4 className="font-bold text-[#2a5178] text-xs mb-1">Add Clinical Encounter Addendum</h4>
                  <p className="text-[10px] text-slate-500">Record any last-minute amendments or notes prior to discharging patient.</p>
                </div>
                
                <textarea
                  rows={2}
                  placeholder="Type any amendments or supplementary notes here..."
                  value={addendumText}
                  onChange={e => setAddendumText(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)]"
                />

                <div className="flex items-center gap-2">
                  <input 
                    type="checkbox" 
                    id="sign-addendum-check"
                    checked={isAddendumSigned}
                    onChange={e => setIsAddendumSigned(e.target.checked)}
                    className="rounded text-[var(--theme-accent)] focus:ring-[var(--theme-accent)] h-3.5 w-3.5 cursor-pointer"
                  />
                  <label htmlFor="sign-addendum-check" className="font-bold text-[10.5px] text-slate-700 cursor-pointer">
                    Digitally sign and cosign this clinical addendum under electronic protocol
                  </label>
                </div>
              </div>

            </div>

            {/* Footer buttons */}
            <div className="p-4 bg-slate-50 border-t flex justify-between items-center shrink-0">
              <span className="text-[10px] text-slate-400 font-mono font-bold">EMR SYSTEM V4.2</span>
              
              <div className="flex gap-2">
                <button 
                  type="button" 
                  onClick={() => setIsAvsModalOpen(false)}
                  className="px-4 py-2 border rounded-lg text-slate-500 font-bold bg-white hover:bg-slate-50 cursor-pointer text-xs"
                >
                  Close Window
                </button>
                <button 
                  type="button" 
                  onClick={() => {
                    triggerToast("AVS Summary Document sent to printer!");
                    setIsAvsModalOpen(false);
                  }}
                  className="px-4 py-2 bg-slate-900 hover:bg-black text-white font-bold rounded-lg cursor-pointer text-xs flex items-center gap-1 shadow-md"
                >
                  <Printer size={12} /> Print EMR AVS Document
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* CLINICAL TOAST NOTIFICATION POPUP */}
      {showToast && (
        <div className="fixed bottom-4 right-4 bg-slate-900 text-white px-4 py-3 rounded-lg shadow-2xl flex items-center gap-2 text-xs border border-slate-700 z-[99999] animate-in slide-in-from-bottom-2 duration-200">
          <div className="h-2 w-2 rounded-full bg-teal-400 animate-ping" />
          <span className="font-bold">{showToast}</span>
        </div>
      )}
    </div>
  );
}
