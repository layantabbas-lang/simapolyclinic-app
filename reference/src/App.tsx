import React, { useState, useEffect, useRef } from "react";
import {
  Activity, Upload, Sparkles, RotateCcw, Layers, Database,
  AlertCircle, BookOpen, CheckCircle, Clock, Calendar,
  LogOut, Sliders, X, ChevronRight, Users,
  Search, Printer, Lock, Menu, UserCheck, FileText,
  Mail, Flag, Wrench, ChevronDown, Plus, AlertTriangle,
  Briefcase, Table, FileSpreadsheet, LayoutGrid, List,
  ArrowLeftRight, Stethoscope, FlaskConical, Camera, Pill, LayoutDashboard, Syringe, MapPin, BedDouble
} from "lucide-react";
import { CLINICAL_PRESETS } from "./clinicalPresets";
import { AnalysisJSONResponse, ClinicalPreset } from "./types";
import ReportDashboard from "./components/ReportDashboard";
import ClinicCalendar from "./components/ClinicCalendar";
import SignIn, { UserSession, normalizeRole, SPECIALTIES } from "./components/SignIn";
import ResetPassword from "./components/ResetPassword";
import AdminConsole from "./components/AdminConsole";
import PatientsDirectory from "./components/PatientsDirectory";
import BedBoard from "./components/BedBoard";
import { SimaLogo } from "./components/SimaLogo";
import { supabase } from "./supabaseClient";
import { VisitNotesProvider } from "./components/VisitNotesManager";
import TemplateManager from "./components/TemplateManager";
import TestManager from "./components/TestManager";
import PharmacyManager from "./components/PharmacyManager";
import DashboardManager from "./components/DashboardManager";
import CareQueue from "./components/CareQueue";
import LocationsManager from "./components/LocationsManager";

// Temporarily hidden from navigation (feature is kept in the codebase, just
// not linked to from the UI right now). Flip back to true to bring the
// Document Extractor tab back for everyone.
const SHOW_DOCUMENT_EXTRACTOR_TAB = false;

