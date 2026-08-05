import React, { createContext, useContext, useState, useEffect, useRef } from "react";
import {
  FileText, X, Minus, Maximize2, Check, CloudLightning,
  History, Eye, Save, AlertCircle, Sparkles, Copy, Trash2,
  Users, Layers, ArrowUpRight, ClipboardList, Info, Loader2, ArrowRight,
  Mic, MicOff
} from "lucide-react";
import { supabase } from "../supabaseClient";

// Type definitions
export interface VisitNote {
  id: string; // Real DB id (bigint or uuid string) or fallback local temp id
  appointment_id?: string | null;
  patient_mrn?: string | number | null;
  patient_id?: string | null;
  patient_name: string;
  doctor_name: string;
  content: string;
  note_content?: string;
  blood_pressure?: string;
  heart_rate?: string;
  diagnosis?: string;
  follow_up_date?: string;
  template_id?: string | null;
  updated_at?: string;
  is_local_fallback?: boolean;
  note_data?: any;
  visit_date?: string;
  created_by?: string | null;
}

export interface NoteTemplate {
  id: string;
  title: string;
  category: string;
  content: string;
}

export interface ActiveWindow {
  windowId: string; // Unique session window identifier
  noteId: string | null; // Database note id (null if new draft)
  patientId?: string | null;
  patientName: string;
  patientAge?: string | null;
  patientMrn?: string | null;
  appointmentId: string | null;
  doctorName: string;
  content: string;
  bloodPressure: string;
  heartRate: string;
  diagnosis: string;
  followUpDate: string;
  templateId: string | null;
  position: { x: number; y: number };
  isMinimized: boolean;
  zIndex: number;
  lastSaved: string | null;
  isDirty: boolean;
  isSaving: boolean;
  noteData?: any;
}

interface VisitNotesContextType {
  activeWindows: ActiveWindow[];
  templates: NoteTemplate[];
  openNoteWindow: (patientName: string, appointmentId?: string | null, doctorName?: string, patientId?: string | null) => void;
  closeNoteWindow: (windowId: string) => void;
  minimizeNoteWindow: (windowId: string) => void;
  maximizeNoteWindow: (windowId: string) => void;
  updateWindowContent: (windowId: string, fields: Partial<ActiveWindow>) => void;
  saveActiveNote: (windowId: string) => Promise<void>;
  focusWindow: (windowId: string) => void;
  syncNoteFromRealtime: (note: VisitNote) => void;
  templatesLoading: boolean;
}

const VisitNotesContext = createContext<VisitNotesContextType | undefined>(undefined);