export default function App() {
  const [currentUser, setCurrentUser] = useState<UserSession | null>(() => {
    try { const s = localStorage.getItem("medextract_session"); return s ? JSON.parse(s) : null; } catch { return null; }
  });

  // Set when the user arrives via a "Forgot password?" email link. Supabase
  // exchanges the recovery token in the URL for a real session and fires this
  // auth event; we intercept it here (before the normal currentUser/SignIn
  // check below) so the reset-password screen takes over regardless of
  // whether anyone is already logged in on this device.
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  useEffect(() => {
    if (!supabase.auth) return; // Supabase not configured (local mock mode) -- nothing to listen for.
    const { data: authListener } = supabase.auth.onAuthStateChange((event: string) => {
      if (event === "PASSWORD_RECOVERY") {
        setIsPasswordRecovery(true);
      }
    });
    return () => authListener?.subscription?.unsubscribe();
  }, []);

  const [selectedSpecialtyIndex, setSelectedSpecialtyIndex] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("auracare_specialty_index");
      return saved ? parseInt(saved, 10) : 0;
    } catch {
      return 0;
    }
  });

  useEffect(() => {
    const currentSpecialty = SPECIALTIES[selectedSpecialtyIndex];
    if (currentSpecialty) {
      // Per-department accents (muted eye-comfort palette defined in SPECIALTIES)
      document.documentElement.style.setProperty("--theme-accent", currentSpecialty.accent);
      document.documentElement.style.setProperty("--theme-accent-bg", currentSpecialty.accentBg);
      document.documentElement.style.setProperty("--theme-accent-dark", currentSpecialty.accentDark);
      localStorage.setItem("auracare_specialty_index", selectedSpecialtyIndex.toString());
    }
  }, [selectedSpecialtyIndex]);

  const [isTemplateManagerOpen, setIsTemplateManagerOpen] = useState(false);
  const [isTestManagerOpen, setIsTestManagerOpen] = useState(false);
  const [isMyToolsDropdownOpen, setIsMyToolsDropdownOpen] = useState(false);
  const [isLocationsManagerOpen, setIsLocationsManagerOpen] = useState(false);

  // Phone-width layout: collapses the desktop nav row into a hamburger menu
  // and stacks the extractor grid to a single column.
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth <= 820);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 820);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const [textData, setTextData] = useState("");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [fileBase64, setFileBase64] = useState<string | null>(null);
  const [fileMimeType, setFileMimeType] = useState<string | null>(null);
  const [activePreset, setActivePreset] = useState<ClinicalPreset | null>(null);
  const [viewMode, setViewMode] = useState<"extractor" | "calendar" | "patients" | "admin_console" | "pharmacy" | "dashboard" | "care_queue" | "bed_board">(() => {
    try {
      const s = localStorage.getItem("medextract_session");
      if (s) {
        const p = JSON.parse(s);
        if (p.role === "secretary") return "calendar";
        if (p.role === "admin") return "admin_console";
        if (p.role === "pharmacy") return "pharmacy";
        if (p.role === "nurse") return "care_queue";
        return SHOW_DOCUMENT_EXTRACTOR_TAB ? "extractor" : "calendar";
      }
    } catch {}
    return "calendar";
  });

  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const [resultData, setResultData] = useState<AnalysisJSONResponse | null>(null);
  const [errorString, setErrorString] = useState<string | null>(null);
  const [apiHealth, setApiHealth] = useState<"connecting" | "healthy" | "failed">("connecting");
  const [isConfigError, setIsConfigError] = useState(false);
  const [globalSearchQuery, setGlobalSearchQuery] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const handleGlobalSearchChange = (val: string) => {
    setGlobalSearchQuery(val);
    if (val.trim() !== "" && viewMode !== "patients") {
      setViewMode("patients");
    }
  };

  const loadingMessages = [
    "Receiving clinical document package...",
    "Decoding document structure & metadata...",
    "Invoking Claude medical model...",
    "Mapping records to JSON schema...",
    "Scanning for abnormal thresholds...",
    "Compiling physician capsule summary...",
  ];

  // Listen to Supabase Auth State Changes for persistent logins
  useEffect(() => {
    if (!supabase.auth) return;

    const checkCurrentAuth = async () => {
      try {
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        if (currentSession?.user) {
          console.log("Found existing Supabase Auth Session. Fetching profile...");
          const { data: profile } = await supabase
            .from("profiles")
            .select("*")
            .eq("id", currentSession.user.id)
            .single();

          const rawRole = profile?.role || "secretary";
          const resolvedRole = normalizeRole(rawRole);
          const fullName = profile?.full_name || currentSession.user.user_metadata?.full_name || currentSession.user.email?.split("@")[0] || "Staff";

          setCurrentUser({
            id: currentSession.user.id,
            username: currentSession.user.email || "user",
            name: fullName,
            role: resolvedRole
          });
        }
      } catch (err) {
        console.error("Error loading active user session:", err);
      }
    };

    checkCurrentAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        try {
          const { data: profile } = await supabase
            .from("profiles")
            .select("*")
            .eq("id", session.user.id)
            .single();

          const rawRole = profile?.role || "secretary";
          const resolvedRole = normalizeRole(rawRole);
          const fullName = profile?.full_name || session.user.user_metadata?.full_name || session.user.email?.split("@")[0] || "Staff";

          setCurrentUser({
            id: session.user.id,
            username: session.user.email || "user",
            name: fullName,
            role: resolvedRole
          });
        } catch (err) {
          console.error("Error on auth state change session load:", err);
        }
      } else {
        // If logged out from Supabase, check if we need to clear local session
        const cached = localStorage.getItem("medextract_session");
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed.username && parsed.username.includes("@")) {
            setCurrentUser(null);
          }
        }
      }
    });

    return () => {
      subscription?.unsubscribe();
    };
  }, []);

  // Simple Permission Guard and Redirect Guard based on role
  useEffect(() => {
    if (!currentUser) return;

    const role = currentUser.role;
    // Enforce allowed dashboard views:
    // Secretary only allowed calendar (not patients, extractor, admin_console, pharmacy, dashboard, or care_queue -- all clinical)
    if (role === "secretary" && (viewMode === "patients" || viewMode === "extractor" || viewMode === "admin_console" || viewMode === "pharmacy" || viewMode === "dashboard" || viewMode === "care_queue")) {
      console.warn(`Permission Guard: Redirected 'secretary' role from unauthorized page: ${viewMode}`);
      setViewMode("calendar");
    }
    // Doctor allowed calendar, patients, extractor, and care_queue (not admin_console, pharmacy, or dashboard)
    else if (role === "doctor" && (viewMode === "admin_console" || viewMode === "pharmacy" || viewMode === "dashboard")) {
      console.warn(`Permission Guard: Redirected 'doctor' role from unauthorized page: ${viewMode}`);
      setViewMode(SHOW_DOCUMENT_EXTRACTOR_TAB ? "extractor" : "calendar");
    }
    // Pharmacy only allowed the pharmacy dashboard (inventory/vendors/purchases)
    else if (role === "pharmacy" && viewMode !== "pharmacy") {
      console.warn(`Permission Guard: Redirected 'pharmacy' role from unauthorized page: ${viewMode}`);
      setViewMode("pharmacy");
    }
    // Nurse allowed the pharmacy dashboard (ad-hoc dispensing) and their Care Queue
    else if (role === "nurse" && viewMode !== "pharmacy" && viewMode !== "care_queue") {
      console.warn(`Permission Guard: Redirected 'nurse' role from unauthorized page: ${viewMode}`);
      setViewMode("care_queue");
    }
    // Dashboard (manager reports) is admin-only
    else if (role !== "admin" && viewMode === "dashboard") {
      console.warn(`Permission Guard: Redirected '${role}' role from unauthorized page: ${viewMode}`);
      setViewMode(role === "secretary" || !SHOW_DOCUMENT_EXTRACTOR_TAB ? "calendar" : "extractor");
    }
  }, [viewMode, currentUser]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isLoading) { interval = setInterval(() => setLoadingMessageIndex(p => (p + 1) % loadingMessages.length), 2500); }
    else setLoadingMessageIndex(0);
    return () => clearInterval(interval);
  }, [isLoading]);

  useEffect(() => {
    if (currentUser) {
      localStorage.setItem("medextract_session", JSON.stringify(currentUser));
    } else {
      localStorage.removeItem("medextract_session");
    }
  }, [currentUser]);

  useEffect(() => {
    fetch("/api/health").then(r => setApiHealth(r.ok ? "healthy" : "failed")).catch(() => setApiHealth("failed"));
  }, []);

  const handleLoginSuccess = (session: UserSession) => {
    setCurrentUser(session);
    if (session.role === "secretary") setViewMode("calendar");
    else if (session.role === "admin") setViewMode("admin_console");
    else if (session.role === "pharmacy") setViewMode("pharmacy");
    else if (session.role === "nurse") setViewMode("care_queue");
    else setViewMode(SHOW_DOCUMENT_EXTRACTOR_TAB ? "extractor" : "calendar");
  };

  const handleLogout = async () => {
    if (supabase.auth) {
      try {
        await supabase.auth.signOut();
      } catch (err) {
        console.warn("Could not signOut from Supabase Auth:", err);
      }
    }
    setCurrentUser(null);
    handleReset();
  };

  const handleLoadPresetFromCalendar = (presetId: string) => {
    if (currentUser?.role !== "doctor" && currentUser?.role !== "admin") {
      alert("Only physicians and administrators can run extraction pipelines.");
      return;
    }
    const preset = CLINICAL_PRESETS.find(p => p.id === presetId);
    if (preset) {
      setActivePreset(preset); setTextData(preset.rawText);
      setUploadedFile(null); setFileBase64(null); setFileMimeType(null);
      setResultData(preset.mockResponse); setErrorString(null); setIsConfigError(false);
      setViewMode("extractor");
    }
  };

  const processSelectedFile = (file: File) => {
    setErrorString(null); setIsConfigError(false);
    if (file.size > 15 * 1024 * 1024) { setErrorString("File must be smaller than 15MB."); return; }
    setUploadedFile(file); setFileMimeType(file.type); setActivePreset(null);
    const reader = new FileReader();
    reader.onload = () => setFileBase64(reader.result as string);
    reader.onerror = () => setErrorString("Error reading file. Please retry.");
    reader.readAsDataURL(file);
  };

  const triggerAnalysis = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fileBase64 && !textData.trim() && !activePreset) { setErrorString("Provide a clinical document or paste text to analyze."); return; }
    setIsLoading(true); setErrorString(null); setIsConfigError(false);
    try {
      const rawTextToSend = textData || (activePreset ? activePreset.rawText : "");
      const response = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileData: fileBase64, mimeType: fileMimeType, textData: rawTextToSend }) });
      const resData = await response.json();
      if (!response.ok) { if (resData.needsConfig) setIsConfigError(true); throw new Error(resData.error || "Analysis failed."); }
      setResultData(resData);
      const { error: dbError } = await supabase.from("medical_records").insert([{ raw_text_backup: rawTextToSend, extracted_json: resData, processed_by: currentUser?.id || null }]);
      if (dbError) console.error("Save to Supabase failed:", dbError);
    } catch (err: any) {
      setErrorString(err.message || "Unexpected error during analysis.");
    } finally { setIsLoading(false); }
  };

  const handleReset = () => { setTextData(""); setUploadedFile(null); setFileBase64(null); setFileMimeType(null); setActivePreset(null); setResultData(null); setErrorString(null); setIsConfigError(false); };
  const handleLoadPreset = (preset: ClinicalPreset) => { setActivePreset(preset); setTextData(preset.rawText); setUploadedFile(null); setFileBase64(null); setFileMimeType(null); setResultData(preset.mockResponse); setErrorString(null); setIsConfigError(false); };

  if (isPasswordRecovery) return <ResetPassword onDone={() => setIsPasswordRecovery(false)} />;

  if (!currentUser) return <SignIn onLoginSuccess={handleLoginSuccess} />;

  const healthColor = apiHealth === "healthy" ? "#438a6a" : apiHealth === "connecting" ? "#cfa34d" : "#c05654";
  const healthLabel = apiHealth === "healthy" ? "Extraction ready" : apiHealth === "connecting" ? "Connecting..." : "API error";

  const roleColor = currentUser.role === "admin" ? "#6e9cc9" : currentUser.role === "doctor" ? "#5fa583" : "#6e9cc9";

  return (
    <VisitNotesProvider>
      <div style={{ minHeight: "100vh", background: "#f4f6f9", fontFamily: "system-ui,-apple-system,sans-serif", display: "flex", flexDirection: "column" }}>

      {/* ROW 1: Top Global Bar */}
      <header style={{
        height: "48px",
        background: "#1f2e3e", // Slate 900
        borderBottom: "1.5px solid var(--theme-accent)", // Specialty Accent
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 16px",
        fontSize: "13px",
        color: "#f4f6f9",
        fontWeight: "600",
        fontFamily: "Segoe UI, Tahoma, Geneva, Verdana, sans-serif",
        flexShrink: 0
      }}>
        {/* Left: System Logo & App Instance Name */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {isMobile && (
            <button
              onClick={() => setIsMobileMenuOpen(v => !v)}
              aria-label="Open menu"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", color: "#f4f6f9", cursor: "pointer", padding: "4px" }}
            >
              <Menu size={20} />
            </button>
          )}
          <SimaLogo size="sm" withContainer={false} darkBackground={true} />
          {!isMobile && (
            <span style={{ color: "#8a96a5", fontWeight: "normal", fontSize: "12px" }}>
              <span style={{ textTransform: "uppercase", fontWeight: "700", color: "var(--theme-accent)" }}>{currentUser.role}</span> - <span style={{ fontWeight: "bold", color: "#f4f6f9" }}>{currentUser.name}</span>
            </span>
          )}
        </div>

        {/* Center: Global Search Bar */}
        <div style={{
          display: isMobile ? "none" : "flex",
          alignItems: "center",
          background: "rgba(255, 255, 255, 0.08)",
          border: "1px solid var(--theme-accent)",
          borderRadius: "8px",
          padding: "0 12px",
          width: "360px",
          height: "28px"
        }}>
          <Search size={14} style={{ color: "#8a96a5", marginRight: "6px" }} />
          <input 
            type="text" 
            placeholder="Search patients by name or email..." 
            value={globalSearchQuery}
            onChange={(e) => handleGlobalSearchChange(e.target.value)}
            style={{ border: "none", background: "transparent", fontSize: "12px", width: "100%", outline: "none", color: "#f4f6f9" }} 
          />
          {globalSearchQuery && (
            <button 
              onClick={() => handleGlobalSearchChange("")}
              style={{ background: "none", border: "none", color: "#8a96a5", cursor: "pointer", fontSize: "12px", padding: 0, display: "flex", alignItems: "center" }}
            >
              ×
            </button>
          )}
        </div>

        {/* Right: Actions & User Capsule */}
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? "10px" : "16px" }}>
          {/* API Health */}
          {!isMobile && (
            <div style={{ display: "flex", alignItems: "center", gap: "6px", background: "rgba(255,255,255,0.06)", borderRadius: "12px", padding: "4px 10px", fontSize: "11px" }}>
              <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: healthColor, display: "inline-block" }} />
              <span style={{ color: "var(--theme-accent)", fontWeight: "600" }}>{healthLabel}</span>
            </div>
          )}

          {resultData && viewMode === "extractor" && (
            <button
              onClick={handleReset}
              style={{ display: "flex", alignItems: "center", gap: "4px", cursor: "pointer", color: "#db7a78", background: "none", border: "none", fontSize: "12px", fontWeight: "600" }}
            >
              <RotateCcw size={13} /> {!isMobile && "Clear Chart"}
            </button>
          )}

          {!isMobile && (
            <>
              <span style={{ display: "flex", alignItems: "center", gap: "4px", cursor: "pointer", color: "#c9d2dc", fontSize: "12px" }}><Printer size={13} /> Print</span>
              <span style={{ display: "flex", alignItems: "center", gap: "4px", cursor: "pointer", color: "#c9d2dc", fontSize: "12px" }}><Lock size={13} /> Secure</span>
            </>
          )}
          <button
            onClick={handleLogout}
            style={{ display: "flex", alignItems: "center", gap: "4px", cursor: "pointer", color: "#db7a78", background: "none", border: "none", fontSize: "12px", fontWeight: "600" }}
          >
            <LogOut size={13} /> {!isMobile && "Log Out"}
          </button>
          
          {/* Circular Initials Badge */}
          <div style={{ 
            width: "28px", 
            height: "28px", 
            borderRadius: "50%", 
            background: "var(--theme-accent)", 
            border: "1.5px solid var(--theme-accent-bg)",
            display: "flex", 
            alignItems: "center", 
            justifyContent: "center", 
            fontSize: "12px", 
            fontWeight: "bold",
            color: "#fcfdfe"
          }}>
            {currentUser.name ? currentUser.name.substring(0, 2).toUpperCase() : "US"}
          </div>
        </div>
      </header>

      {/* ROW 2: SIMA Core Workspace & Single-Row EHR Navigation Bar (desktop only -- collapses into the hamburger menu on phone widths) */}
      <div style={{
        background: "var(--theme-accent-dark)", // Professional Specialty-Themed Dark Teal/Rose/Blue/etc
        borderBottom: "2px solid var(--theme-accent)",
        display: isMobile ? "none" : "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 16px",
        height: "44px",
        fontFamily: "Segoe UI, Tahoma, Geneva, Verdana, sans-serif",
        flexShrink: 0,
        userSelect: "none"
      }}>
        {/* Switched Workspace Tabs */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {/* Tab 1: Patient Registry */}
          {currentUser?.role !== "secretary" && (
            <button
              onClick={() => {
                setViewMode("patients");
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                background: viewMode === "patients" ? "rgba(255, 255, 255, 0.15)" : "transparent",
                border: "none",
                fontSize: "12.5px",
                color: "#fcfdfe",
                fontWeight: "600",
                cursor: "pointer",
                padding: "6px 12px",
                borderRadius: "6px",
                transition: "all 0.15s ease"
              }}
            >
              <Users size={14} style={{ color: "var(--theme-accent)" }} />
              <span>Patient Registry</span>
            </button>
          )}

          {/* Tab 2: Document Extractor (hidden for now -- see SHOW_DOCUMENT_EXTRACTOR_TAB) */}
          {SHOW_DOCUMENT_EXTRACTOR_TAB && (
            <button
              onClick={() => {
                setViewMode("extractor");
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                background: viewMode === "extractor" ? "rgba(255, 255, 255, 0.15)" : "transparent",
                border: "none",
                fontSize: "12.5px",
                color: "#fcfdfe",
                fontWeight: "600",
                cursor: "pointer",
                padding: "6px 12px",
                borderRadius: "6px",
                transition: "all 0.15s ease"
              }}
            >
              <FileText size={14} style={{ color: "var(--theme-accent)" }} />
              <span>Document Extractor</span>
            </button>
          )}

          {/* Tab 3: Clinic Calendar */}
          <button
            onClick={() => {
              setViewMode("calendar");
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              background: viewMode === "calendar" ? "rgba(255, 255, 255, 0.15)" : "transparent",
              border: "none",
              fontSize: "12.5px",
              color: "#fcfdfe",
              fontWeight: "600",
              cursor: "pointer",
              padding: "6px 12px",
              borderRadius: "6px",
              transition: "all 0.15s ease"
            }}
          >
            <Calendar size={14} style={{ color: "var(--theme-accent)" }} />
            <span>Clinic Calendar</span>
          </button>

          {/* Tab: Bed Board */}
          <button
            onClick={() => {
              setViewMode("bed_board");
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              background: viewMode === "bed_board" ? "rgba(255, 255, 255, 0.15)" : "transparent",
              border: "none",
              fontSize: "12.5px",
              color: "#fcfdfe",
              fontWeight: "600",
              cursor: "pointer",
              padding: "6px 12px",
              borderRadius: "6px",
              transition: "all 0.15s ease"
            }}
          >
            <BedDouble size={14} style={{ color: "var(--theme-accent)" }} />
            <span>Bed Board</span>
          </button>

          {/* Tab 4: Admin Console */}
          {currentUser.role === "admin" && (
            <button
              onClick={() => {
                setViewMode("admin_console");
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                background: viewMode === "admin_console" ? "rgba(255, 255, 255, 0.15)" : "transparent",
                border: "none",
                fontSize: "12.5px",
                color: "#fcfdfe",
                fontWeight: "600",
                cursor: "pointer",
                padding: "6px 12px",
                borderRadius: "6px",
                transition: "all 0.15s ease"
              }}
            >
              <Sliders size={14} style={{ color: "var(--theme-accent)" }} />
              <span>Admin Console</span>
            </button>
          )}

          {/* Tab: Pharmacy */}
          {(currentUser.role === "admin" || currentUser.role === "pharmacy" || currentUser.role === "nurse") && (
            <button
              onClick={() => {
                setViewMode("pharmacy");
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                background: viewMode === "pharmacy" ? "rgba(255, 255, 255, 0.15)" : "transparent",
                border: "none",
                fontSize: "12.5px",
                color: "#fcfdfe",
                fontWeight: "600",
                cursor: "pointer",
                padding: "6px 12px",
                borderRadius: "6px",
                transition: "all 0.15s ease"
              }}
            >
              <Pill size={14} style={{ color: "var(--theme-accent)" }} />
              <span>Pharmacy</span>
            </button>
          )}

          {/* Tab: Dashboard (manager reports, admin only) */}
          {currentUser.role === "admin" && (
            <button
              onClick={() => {
                setViewMode("dashboard");
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                background: viewMode === "dashboard" ? "rgba(255, 255, 255, 0.15)" : "transparent",
                border: "none",
                fontSize: "12.5px",
                color: "#fcfdfe",
                fontWeight: "600",
                cursor: "pointer",
                padding: "6px 12px",
                borderRadius: "6px",
                transition: "all 0.15s ease"
              }}
            >
              <LayoutDashboard size={14} style={{ color: "var(--theme-accent)" }} />
              <span>Dashboard</span>
            </button>
          )}

          {/* Tab: Care Queue (doctor's medication/task orders, nurse's live queue) */}
          {(currentUser.role === "admin" || currentUser.role === "doctor" || currentUser.role === "nurse") && (
            <button
              onClick={() => {
                setViewMode("care_queue");
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                background: viewMode === "care_queue" ? "rgba(255, 255, 255, 0.15)" : "transparent",
                border: "none",
                fontSize: "12.5px",
                color: "#fcfdfe",
                fontWeight: "600",
                cursor: "pointer",
                padding: "6px 12px",
                borderRadius: "6px",
                transition: "all 0.15s ease"
              }}
            >
              <Syringe size={14} style={{ color: "var(--theme-accent)" }} />
              <span>Care Queue</span>
            </button>
          )}

          {/* Tab 5: My Tools Dropdown */}
          <div style={{ position: "relative" }}>
            <button
              onClick={() => {
                setIsMyToolsDropdownOpen(!isMyToolsDropdownOpen);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                background: isTemplateManagerOpen || isTestManagerOpen || isMyToolsDropdownOpen ? "rgba(255, 255, 255, 0.15)" : "transparent",
                border: "none",
                fontSize: "12.5px",
                color: "#fcfdfe",
                fontWeight: "600",
                cursor: "pointer",
                padding: "6px 12px",
                borderRadius: "6px",
                transition: "all 0.15s ease"
              }}
            >
              <Wrench size={14} style={{ color: "var(--theme-accent)" }} />
              <span>My Tools</span>
              <ChevronDown size={12} style={{ color: "var(--theme-accent)", marginLeft: "2px" }} />
            </button>

            {isMyToolsDropdownOpen && (
              <>
                {/* Click outside backdrop to close */}
                <div 
                  onClick={() => setIsMyToolsDropdownOpen(false)}
                  style={{ position: "fixed", inset: 0, zIndex: 100 }}
                />
                <div style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  marginTop: "4px",
                  background: "#fcfdfe",
                  borderRadius: "8px",
                  boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
                  border: "1px solid #dee4eb",
                  padding: "6px",
                  width: "200px",
                  zIndex: 101,
                  display: "flex",
                  flexDirection: "column",
                  gap: "2px"
                }}>
                  <div style={{ padding: "6px 8px", fontSize: "10px", fontWeight: "bold", color: "#8a96a5", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Clinical Utilities
                  </div>
                  <button
                    onClick={() => {
                      setIsTemplateManagerOpen(true);
                      setIsMyToolsDropdownOpen(false);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      background: "transparent",
                      border: "none",
                      textAlign: "left",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      fontSize: "12px",
                      fontWeight: "600",
                      color: "#2b3949",
                      cursor: "pointer",
                      width: "100%",
                      transition: "background-color 0.1s"
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "#edf1f5"}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"}
                  >
                    <FileText size={13} style={{ color: "var(--theme-accent)" }} />
                    <span>Template Manager</span>
                  </button>
                  <button
                    onClick={() => {
                      setIsTestManagerOpen(true);
                      setIsMyToolsDropdownOpen(false);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      background: "transparent",
                      border: "none",
                      textAlign: "left",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      fontSize: "12px",
                      fontWeight: "600",
                      color: "#2b3949",
                      cursor: "pointer",
                      width: "100%",
                      transition: "background-color 0.1s"
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "#edf1f5"}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"}
                  >
                    <FlaskConical size={13} style={{ color: "var(--theme-accent)" }} />
                    <span>Test Manager</span>
                  </button>
                  {(currentUser?.role === "doctor" || currentUser?.role === "admin") && (
                    <button
                      onClick={() => {
                        setIsLocationsManagerOpen(true);
                        setIsMyToolsDropdownOpen(false);
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        background: "transparent",
                        border: "none",
                        textAlign: "left",
                        padding: "8px 10px",
                        borderRadius: "6px",
                        fontSize: "12px",
                        fontWeight: "600",
                        color: "#2b3949",
                        cursor: "pointer",
                        width: "100%",
                        transition: "background-color 0.1s"
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "#edf1f5"}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "transparent"}
                    >
                      <MapPin size={13} style={{ color: "var(--theme-accent)" }} />
                      <span>My Locations</span>
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right Side: Active Workspace Indicator & Live Specialty Dropdown Switcher */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {/* Live Specialty Switcher Dropdown */}
          {currentUser?.role === "admin" && (
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              background: "rgba(255, 255, 255, 0.15)",
              borderRadius: "6px",
              padding: "4px 8px",
              height: "28px"
            }}>
              <span style={{ fontSize: "11px", color: "#fcfdfe", opacity: 0.8, fontWeight: "700" }}>Dept:</span>
              <select
                value={selectedSpecialtyIndex}
                onChange={(e) => {
                  const idx = parseInt(e.target.value, 10);
                  setSelectedSpecialtyIndex(idx);
                }}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#fcfdfe",
                  fontSize: "11px",
                  fontWeight: "700",
                  outline: "none",
                  cursor: "pointer",
                }}
              >
                {SPECIALTIES.map((sp, idx) => (
                  <option key={idx} value={idx} style={{ color: "#2b3949", background: "#fcfdfe", fontWeight: "700" }}>
                    {sp.icon} {sp.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Active Workspace Info Tab */}
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            background: "#fcfdfe",
            border: "1px solid var(--theme-accent)",
            borderBottom: "none",
            height: "30px",
            marginTop: "14px",
            padding: "0 12px",
            borderRadius: "6px 6px 0 0",
            fontSize: "11.5px",
            fontWeight: "600",
            color: "#1f2e3e",
            boxShadow: "0 -2px 5px rgba(0,0,0,0.05)"
          }}>
            <FileText size={12} style={{ color: "var(--theme-accent)" }} />
            <span>Workspace: Active Chart</span>
            <span
              title="This workspace tab is always open and can't be closed."
              style={{ marginLeft: "6px", color: "#8a96a5", cursor: "default", fontWeight: "normal", fontSize: "14px" }}
            >
              ×
            </span>
          </div>

          <div style={{ fontSize: "12px", fontWeight: "bold", color: "#fcfdfe", opacity: 0.9 }}>
            SIMA Core
          </div>
        </div>
      </div>

      {/* Mobile Nav Menu — replaces Row 2 on phone widths, opened via the hamburger button in Row 1 */}
      {isMobile && isMobileMenuOpen && (() => {
        const mobileBtn = (active: boolean): React.CSSProperties => ({
          display: "flex", alignItems: "center", gap: "10px", width: "100%",
          background: active ? "rgba(255,255,255,0.12)" : "transparent",
          border: "none", color: "#fcfdfe", fontSize: "14px", fontWeight: 600,
          cursor: "pointer", padding: "12px 10px", borderRadius: "8px", textAlign: "left",
        });
        const go = (mode: typeof viewMode) => { setViewMode(mode); setIsMobileMenuOpen(false); };
        return (
          <>
            <div onClick={() => setIsMobileMenuOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 200 }} />
            <div style={{
              position: "fixed", top: 0, left: 0, bottom: 0, width: "80vw", maxWidth: "300px",
              background: "#1f2e3e", zIndex: 201, boxShadow: "4px 0 24px rgba(0,0,0,0.3)",
              display: "flex", flexDirection: "column", padding: "14px 10px", gap: "3px", overflowY: "auto",
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 8px 14px" }}>
                <SimaLogo size="sm" withContainer={false} darkBackground={true} />
                <button onClick={() => setIsMobileMenuOpen(false)} aria-label="Close menu" style={{ background: "none", border: "none", color: "#8a96a5", cursor: "pointer", padding: "4px" }}>
                  <X size={18} />
                </button>
              </div>
              <div style={{ padding: "0 10px 14px", fontSize: "11.5px", color: "#8a96a5" }}>
                <span style={{ textTransform: "uppercase", fontWeight: 700, color: "var(--theme-accent)" }}>{currentUser.role}</span> — {currentUser.name}
              </div>

              {currentUser.role !== "secretary" && (
                <button style={mobileBtn(viewMode === "patients")} onClick={() => go("patients")}>
                  <Users size={16} style={{ color: "var(--theme-accent)" }} /> Patient Registry
                </button>
              )}
              {SHOW_DOCUMENT_EXTRACTOR_TAB && (
                <button style={mobileBtn(viewMode === "extractor")} onClick={() => go("extractor")}>
                  <FileText size={16} style={{ color: "var(--theme-accent)" }} /> Document Extractor
                </button>
              )}
              <button style={mobileBtn(viewMode === "calendar")} onClick={() => go("calendar")}>
                <Calendar size={16} style={{ color: "var(--theme-accent)" }} /> Clinic Calendar
              </button>
              <button style={mobileBtn(viewMode === "bed_board")} onClick={() => go("bed_board")}>
                <BedDouble size={16} style={{ color: "var(--theme-accent)" }} /> Bed Board
              </button>
              {currentUser.role === "admin" && (
                <button style={mobileBtn(viewMode === "admin_console")} onClick={() => go("admin_console")}>
                  <Sliders size={16} style={{ color: "var(--theme-accent)" }} /> Admin Console
                </button>
              )}
              {(currentUser.role === "admin" || currentUser.role === "pharmacy" || currentUser.role === "nurse") && (
                <button style={mobileBtn(viewMode === "pharmacy")} onClick={() => go("pharmacy")}>
                  <Pill size={16} style={{ color: "var(--theme-accent)" }} /> Pharmacy
                </button>
              )}
              {currentUser.role === "admin" && (
                <button style={mobileBtn(viewMode === "dashboard")} onClick={() => go("dashboard")}>
                  <LayoutDashboard size={16} style={{ color: "var(--theme-accent)" }} /> Dashboard
                </button>
              )}
              {(currentUser.role === "admin" || currentUser.role === "doctor" || currentUser.role === "nurse") && (
                <button style={mobileBtn(viewMode === "care_queue")} onClick={() => go("care_queue")}>
                  <Syringe size={16} style={{ color: "var(--theme-accent)" }} /> Care Queue
                </button>
              )}

              <div style={{ borderTop: "1px solid rgba(255,255,255,0.12)", margin: "10px 4px", paddingTop: "10px", fontSize: "10px", fontWeight: 700, color: "#8a96a5", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Clinical Utilities
              </div>
              <button style={mobileBtn(false)} onClick={() => { setIsTemplateManagerOpen(true); setIsMobileMenuOpen(false); }}>
                <FileText size={16} style={{ color: "var(--theme-accent)" }} /> Template Manager
              </button>
              <button style={mobileBtn(false)} onClick={() => { setIsTestManagerOpen(true); setIsMobileMenuOpen(false); }}>
                <FlaskConical size={16} style={{ color: "var(--theme-accent)" }} /> Test Manager
              </button>
              {(currentUser.role === "doctor" || currentUser.role === "admin") && (
                <button style={mobileBtn(false)} onClick={() => { setIsLocationsManagerOpen(true); setIsMobileMenuOpen(false); }}>
                  <MapPin size={16} style={{ color: "var(--theme-accent)" }} /> My Locations
                </button>
              )}

              {currentUser.role === "admin" && (
                <>
                  <div style={{ borderTop: "1px solid rgba(255,255,255,0.12)", margin: "10px 4px", paddingTop: "10px", fontSize: "10px", fontWeight: 700, color: "#8a96a5", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Department
                  </div>
                  <select
                    value={selectedSpecialtyIndex}
                    onChange={(e) => setSelectedSpecialtyIndex(parseInt(e.target.value, 10))}
                    style={{ margin: "0 10px", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.2)", color: "#fcfdfe", fontSize: "13px", fontWeight: 600, borderRadius: "8px", padding: "10px" }}
                  >
                    {SPECIALTIES.map((sp, idx) => (
                      <option key={idx} value={idx} style={{ color: "#2b3949", background: "#fcfdfe" }}>{sp.icon} {sp.label}</option>
                    ))}
                  </select>
                </>
              )}

              <div style={{ marginTop: "auto", borderTop: "1px solid rgba(255,255,255,0.12)", paddingTop: "10px" }}>
                <button style={{ ...mobileBtn(false), color: "#db7a78" }} onClick={() => { handleLogout(); setIsMobileMenuOpen(false); }}>
                  <LogOut size={16} /> Log Out
                </button>
              </div>
            </div>
          </>
        );
      })()}


      {/* Main content */}
      {viewMode === "calendar" ? (
        <main style={{ flex: 1, maxWidth: "100%", width: "100%", padding: isMobile ? "12px" : "24px 32px" }}>
          <ClinicCalendar onLoadReport={handleLoadPresetFromCalendar} />
        </main>
      ) : viewMode === "patients" ? (
        <main style={{ flex: 1, maxWidth: "100%", width: "100%", padding: 0 }}>
          <PatientsDirectory 
            externalSearchQuery={globalSearchQuery} 
            onClearExternalSearch={() => setGlobalSearchQuery("")} 
            currentUser={currentUser}
          />
        </main>
      ) : viewMode === "admin_console" ? (
        <main style={{ flex: 1, maxWidth: "100%", width: "100%", padding: isMobile ? "12px" : "24px 32px" }}>
          <AdminConsole currentUser={currentUser} />
        </main>
      ) : viewMode === "pharmacy" ? (
        <main style={{ flex: 1, maxWidth: "100%", width: "100%", padding: isMobile ? "12px" : "24px 32px" }}>
          <PharmacyManager currentUser={currentUser} />
        </main>
      ) : viewMode === "dashboard" ? (
        <main style={{ flex: 1, maxWidth: "100%", width: "100%", padding: isMobile ? "12px" : "24px 32px" }}>
          <DashboardManager currentUser={currentUser} />
        </main>
      ) : viewMode === "care_queue" ? (
        <main style={{ flex: 1, maxWidth: "100%", width: "100%", padding: isMobile ? "12px" : "24px 32px" }}>
          <CareQueue currentUser={currentUser} />
        </main>
      ) : viewMode === "bed_board" ? (
        <main style={{ flex: 1, maxWidth: "100%", width: "100%", padding: isMobile ? "12px" : "24px 32px" }}>
          <BedBoard currentUser={currentUser} />
        </main>
      ) : (
        <main style={{ flex: 1, maxWidth: "100%", width: "100%", padding: isMobile ? "12px" : "24px 32px", display: "grid", gridTemplateColumns: isMobile ? "1fr" : "380px 1fr", gap: isMobile ? "12px" : "24px" }}>

          {/* LEFT: Controls */}
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>

            {/* Presets */}
            <div style={{ background: "#fcfdfe", border: "0.5px solid #dee4eb", borderRadius: "10px", padding: "16px" }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: "5px", background: "var(--theme-accent-bg)", border: "0.5px solid var(--theme-accent)", borderRadius: "6px", padding: "3px 8px", marginBottom: "10px" }}>
                <BookOpen size={10} style={{ color: "var(--theme-accent-dark)" }} />
                <span style={{ fontSize: "10px", fontWeight: 700, color: "var(--theme-accent-dark)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Demo presets</span>
              </div>
              <h3 style={{ fontSize: "13px", fontWeight: 600, color: "#26313e", margin: "0 0 4px" }}>Instant extraction sandbox</h3>
              <p style={{ fontSize: "12px", color: "#5d6b7c", margin: "0 0 12px", lineHeight: 1.5 }}>Load a clinical record to evaluate parsing and structure mapping.</p>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {CLINICAL_PRESETS.map(preset => {
                  const isSelected = activePreset?.id === preset.id;
                  return (
                    <button key={preset.id} onClick={() => handleLoadPreset(preset)} style={{
                      padding: "10px 12px", borderRadius: "8px", border: `0.5px solid ${isSelected ? "var(--theme-accent)" : "#dee4eb"}`,
                      background: isSelected ? "var(--theme-accent-bg)" : "#f6f8fa", cursor: "pointer", textAlign: "left",
                      display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px",
                    }}>
                      <div>
                        <div style={{ fontSize: "12px", fontWeight: 600, color: "#26313e", marginBottom: "2px" }}>{preset.name}</div>
                        <div style={{ fontSize: "11px", color: "#5d6b7c", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "240px" }}>{preset.description}</div>
                      </div>
                      <span style={{ fontSize: "10px", background: "#edf1f5", border: "0.5px solid #dee4eb", borderRadius: "4px", padding: "2px 6px", color: "#5d6b7c", flexShrink: 0, fontFamily: "monospace" }}>{preset.type}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Input */}
            <div style={{ background: "#fcfdfe", border: "0.5px solid #dee4eb", borderRadius: "10px", padding: "16px", flex: 1, display: "flex", flexDirection: "column" }}>
              <h3 style={{ fontSize: "12px", fontWeight: 600, color: "#3c4b5c", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 12px" }}>Document input</h3>
              <form onSubmit={triggerAnalysis} style={{ flex: 1, display: "flex", flexDirection: "column", gap: "10px" }}>

                {/* Drop zone */}
                <div
                  onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={e => { e.preventDefault(); setIsDragging(false); const f = e.dataTransfer.files?.[0]; if (f) processSelectedFile(f); }}
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    border: `1.5px dashed ${isDragging ? "var(--theme-accent)" : uploadedFile ? "#438a6a" : "#c9d2dc"}`,
                    borderRadius: "8px", padding: "20px 16px", cursor: "pointer", textAlign: "center",
                    background: isDragging ? "var(--theme-accent-bg)" : uploadedFile ? "#e7f2ec" : "#f6f8fa",
                  }}
                >
                  <input type="file" ref={fileInputRef} onChange={e => { const f = e.target.files?.[0]; if (f) processSelectedFile(f); }} accept="image/png,image/jpeg,image/jpg,application/pdf,text/plain" style={{ display: "none" }} />
                  {uploadedFile ? (
                    <>
                      <CheckCircle size={18} color="#438a6a" style={{ margin: "0 auto 6px" }} />
                      <div style={{ fontSize: "12px", fontWeight: 600, color: "#26313e" }}>{uploadedFile.name}</div>
                      <div style={{ fontSize: "11px", color: "#8a96a5", marginTop: "2px" }}>{(uploadedFile.size / 1024).toFixed(1)} KB</div>
                      <button type="button" onClick={e => { e.stopPropagation(); setUploadedFile(null); setFileBase64(null); setFileMimeType(null); }} style={{ fontSize: "11px", color: "#c05654", background: "none", border: "none", cursor: "pointer", marginTop: "6px" }}>Remove</button>
                    </>
                  ) : (
                    <>
                      <Upload size={18} color="#8a96a5" style={{ margin: "0 auto 6px" }} />
                      <div style={{ fontSize: "12px", fontWeight: 500, color: "#3c4b5c" }}>Drop a file or click to upload</div>
                      <div style={{ fontSize: "11px", color: "#8a96a5", marginTop: "2px" }}>Images, PDFs, lab outputs up to 15MB</div>
                    </>
                  )}
                </div>

                {/* Camera capture -- launches the phone's camera directly on mobile */}
                <input
                  type="file"
                  ref={cameraInputRef}
                  onChange={e => { const f = e.target.files?.[0]; if (f) processSelectedFile(f); }}
                  accept="image/*"
                  capture="environment"
                  style={{ display: "none" }}
                />
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
                    padding: "9px", borderRadius: "8px", border: "0.5px solid #dee4eb",
                    background: "#f6f8fa", fontSize: "12px", fontWeight: 500, color: "#3c4b5c", cursor: "pointer",
                  }}
                >
                  <Camera size={15} color="#4a7ba6" />
                  Take a photo of the lab document
                </button>

                {/* Divider */}
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <div style={{ flex: 1, height: "0.5px", background: "#dee4eb" }} />
                  <span style={{ fontSize: "10px", color: "#8a96a5", textTransform: "uppercase", letterSpacing: "0.08em" }}>or paste text</span>
                  <div style={{ flex: 1, height: "0.5px", background: "#dee4eb" }} />
                </div>

                <textarea
                  placeholder="Paste hematology results, radiology notes, or doctor observations..."
                  value={textData}
                  onChange={e => { setTextData(e.target.value); if (activePreset && e.target.value !== activePreset.rawText) setActivePreset(null); }}
                  style={{ flex: 1, minHeight: "120px", padding: "10px", border: "0.5px solid #dee4eb", borderRadius: "8px", fontSize: "12px", color: "#3c4b5c", outline: "none", resize: "none", fontFamily: "monospace", background: "#f6f8fa" }}
                />

                <button
                  type="submit"
                  disabled={isLoading || (!uploadedFile && !textData.trim() && !activePreset)}
                  style={{
                    padding: "10px", borderRadius: "8px", border: "none", fontSize: "13px", fontWeight: 600,
                    cursor: isLoading || (!uploadedFile && !textData.trim() && !activePreset) ? "not-allowed" : "pointer",
                    background: isLoading || (!uploadedFile && !textData.trim() && !activePreset) ? "#dee4eb" : "var(--theme-accent)",
                    color: isLoading || (!uploadedFile && !textData.trim() && !activePreset) ? "#8a96a5" : "#fcfdfe",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
                  }}
                >
                  {isLoading ? <><Activity size={14} style={{ animation: "pulse 1s infinite" }} /> Extracting...</> : <><Sparkles size={14} /> Launch extraction pipeline</>}
                </button>
              </form>
            </div>
          </div>

          {/* RIGHT: Results */}
          <div style={{ display: "flex", flexDirection: "column", minHeight: "500px" }}>

            {/* Idle */}
            {!resultData && !isLoading && !errorString && (
              <div style={{ flex: 1, background: "#fcfdfe", border: "0.5px solid #dee4eb", borderRadius: "10px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "48px 24px", textAlign: "center" }}>
                <div style={{ width: "56px", height: "56px", borderRadius: "50%", background: "#edf1f5", border: "0.5px solid #dee4eb", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "16px", position: "relative" }}>
                  <Database size={24} color="#5d6b7c" />
                  <span style={{ position: "absolute", top: "4px", right: "4px", width: "10px", height: "10px", background: "var(--theme-accent)", borderRadius: "50%", border: "2px solid #fcfdfe" }} />
                </div>
                <h3 style={{ fontSize: "15px", fontWeight: 600, color: "#26313e", margin: "0 0 8px" }}>Awaiting medical input</h3>
                <p style={{ fontSize: "13px", color: "#5d6b7c", maxWidth: "340px", lineHeight: 1.6, margin: "0 0 24px" }}>
                  Load a preset or upload a clinical document on the left to run the extraction pipeline.
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", width: "100%", maxWidth: "400px" }}>
                  {[
                    { icon: <Layers size={14} />, label: "Parameter filter", desc: "Checks measurements against reference bounds." },
                    { icon: <AlertCircle size={14} />, label: "Pathology alerts", desc: "Flags critical findings and suspicious values." },
                  ].map(item => (
                    <div key={item.label} style={{ padding: "12px", background: "#f6f8fa", border: "0.5px solid #dee4eb", borderRadius: "8px", textAlign: "left" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#3c4b5c", fontWeight: 600, fontSize: "12px", marginBottom: "4px" }}>{item.icon} {item.label}</div>
                      <p style={{ fontSize: "11px", color: "#5d6b7c", margin: 0, lineHeight: 1.5 }}>{item.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Loading */}
            {isLoading && (
              <div style={{ flex: 1, background: "#fcfdfe", border: "0.5px solid #dee4eb", borderRadius: "10px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "48px 24px", textAlign: "center" }}>
                <div style={{ width: "52px", height: "52px", borderRadius: "50%", background: "#4a7ba6", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "20px" }}>
                  <Activity size={22} color="#fcfdfe" />
                </div>
                <h3 style={{ fontSize: "15px", fontWeight: 600, color: "#26313e", margin: "0 0 10px" }}>Parsing medical document</h3>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "#f6f8fa", border: "0.5px solid #dee4eb", borderRadius: "20px", padding: "8px 16px" }}>
                  <Clock size={13} color="#4a7ba6" />
                  <span style={{ fontSize: "12px", color: "#3c4b5c", fontFamily: "monospace" }}>{loadingMessages[loadingMessageIndex]}</span>
                </div>
                <div style={{ marginTop: "24px", padding: "14px 20px", background: "#f6f8fa", border: "0.5px solid #dee4eb", borderRadius: "8px", width: "100%", maxWidth: "280px", textAlign: "left" }}>
                  {[["File read stream", "OK"], ["SSL handshake", "DONE"], ["Claude model route", "LIVE"]].map(([k, v]) => (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", fontFamily: "monospace", color: "#5d6b7c", marginBottom: "6px" }}>
                      <span>{k}</span>
                      <span style={{ color: v === "LIVE" ? "#4a7ba6" : "#438a6a", fontWeight: 700 }}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Error */}
            {errorString && !isLoading && (
              <div style={{ flex: 1, background: "#fcfdfe", border: "0.5px solid #e7bcbc", borderRadius: "10px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "48px 24px", textAlign: "center" }}>
                <div style={{ width: "48px", height: "48px", borderRadius: "50%", background: "#f9ecec", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "16px" }}>
                  <AlertCircle size={22} color="#c05654" />
                </div>
                <h3 style={{ fontSize: "15px", fontWeight: 600, color: "#26313e", margin: "0 0 8px" }}>Extraction failed</h3>
                <p style={{ fontSize: "13px", color: "#5d6b7c", maxWidth: "380px", lineHeight: 1.6, margin: "0 0 20px" }}>{errorString}</p>
                {isConfigError && (
                  <div style={{ background: "#f6f8fa", border: "0.5px solid #dee4eb", borderRadius: "8px", padding: "14px 16px", maxWidth: "380px", textAlign: "left", marginBottom: "16px" }}>
                    <div style={{ fontSize: "12px", fontWeight: 600, color: "#3c4b5c", marginBottom: "6px" }}>Set up your Claude API key</div>
                    <p style={{ fontSize: "12px", color: "#5d6b7c", margin: 0, lineHeight: 1.5 }}>Add <code style={{ background: "#edf1f5", padding: "1px 5px", borderRadius: "4px", fontFamily: "monospace" }}>ANTHROPIC_API_KEY</code> to your .env.local file, then restart the server.</p>
                  </div>
                )}
                <button onClick={handleReset} style={{ padding: "8px 20px", background: "#26313e", border: "none", borderRadius: "8px", color: "#fcfdfe", fontSize: "13px", fontWeight: 500, cursor: "pointer" }}>
                  Clear and retry
                </button>
              </div>
            )}

            {/* Results */}
            {resultData && !isLoading && !errorString && (
              <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                <ReportDashboard data={resultData} />
              </div>
            )}
          </div>
        </main>
      )}

      {/* Footer */}
      <footer style={{ background: "#fcfdfe", borderTop: "0.5px solid #dee4eb", padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: "11px", color: "#8a96a5", fontFamily: "monospace" }}>SIMA · Smart Integrated Medical Archive · Secure Proxy</span>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "#438a6a", background: "#e7f2ec", border: "0.5px solid #b5d6c5", borderRadius: "20px", padding: "4px 10px" }}>
          <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#438a6a", display: "inline-block" }} />
          HIPAA-structured exchanges ready
        </div>
      </footer>
    </div>
    
    <TemplateManager 
      isOpen={isTemplateManagerOpen} 
      onClose={() => setIsTemplateManagerOpen(false)} 
      currentUser={currentUser}
    />

    <TestManager
      isOpen={isTestManagerOpen}
      onClose={() => setIsTestManagerOpen(false)}
      currentUser={currentUser}
    />

    <LocationsManager
      isOpen={isLocationsManagerOpen}
      onClose={() => setIsLocationsManagerOpen(false)}
      currentUser={currentUser}
    />
    </VisitNotesProvider>
  );
}