// Default templates to seed or fallback on
const FALLBACK_TEMPLATES: NoteTemplate[] = [
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

export function VisitNotesProvider({ children }: { children: React.ReactNode }) {
  const [activeWindows, setActiveWindows] = useState<ActiveWindow[]>([]);
  const [templates, setTemplates] = useState<NoteTemplate[]>(FALLBACK_TEMPLATES);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [maxZIndex, setMaxZIndex] = useState(10);

  // Fetch Templates
  useEffect(() => {
    async function fetchTemplates() {
      setTemplatesLoading(true);
      try {
        const { data, error } = await supabase.from("note_templates").select("*").order("title");
        if (error) throw error;
        if (data && data.length > 0) {
          setTemplates(data);
        }
      } catch (err) {
        console.warn("Could not load note templates from database. Using presets.", err);
      } finally {
        setTemplatesLoading(false);
      }
    }
    fetchTemplates();
  }, []);

  // Set up Supabase Realtime Subscription for notes
  useEffect(() => {
    const channel = supabase
      .channel("public:visit_notes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "visit_notes" },
        (payload) => {
          const updatedNote = payload.new as VisitNote;
          if (updatedNote) {
            syncNoteFromRealtime(updatedNote);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Update a window if an external client modified the note via Supabase
  const syncNoteFromRealtime = (note: VisitNote) => {
    setActiveWindows((prev) =>
      prev.map((win) => {
        // If the window is editing this specific note, update its content unless it has unsaved local changes
        if (win.noteId === note.id && !win.isDirty) {
          return {
            ...win,
            content: note.content || "",
            bloodPressure: note.blood_pressure || "",
            heartRate: note.heart_rate || "",
            diagnosis: note.diagnosis || "",
            followUpDate: note.follow_up_date || "",
            templateId: note.template_id || null,
            noteData: note.note_data || null,
            lastSaved: note.updated_at ? new Date(note.updated_at).toLocaleTimeString() : win.lastSaved,
          };
        }
        return win;
      })
    );
  };

  const focusWindow = (windowId: string) => {
    setMaxZIndex((prev) => {
      const nextZ = prev + 1;
      setActiveWindows((windows) =>
        windows.map((win) => (win.windowId === windowId ? { ...win, zIndex: nextZ, isMinimized: false } : win))
      );
      return nextZ;
    });
  };

  const openNoteWindow = async (patientName: string, appointmentId?: string | null, doctorName?: string, patientId?: string | null) => {
    const formattedDoctor = doctorName || "Unassigned Provider";
    const apptId = appointmentId || null;

    // Check if we already have a window open for this patient/appointment to avoid duplicate windows
    const existing = activeWindows.find(
      (win) => win.patientName === patientName && (apptId ? win.appointmentId === apptId : true)
    );

    if (existing) {
      focusWindow(existing.windowId);
      return;
    }

    let patientAge = "N/A";
    let patientMrnVal = patientId || "N/A";

    try {
      const { data: pData } = await supabase
        .from("patients")
        .select("*");
      
      if (pData) {
        const matched = pData.find((p: any) => {
          const mId = String(p.id || p.mrn || "");
          const mName = p.name || `${p.first_name || ""} ${p.surname || ""}`.trim();
          return (patientId && mId === String(patientId)) || (mName.toLowerCase() === patientName.toLowerCase());
        });

        if (matched) {
          const dob = matched.birth_date || matched.date_of_birth;
          if (dob) {
            const today = new Date();
            const birthDate = new Date(dob);
            let age = today.getFullYear() - birthDate.getFullYear();
            const m = today.getMonth() - birthDate.getMonth();
            if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
              age--;
            }
            patientAge = String(age);
          }
          const rawMrn = matched.mrn || matched.id;
          if (rawMrn) {
            patientMrnVal = String(rawMrn).padStart(6, "0");
          }
        }
      }
    } catch (err) {
      console.warn("Failed to fetch matching patient info for template auto-fill", err);
    }

    const windowId = `win-${Date.now()}`;
    const initialPosition = {
      x: 80 + (activeWindows.length * 25) % 200,
      y: 100 + (activeWindows.length * 25) % 200,
    };

    // Construct preliminary window
    const newWindow: ActiveWindow = {
      windowId,
      noteId: null, // will be loaded or created upon saving
      patientId: patientId || null,
      patientName,
      patientAge,
      patientMrn: patientMrnVal,
      appointmentId: apptId,
      doctorName: formattedDoctor,
      content: "",
      bloodPressure: "",
      heartRate: "",
      diagnosis: "",
      followUpDate: "",
      templateId: null,
      position: initialPosition,
      isMinimized: false,
      zIndex: maxZIndex + 1,
      lastSaved: null,
      isDirty: false,
      isSaving: false,
    };

    setMaxZIndex((prev) => prev + 1);
    setActiveWindows((prev) => [...prev, newWindow]);

    // Attempt to load existing note from Database for this patient/appointment
    try {
      let data: any[] | null = null;
      let error: any = null;

      if (apptId) {
        const { data: apptData, error: apptErr } = await supabase
          .from("visit_notes")
          .select("*")
          .eq("appointment_id", apptId);
        data = apptData;
        error = apptErr;
      } else if (patientId) {
        const { data: mrnData, error: mrnErr } = await supabase
          .from("visit_notes")
          .select("*")
          .eq("patient_id", patientId)
          .order("created_at", { ascending: false })
          .limit(1);
        data = mrnData;
        error = mrnErr;
      }

      if (error) throw error;

      if (data && data.length > 0) {
        const dbNote = data[0] as VisitNote;
        setActiveWindows((prev) =>
          prev.map((win) =>
            win.windowId === windowId
              ? {
                  ...win,
                  noteId: dbNote.id,
                  content: dbNote.content || "",
                  bloodPressure: dbNote.blood_pressure || "",
                  heartRate: dbNote.heart_rate || "",
                  diagnosis: dbNote.diagnosis || "",
                  followUpDate: dbNote.follow_up_date || "",
                  templateId: dbNote.template_id || null,
                  noteData: dbNote.note_data || null,
                  lastSaved: dbNote.updated_at ? new Date(dbNote.updated_at).toLocaleTimeString() : "Loaded from DB",
                }
              : win
          )
        );
      }
    } catch (err) {
      console.warn("Could not find previous note in DB, initialized as fresh draft:", err);
    }
  };

  const closeNoteWindow = (windowId: string) => {
    setActiveWindows((prev) => prev.filter((win) => win.windowId !== windowId));
  };

  const minimizeNoteWindow = (windowId: string) => {
    setActiveWindows((prev) =>
      prev.map((win) => (win.windowId === windowId ? { ...win, isMinimized: true } : win))
    );
  };

  const maximizeNoteWindow = (windowId: string) => {
    setActiveWindows((prev) =>
      prev.map((win) => (win.windowId === windowId ? { ...win, isMinimized: false } : win))
    );
    focusWindow(windowId);
  };

  const updateWindowContent = (windowId: string, fields: Partial<ActiveWindow>) => {
    setActiveWindows((prev) =>
      prev.map((win) => (win.windowId === windowId ? { ...win, ...fields, isDirty: true } : win))
    );
  };

  const saveActiveNote = async (windowId: string) => {
    const win = activeWindows.find((w) => w.windowId === windowId);
    if (!win) return;

    // Set saving spinner
    setActiveWindows((prev) =>
      prev.map((w) => (w.windowId === windowId ? { ...w, isSaving: true } : w))
    );

    // doctor_id/created_by are FKs to staff(id) -- NOT the same value as
    // the Supabase Auth user id. staff has its own id, separate from
    // staff.user_id (which is what the auth session actually gives us),
    // so this needs its own lookup rather than using session.user.id
    // directly.
    let staffId: string | null = null;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.id) {
        const { data: staffRow } = await supabase
          .from("staff")
          .select("id")
          .eq("user_id", session.user.id)
          .maybeSingle();
        staffId = staffRow?.id || null;
      }
    } catch (e) {
      console.warn("Could not resolve staff id for created_by field:", e);
    }

    const notePayload: Partial<VisitNote> = {
      appointment_id: win.appointmentId,
      patient_id: win.patientId || null,
      doctor_id: staffId,
      content: win.content,
      blood_pressure: win.bloodPressure || null,
      heart_rate: win.heartRate || null,
      diagnosis: win.diagnosis || null,
      follow_up_date: win.followUpDate || null,
      template_id: win.templateId,
      note_data: win.noteData || null,
      visit_date: new Date().toISOString(),
      created_by: staffId,
    } as any;

    try {
      let savedNote: VisitNote | null = null;

      if (win.noteId) {
        // Update existing
        const { data, error } = await supabase
          .from("visit_notes")
          .update(notePayload)
          .eq("id", win.noteId)
          .select();
        if (error) throw error;
        if (data && data.length > 0) savedNote = data[0];
      } else {
        // Insert new
        const { data, error } = await supabase
          .from("visit_notes")
          .insert([notePayload])
          .select();
        if (error) throw error;
        if (data && data.length > 0) savedNote = data[0];
      }

      const nowStr = new Date().toLocaleTimeString();
      setActiveWindows((prev) =>
        prev.map((w) =>
          w.windowId === windowId
            ? {
                ...w,
                noteId: savedNote?.id || w.noteId || "local-temp-" + Date.now(),
                isDirty: false,
                isSaving: false,
                lastSaved: nowStr,
              }
            : w
        )
      );
    } catch (err: any) {
      console.error("Failed saving note to cloud table:", err.message);

      // Note content is patient health information and must never be
      // written to localStorage (unencrypted, persists after logout,
      // readable by any XSS). Keep it only in React state — isDirty stays
      // true so the UI keeps showing it as unsaved and the user can retry —
      // instead of silently caching it to disk.
      setActiveWindows((prev) =>
        prev.map((w) =>
          w.windowId === windowId
            ? {
                ...w,
                isDirty: true,
                isSaving: false,
                lastSaved: "Save failed — retry before closing this note",
              }
            : w
        )
      );
    }
  };

  return (
    <VisitNotesContext.Provider
      value={{
        activeWindows,
        templates,
        openNoteWindow,
        closeNoteWindow,
        minimizeNoteWindow,
        maximizeNoteWindow,
        updateWindowContent,
        saveActiveNote,
        focusWindow,
        syncNoteFromRealtime,
        templatesLoading,
      }}
    >
      {children}
      <ActiveNotesDock />
    </VisitNotesContext.Provider>
  );
}

export function useVisitNotes() {
  const context = useContext(VisitNotesContext);
  if (context === undefined) {
    throw new Error("useVisitNotes must be used within a VisitNotesProvider");
  }
  return context;
}

// CLINICAL DYNAMIC FORMS SCHEMA AND RENDERER SYSTEM
export interface ClinicalFormOption {
  value: number | string;
  label: string;
}

export interface ClinicalFormQuestion {
  id: string;
  text: string;
  type: "radio" | "slider" | "select" | "text";
  options?: ClinicalFormOption[];
}

export interface ClinicalFormSchema {
  id: string;
  title: string;
  description: string;
  questions: ClinicalFormQuestion[];
  extraQuestions?: ClinicalFormQuestion[];
}

export const GAD7_SCHEMA: ClinicalFormSchema = {
  id: "gad-7",
  title: "GAD-7 Anxiety Scale",
  description: "Over the last two weeks, how often have you been bothered by the following problems?",
  questions: [
    {
      id: "q1",
      text: "Feeling nervous, anxious, or on edge",
      type: "radio",
      options: [
        { value: 0, label: "Not at all" },
        { value: 1, label: "Several days" },
        { value: 2, label: "More than half the days" },
        { value: 3, label: "Nearly every day" }
      ]
    },
    {
      id: "q2",
      text: "Not being able to stop or control worrying",
      type: "radio",
      options: [
        { value: 0, label: "Not at all" },
        { value: 1, label: "Several days" },
        { value: 2, label: "More than half the days" },
        { value: 3, label: "Nearly every day" }
      ]
    },
    {
      id: "q3",
      text: "Worrying too much about different things",
      type: "radio",
      options: [
        { value: 0, label: "Not at all" },
        { value: 1, label: "Several days" },
        { value: 2, label: "More than half the days" },
        { value: 3, label: "Nearly every day" }
      ]
    },
    {
      id: "q4",
      text: "Trouble relaxing",
      type: "radio",
      options: [
        { value: 0, label: "Not at all" },
        { value: 1, label: "Several days" },
        { value: 2, label: "More than half the days" },
        { value: 3, label: "Nearly every day" }
      ]
    },
    {
      id: "q5",
      text: "Being so restless that it’s hard to sit still",
      type: "radio",
      options: [
        { value: 0, label: "Not at all" },
        { value: 1, label: "Several days" },
        { value: 2, label: "More than half the days" },
        { value: 3, label: "Nearly every day" }
      ]
    },
    {
      id: "q6",
      text: "Becoming easily annoyed or irritable",
      type: "radio",
      options: [
        { value: 0, label: "Not at all" },
        { value: 1, label: "Several days" },
        { value: 2, label: "More than half the days" },
        { value: 3, label: "Nearly every day" }
      ]
    },
    {
      id: "q7",
      text: "Feeling afraid, as if something awful might happen",
      type: "radio",
      options: [
        { value: 0, label: "Not at all" },
        { value: 1, label: "Several days" },
        { value: 2, label: "More than half the days" },
        { value: 3, label: "Nearly every day" }
      ]
    }
  ],
  extraQuestions: [
    {
      id: "difficulty",
      text: "If you checked any problems, how difficult have they made it for you to do your work, take care of things at home, or get along with other people?",
      type: "radio",
      options: [
        { value: "Not difficult at all", label: "Not difficult at all" },
        { value: "Somewhat difficult", label: "Somewhat difficult" },
        { value: "Very difficult", label: "Very difficult" },
        { value: "Extremely difficult", label: "Extremely difficult" }
      ]
    }
  ]
};

export function getGAD7ScoreInterpretation(score: number) {
  if (score >= 15) {
    return {
      severity: "Severe anxiety",
      interpretation: "Indicative of Severe anxiety. Clinical evaluation & therapy/medication consultation strongly recommended.",
      color: "text-red-700 bg-red-50 border-red-200"
    };
  } else if (score >= 10) {
    return {
      severity: "Moderate anxiety",
      interpretation: "Indicative of Moderate anxiety. Suggestive of General Anxiety Disorder (GAD). Professional clinical consult advised.",
      color: "text-amber-700 bg-amber-50 border-amber-200"
    };
  } else if (score >= 5) {
    return {
      severity: "Mild anxiety",
      interpretation: "Indicative of Mild anxiety. Periodic monitor suggested.",
      color: "text-blue-700 bg-blue-50 border-blue-200"
    };
  } else {
    return {
      severity: "Minimal anxiety",
      interpretation: "Indicative of Minimal or no anxiety symptoms.",
      color: "text-green-700 bg-green-50 border-green-200"
    };
  }
}

interface ClinicalFormRendererProps {
  schema: ClinicalFormSchema;
  answers: Record<string, any>;
  onAnswerChange: (questionId: string, value: any) => void;
}

export const ClinicalFormRenderer: React.FC<ClinicalFormRendererProps> = ({
  schema,
  answers,
  onAnswerChange,
}) => {
  return (
    <div className="flex flex-col gap-5 text-xs font-sans">
      <div className="bg-indigo-50/40 p-3 rounded-lg border border-indigo-100/50">
        <h4 className="font-bold text-slate-800 text-xs mb-1 flex items-center gap-1">
          <Info className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
          Instructions
        </h4>
        <p className="text-slate-600 leading-relaxed text-[11px]">{schema.description}</p>
      </div>

      <div className="flex flex-col gap-3">
        {schema.questions.map((q, idx) => {
          const selectedValue = answers[q.id];
          return (
            <div key={q.id} className="p-3 bg-slate-50 border rounded-lg flex flex-col gap-2 hover:bg-slate-50/50 transition-colors">
              <div className="flex items-start justify-between gap-3">
                <span className="font-semibold text-slate-800 leading-snug">
                  {idx + 1}. {q.text}
                </span>
                {selectedValue !== undefined && selectedValue !== null && (
                  <span className="bg-indigo-600 text-white font-mono text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0">
                    +{selectedValue}
                  </span>
                )}
              </div>

              {q.type === "radio" && q.options && (
                <div className="grid grid-cols-4 gap-1.5 mt-1">
                  {q.options.map((opt) => {
                    const isSelected = selectedValue === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => onAnswerChange(q.id, opt.value)}
                        className={`py-1.5 px-1 rounded-md text-[10px] text-center font-medium transition-all border cursor-pointer ${
                          isSelected
                            ? "bg-indigo-600 border-indigo-600 text-white shadow-xs"
                            : "bg-white hover:bg-slate-100 text-slate-600 border-slate-200"
                        }`}
                      >
                        <span className="block font-bold font-mono text-xs mb-0.5">{opt.value}</span>
                        <span className="block truncate text-[8px] opacity-90 leading-tight">{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {schema.extraQuestions && schema.extraQuestions.length > 0 && (
        <div className="border-t border-slate-100 pt-4 flex flex-col gap-3">
          {schema.extraQuestions.map((eq) => {
            const selectedValue = answers[eq.id];
            return (
              <div key={eq.id} className="p-3 bg-amber-50/40 border border-amber-100 rounded-lg flex flex-col gap-2">
                <span className="font-semibold text-slate-800 leading-snug text-[11px]">
                  {eq.text}
                </span>

                {eq.type === "radio" && eq.options && (
                  <div className="flex flex-col gap-1.5 mt-1">
                    {eq.options.map((opt) => {
                      const isSelected = selectedValue === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => onAnswerChange(eq.id, opt.value)}
                          className={`w-full py-2 px-3 rounded-lg text-left text-[11px] font-semibold transition-all border flex items-center justify-between cursor-pointer ${
                            isSelected
                              ? "bg-amber-600 border-amber-600 text-white shadow-xs"
                              : "bg-white hover:bg-amber-50 text-slate-700 border-amber-200"
                          }`}
                        >
                          <span>{opt.label}</span>
                          <span className={`h-3 w-3 rounded-full border-2 flex items-center justify-center shrink-0 ${
                            isSelected ? "border-white bg-white" : "border-slate-300 bg-white"
                          }`}>
                            {isSelected && <span className="h-1.5 w-1.5 rounded-full bg-amber-600" />}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// DRAGGABLE WINDOW COMPONENT
interface FloatingWindowProps {
  win: ActiveWindow;
}

const FloatingWindow: React.FC<FloatingWindowProps> = ({ win }) => {
  const { 
    closeNoteWindow, 
    minimizeNoteWindow, 
    updateWindowContent, 
    saveActiveNote, 
    focusWindow,
    templates
  } = useVisitNotes();

  const windowRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [activeTab, setActiveTab] = useState<"soap" | "gad7">("soap");

  // On phone widths this floating, draggable 560px HUD would render mostly
  // off-screen -- go full-screen instead, and there's nothing to drag.
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth <= 820);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 820);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // --- Voice dictation for the SOAP note (browser's built-in speech
  // recognition -- free, no server round-trip, but only reliably available
  // in Chrome; Safari/iOS support exists but can be spotty). ---
  const voiceSupported = typeof window !== "undefined" && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  const [isRecording, setIsRecording] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const isRecordingRef = useRef(false);
  const baseContentRef = useRef("");
  const finalTranscriptRef = useRef("");

  const stopRecording = () => {
    isRecordingRef.current = false;
    setIsRecording(false);
    try { recognitionRef.current?.stop(); } catch {}
    recognitionRef.current = null;
  };

  const startRecording = () => {
    const SpeechRecognitionCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      setVoiceError("Voice input isn't supported in this browser. Try Chrome.");
      return;
    }
    setVoiceError(null);

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    baseContentRef.current = win.content ? win.content.replace(/\s+$/, "") + "\n\n" : "";
    finalTranscriptRef.current = "";

    recognition.onresult = (event: any) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscriptRef.current += transcript + " ";
        } else {
          interim += transcript;
        }
      }
      updateWindowContent(win.windowId, {
        content: baseContentRef.current + finalTranscriptRef.current + interim,
        isDirty: true,
      });
    };

    recognition.onerror = (event: any) => {
      if (event.error === "no-speech" || event.error === "aborted") return; // benign, keep listening
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setVoiceError("Microphone access was blocked. Allow it in your browser's site settings to dictate notes.");
      } else {
        setVoiceError("Voice input hit an error and stopped. Tap Voice to try again.");
      }
      stopRecording();
    };

    recognition.onend = () => {
      // Mobile browsers often auto-stop after a short pause of silence --
      // restart transparently unless the user explicitly hit stop.
      if (isRecordingRef.current && recognitionRef.current === recognition) {
        try { recognition.start(); } catch {}
      }
    };

    recognitionRef.current = recognition;
    isRecordingRef.current = true;
    setIsRecording(true);
    try {
      recognition.start();
    } catch {
      setVoiceError("Could not start voice input.");
      stopRecording();
    }
  };

  const toggleRecording = () => {
    if (isRecording) stopRecording();
    else startRecording();
  };

  // Stop listening if this note window closes/unmounts mid-dictation.
  useEffect(() => {
    return () => {
      isRecordingRef.current = false;
      try { recognitionRef.current?.stop(); } catch {}
    };
  }, []);

  const handleAnswerChange = (questionId: string, value: any) => {
    const currentAnswers = win.noteData?.answers || {};
    const newAnswers = { ...currentAnswers, [questionId]: value };
    
    // Calculate score
    let score = 0;
    for (let i = 1; i <= 7; i++) {
      const val = newAnswers[`q${i}`];
      if (typeof val === "number") {
        score += val;
      }
    }
    
    const interpretationInfo = getGAD7ScoreInterpretation(score);
    
    updateWindowContent(win.windowId, {
      noteData: {
        formId: "gad-7",
        title: "GAD-7 Anxiety Scale",
        answers: newAnswers,
        totalScore: score,
        severity: interpretationInfo.severity,
        interpretation: interpretationInfo.interpretation,
        completedAt: new Date().toISOString()
      },
      isDirty: true
    });
  };

  const handleCopySummaryToNote = () => {
    const data = win.noteData;
    if (!data) return;
    
    const answersText = GAD7_SCHEMA.questions.map((q, idx) => {
      const score = data.answers[q.id];
      const label = q.options?.find(o => o.value === score)?.label || "Not answered";
      return ` - ${q.text}: ${score !== undefined && score !== null ? score : "?"} (${label})`;
    }).join("\n");
    
    const diffText = data.answers["difficulty"] || "Not answered";
    
    const summaryBlock = `[GAD-7 ANXIETY SCALE ASSESSMENT]
Assessment Date: ${data.completedAt ? new Date(data.completedAt).toLocaleDateString("en-GB") : new Date().toLocaleDateString("en-GB")}
Total Score: ${data.totalScore} / 21 (${data.severity})
Interpretation: ${data.interpretation}

Detailed Question Breakdown:
${answersText}

Overall Functional Difficulty:
${diffText}`;
    
    const merged = win.content 
      ? `${win.content}\n\n${summaryBlock}` 
      : summaryBlock;
      
    updateWindowContent(win.windowId, {
      content: merged,
      isDirty: true
    });
  };

  // Draggable logic
  const handleMouseDown = (e: React.MouseEvent) => {
    // Avoid dragging on button click
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("select") || target.closest("input") || target.closest("textarea")) {
      return;
    }
    
    focusWindow(win.windowId);
    setIsDragging(true);
    setDragOffset({
      x: e.clientX - win.position.x,
      y: e.clientY - win.position.y,
    });
    e.preventDefault();
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      
      // Keep window within reasonable viewport boundaries
      const newX = Math.max(10, Math.min(window.innerWidth - 300, e.clientX - dragOffset.x));
      const newY = Math.max(10, Math.min(window.innerHeight - 200, e.clientY - dragOffset.y));
      
      updateWindowContent(win.windowId, {
        position: { x: newX, y: newY }
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, dragOffset, win.windowId]);

  // Load Template
  const handleTemplateChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const templateId = e.target.value;
    if (!templateId) return;
    
    const selected = templates.find(t => t.id === templateId);
    if (selected) {
      // Interpolate @NAME@, @AGE@, @MRN@ placeholders with active patient data
      const ageStr = win.patientAge || "N/A";
      const mrnStr = win.patientMrn || "N/A";
      const interpolatedContent = selected.content
        .replace(/@NAME@/g, win.patientName || "")
        .replace(/@AGE@/g, ageStr)
        .replace(/@MRN@/g, mrnStr);

      const mergedContent = win.content 
        ? `${win.content}\n\n--- Applied: ${selected.title} ---\n${interpolatedContent}` 
        : interpolatedContent;
        
      updateWindowContent(win.windowId, {
        templateId,
        content: mergedContent,
        isDirty: true
      });
    }
  };

  // Keyboard shortcut to save (Cmd+S or Ctrl+S)
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "s") {
      e.preventDefault();
      saveActiveNote(win.windowId);
    }
  };

  return (
    <div
      ref={windowRef}
      onMouseDown={() => focusWindow(win.windowId)}
      className={`fixed flex flex-col bg-white border shadow-2xl overflow-hidden transition-all duration-150 ${isMobile ? "" : "rounded-xl"}`}
      style={isMobile ? {
        left: 0,
        top: 0,
        width: "100vw",
        height: "100vh",
        zIndex: win.zIndex,
        display: win.isMinimized ? "none" : "flex"
      } : {
        left: `${win.position.x}px`,
        top: `${win.position.y}px`,
        width: "560px",
        height: "640px",
        zIndex: win.zIndex,
        boxShadow: "0 25px 50px -12px rgba(15, 23, 42, 0.25), 0 0 1px 1px rgba(0,0,0,0.05)",
        display: win.isMinimized ? "none" : "flex"
      }}
    >
      {/* WINDOW HEADER */}
      <div
        ref={dragRef}
        onMouseDown={handleMouseDown}
        className={`px-4 py-3 cursor-grab active:cursor-grabbing flex items-center justify-between select-none ${
          isDragging ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 border-b"
        }`}
      >
        <div className="flex items-center gap-2 overflow-hidden mr-4">
          <FileText className={`h-4.5 w-4.5 flex-shrink-0 ${isDragging ? "text-indigo-400" : "text-indigo-600"}`} />
          <div className="truncate">
            <span className="font-bold text-xs font-sans block truncate max-w-[280px]">
              {win.patientName} &mdash; Clinical Note
            </span>
            <span className={`text-[9px] font-mono block ${isDragging ? "text-slate-400" : "text-slate-500"}`}>
              Physician: {win.doctorName}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {win.isDirty && (
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse mr-1" title="Unsaved changes" />
          )}
          <button 
            onClick={() => minimizeNoteWindow(win.windowId)}
            className="p-1 hover:bg-slate-200 hover:text-slate-900 rounded-md transition-colors"
            title="Minimize to Tray"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <button 
            onClick={() => closeNoteWindow(win.windowId)}
            className="p-1 hover:bg-red-500 hover:text-white rounded-md transition-colors"
            title="Close Note"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* COMPACT INFRASTRUCTURE VITAL FIELDS BAR */}
      <div className="bg-indigo-50/50 px-4 py-2.5 border-b grid grid-cols-2 gap-2 text-xs">
        <div>
          <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">Blood Pressure</label>
          <input 
            type="text" 
            placeholder="e.g. 120/80 mmHg"
            value={win.bloodPressure}
            onChange={(e) => updateWindowContent(win.windowId, { bloodPressure: e.target.value })}
            className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-indigo-500"
          />
        </div>
        <div>
          <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">Heart Rate</label>
          <input 
            type="text" 
            placeholder="e.g. 72 bpm"
            value={win.heartRate}
            onChange={(e) => updateWindowContent(win.windowId, { heartRate: e.target.value })}
            className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-indigo-500"
          />
        </div>
      </div>

      {/* QUICK ACTIONS & TEMPLATE SELECTOR */}
      <div className="bg-slate-50 px-4 py-2 border-b flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <ClipboardList className="h-3.5 w-3.5 text-slate-500 flex-shrink-0" />
          <select 
            value={win.templateId || ""} 
            onChange={handleTemplateChange}
            className="bg-white border border-slate-200 rounded px-1.5 py-1 text-[11px] focus:outline-none font-medium text-slate-700 flex-1 min-w-0"
          >
            <option value="">-- Apply Medical Template --</option>
            {templates.map(t => (
              <option key={t.id} value={t.id}>[{t.category}] {t.title}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          <button 
            onClick={() => saveActiveNote(win.windowId)}
            disabled={win.isSaving}
            className={`px-2.5 py-1 text-[11px] font-bold rounded flex items-center gap-1 transition-all ${
              win.isDirty 
                ? "bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer" 
                : "bg-slate-200 text-slate-500 cursor-not-allowed"
            }`}
          >
            {win.isSaving ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Save className="h-3 w-3" />
            )}
            Save
          </button>
        </div>
      </div>

      {/* TABS SELECTOR */}
      <div className="flex border-b border-slate-200 bg-slate-100/50 px-4 text-[11px] font-medium">
        <button
          type="button"
          onClick={() => setActiveTab("soap")}
          className={`px-4 py-2 border-b-2 font-bold transition-all -mb-[1px] flex items-center gap-1.5 cursor-pointer ${
            activeTab === "soap"
              ? "border-indigo-600 text-indigo-600 bg-white rounded-t-md"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <FileText className="h-3.5 w-3.5 text-indigo-500" />
          SOAP Progress Note
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("gad7")}
          className={`px-4 py-2 border-b-2 font-bold transition-all -mb-[1px] flex items-center gap-1.5 cursor-pointer ${
            activeTab === "gad7"
              ? "border-indigo-600 text-indigo-600 bg-white rounded-t-md"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <ClipboardList className="h-3.5 w-3.5 text-indigo-500" />
          GAD-7 Anxiety Scale
          {win.noteData?.totalScore !== undefined && (
            <span className="ml-1 bg-indigo-100 text-indigo-700 text-[10px] px-1.5 py-0.5 rounded-full font-mono font-bold">
              Score: {win.noteData.totalScore}
            </span>
          )}
        </button>
      </div>

      {activeTab === "soap" ? (
        /* CLINICAL NOTE TEXT AREA */
        <div className="flex-1 flex flex-col p-4 gap-3 overflow-y-auto" onKeyDown={handleKeyDown}>
          <div className="flex-1 flex flex-col">
            <div className="flex items-center justify-between mb-1">
              <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-widest">Observation & Note Content (SOAP format)</label>
              {voiceSupported && (
                <button
                  type="button"
                  onClick={toggleRecording}
                  title={isRecording ? "Stop voice dictation" : "Dictate note by voice"}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide cursor-pointer transition-colors ${
                    isRecording ? "bg-red-100 text-red-600 animate-pulse" : "bg-indigo-50 text-indigo-600 hover:bg-indigo-100"
                  }`}
                >
                  {isRecording ? <MicOff className="h-3 w-3" /> : <Mic className="h-3 w-3" />}
                  {isRecording ? "Listening..." : "Voice"}
                </button>
              )}
            </div>
            {voiceError && (
              <div className="text-[10px] text-red-600 bg-red-50 border border-red-100 rounded-md px-2 py-1 mb-1.5">{voiceError}</div>
            )}
            <textarea
              value={win.content}
              onChange={(e) => updateWindowContent(win.windowId, { content: e.target.value })}
              placeholder="Type subjective complaints, physical exam observations, assessment summaries, or treatment plan updates... or tap Voice to dictate."
              className={`flex-1 w-full bg-slate-50 border hover:border-slate-300 focus:bg-white rounded-lg p-3 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans leading-relaxed resize-none ${isRecording ? "border-red-300" : "border-slate-200"}`}
            />
          </div>

          {/* EXTRA DIAGNOSIS & FOLLOW-UP INFO */}
          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100">
            <div>
              <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">Active Diagnosis (ICD-10)</label>
              <input 
                type="text" 
                placeholder="e.g. Essential hypertension (I10)"
                value={win.diagnosis}
                onChange={(e) => updateWindowContent(win.windowId, { diagnosis: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1 text-xs focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">Follow-up Schedule</label>
              <input 
                type="text" 
                placeholder="e.g. In 2 weeks or 2026-07-15"
                value={win.followUpDate}
                onChange={(e) => updateWindowContent(win.windowId, { followUpDate: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-md px-2.5 py-1 text-xs focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>
        </div>
      ) : (
        /* GAD-7 CLINICAL FORM COMPONENT */
        <div className="flex-1 flex flex-col p-4 gap-4 overflow-y-auto bg-slate-50/50">
          <div className="bg-gradient-to-r from-indigo-50 to-purple-50 p-4 rounded-xl border border-indigo-100 flex justify-between items-center gap-4 flex-wrap">
            <div>
              <div className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider">Calculated GAD-7 Score</div>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-3xl font-black text-indigo-950 font-sans">{win.noteData?.totalScore || 0}</span>
                <span className="text-slate-500 font-semibold text-xs">/ 21</span>
                <span className="bg-indigo-100 text-indigo-800 text-[9px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider ml-1.5 border border-indigo-200">
                  {win.noteData?.severity || "Minimal anxiety"}
                </span>
              </div>
              <p className="text-[11px] text-slate-600 mt-1.5 max-w-[280px] leading-relaxed">
                {win.noteData?.interpretation || "Complete the 7-question assessment below to calculate clinical anxiety indicators."}
              </p>
            </div>
            {win.noteData?.totalScore !== undefined && (
              <button
                onClick={handleCopySummaryToNote}
                type="button"
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-3 rounded-lg text-[10px] flex items-center gap-1.5 cursor-pointer shadow-md shadow-indigo-600/15 transition-all"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Copy to SOAP Note
              </button>
            )}
          </div>

          {/* Warning notice if score is >= 10 */}
          {(win.noteData?.totalScore || 0) >= 10 && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 p-3 rounded-lg text-[11px] leading-relaxed flex gap-2">
              <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <strong>Clinical indicator alert:</strong> A score of 10 or higher may indicate experiencing generalized anxiety disorder (GAD). It is highly beneficial to consult a healthcare professional.
              </div>
            </div>
          )}

          <ClinicalFormRenderer
            schema={GAD7_SCHEMA}
            answers={win.noteData?.answers || {}}
            onAnswerChange={handleAnswerChange}
          />
        </div>
      )}

      {/* WINDOW FOOTER */}
      <div className="px-4 py-2.5 bg-slate-50 border-t flex items-center justify-between text-[10px] text-slate-400">
        <div className="flex items-center gap-1.5">
          <span className="flex h-2 w-2 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span className="font-mono uppercase text-[9px] font-bold text-slate-500">Supabase Sync Ready</span>
        </div>
        <div className="font-mono text-right text-[9px]">
          {win.lastSaved ? (
            <span className="text-slate-500">Last saved: <strong>{win.lastSaved}</strong></span>
          ) : (
            <span className="text-slate-400 italic">Draft note unsaved</span>
          )}
        </div>
      </div>
    </div>
  );
};

// ACTIVE NOTES TRAY / DOCK (BOTTOM RIGHT OF SCREEN)
function ActiveNotesDock() {
  const { activeWindows, maximizeNoteWindow, closeNoteWindow } = useVisitNotes();

  if (activeWindows.length === 0) return null;

  const minimizedWindows = activeWindows.filter(w => w.isMinimized);
  const openWindows = activeWindows.filter(w => !w.isMinimized);

  return (
    <>
      {/* Render open floating windows */}
      {openWindows.map(win => (
        <FloatingWindow key={win.windowId} win={win} />
      ))}

      {/* FIXED TRAY AT BOTTOM-RIGHT */}
      <div 
        className="fixed bottom-4 right-4 z-[9999] flex flex-col items-end gap-2"
        style={{ pointerEvents: "none" }}
      >
        {/* Minimized windows list dock */}
        {minimizedWindows.length > 0 && (
          <div 
            style={{ pointerEvents: "auto" }}
            className="bg-slate-900/95 text-white p-2.5 rounded-lg border border-slate-800 shadow-xl w-80 max-w-[calc(100vw-2rem)] flex flex-col gap-1.5 backdrop-blur-sm"
          >
            <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 border-b border-slate-800 pb-1.5 mb-1">
              <span className="uppercase tracking-widest font-bold">Minimized Notes ({minimizedWindows.length})</span>
              <span>Active Clinicians</span>
            </div>
            
            <div className="max-h-40 overflow-y-auto flex flex-col gap-1">
              {minimizedWindows.map(win => (
                <div 
                  key={win.windowId}
                  className="flex items-center justify-between bg-slate-800/80 hover:bg-slate-800 px-2 py-1.5 rounded border border-slate-700/50 text-xs text-slate-200 transition-colors"
                >
                  <button 
                    onClick={() => maximizeNoteWindow(win.windowId)}
                    className="flex items-center gap-1.5 text-left font-medium hover:text-indigo-400 truncate flex-1"
                  >
                    <FileText className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
                    <span className="truncate max-w-[160px]">{win.patientName}</span>
                  </button>

                  <div className="flex items-center gap-1">
                    <button 
                      onClick={() => maximizeNoteWindow(win.windowId)}
                      className="p-1 text-slate-400 hover:text-white hover:bg-slate-700 rounded text-[10px]"
                      title="Restore Window"
                    >
                      <Maximize2 className="h-3 w-3" />
                    </button>
                    <button 
                      onClick={() => closeNoteWindow(win.windowId)}
                      className="p-1 text-slate-400 hover:text-red-400 hover:bg-slate-700 rounded text-[10px]"
                      title="Discard"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </>
  );
}
