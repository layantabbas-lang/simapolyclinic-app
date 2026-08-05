import { useEffect, useState } from "react";
import { CalendarDays, ChevronDown, FileText, FlaskConical, LayoutDashboard, LogOut, MapPin, Receipt, UserCog, Users, Wrench } from "lucide-react";
import SignIn from "./components/SignIn";
import ResetPassword from "./components/ResetPassword";
import Dashboard from "./components/Dashboard";
import PatientsDirectory from "./components/PatientsDirectory";
import Appointments from "./components/Appointments";
import Billing from "./components/Billing";
import { VisitNotesProvider } from "./components/VisitNotesManager";
import TemplateManager from "./components/TemplateManager";
import TestManager from "./components/TestManager";
import LocationsManager from "./components/LocationsManager";
import StaffManager from "./components/StaffManager";
import { restoreSession } from "./authSession";
import { isConfigured, supabase } from "./supabaseClient";
import { UserSession } from "./types";

type ViewMode = "dashboard" | "patients" | "appointments" | "billing";

export default function App() {
  const [currentUser, setCurrentUser] = useState<UserSession | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("dashboard");
  const [isMyToolsOpen, setIsMyToolsOpen] = useState(false);
  const [isTemplateManagerOpen, setIsTemplateManagerOpen] = useState(false);
  const [isTestManagerOpen, setIsTestManagerOpen] = useState(false);
  const [isLocationsManagerOpen, setIsLocationsManagerOpen] = useState(false);
  const [isStaffManagerOpen, setIsStaffManagerOpen] = useState(false);
  // Set when the Dashboard asks to open a chart; cleared once
  // PatientsDirectory has actually selected that patient.
  const [pendingPatientId, setPendingPatientId] = useState<string | null>(null);

  useEffect(() => {
    restoreSession()
      .then(setCurrentUser)
      .finally(() => setIsCheckingSession(false));
  }, []);

  // Clicking the password-reset link in the email lands back here with a
  // recovery token; Supabase's client picks it up automatically and fires
  // this event instead of a normal sign-in.
  useEffect(() => {
    if (!isConfigured) return;
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setIsPasswordRecovery(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const handleLogout = async () => {
    if (isConfigured) {
      await supabase.auth.signOut();
    }
    setCurrentUser(null);
  };

  if (isCheckingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <img src="/sima-logo-dark.png" alt="SIMA" className="h-6 w-auto opacity-60 animate-pulse" />
      </div>
    );
  }

  if (isPasswordRecovery) {
    return (
      <ResetPassword
        onDone={() => {
          restoreSession().then(setCurrentUser);
          setIsPasswordRecovery(false);
        }}
      />
    );
  }

  if (!currentUser) {
    return <SignIn onLoginSuccess={setCurrentUser} />;
  }

  return (
    <VisitNotesProvider>
      <div className="min-h-screen flex flex-col bg-slate-50 font-sans">
        {/* Top bar */}
        <header
          className="h-12 flex items-center justify-between px-4"
          style={{ background: "#1f2e3e", borderBottom: "1.5px solid var(--theme-accent)" }}
        >
          <div className="flex items-center gap-1.5">
            <img src="/sima-logo-light.png" alt="SIMA" className="h-4 w-auto" />
            <span className="text-white font-semibold text-sm">-Polyclinic</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-slate-300">
              <span className="uppercase font-bold" style={{ color: "var(--theme-accent)" }}>{currentUser.role}</span>
              {" "}— {currentUser.name}
            </span>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1 text-[11px] font-semibold"
              style={{ color: "#db7a78" }}
            >
              <LogOut size={12} /> Log Out
            </button>
          </div>
        </header>

        {/* Nav / My Tools bar — mirrors SIMA's workspace tab row */}
        <div
          className="h-11 flex items-center gap-1 px-4"
          style={{ background: "var(--theme-accent-dark)" }}
        >
          <button
            onClick={() => setViewMode("dashboard")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold"
            style={{
              background: viewMode === "dashboard" ? "rgba(255,255,255,0.15)" : "transparent",
              color: "#fcfdfe",
            }}
          >
            <LayoutDashboard size={14} style={{ color: "var(--theme-accent)" }} />
            Dashboard
          </button>
          <button
            onClick={() => setViewMode("patients")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold"
            style={{
              background: viewMode === "patients" ? "rgba(255,255,255,0.15)" : "transparent",
              color: "#fcfdfe",
            }}
          >
            <Users size={14} style={{ color: "var(--theme-accent)" }} />
            Patients
          </button>
          <button
            onClick={() => setViewMode("appointments")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold"
            style={{
              background: viewMode === "appointments" ? "rgba(255,255,255,0.15)" : "transparent",
              color: "#fcfdfe",
            }}
          >
            <CalendarDays size={14} style={{ color: "var(--theme-accent)" }} />
            Appointments
          </button>
          <button
            onClick={() => setViewMode("billing")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold"
            style={{
              background: viewMode === "billing" ? "rgba(255,255,255,0.15)" : "transparent",
              color: "#fcfdfe",
            }}
          >
            <Receipt size={14} style={{ color: "var(--theme-accent)" }} />
            Billing
          </button>
          <div className="relative">
            <button
              onClick={() => setIsMyToolsOpen((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold"
              style={{
                background: isMyToolsOpen || isTemplateManagerOpen || isTestManagerOpen || isLocationsManagerOpen
                  ? "rgba(255,255,255,0.15)" : "transparent",
                color: "#fcfdfe",
              }}
            >
              <Wrench size={14} style={{ color: "var(--theme-accent)" }} />
              My Tools
              <ChevronDown size={12} style={{ color: "var(--theme-accent)" }} />
            </button>

            {isMyToolsOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setIsMyToolsOpen(false)} />
                <div className="absolute top-full left-0 mt-1 w-52 bg-white border border-slate-200 rounded-lg shadow-xl z-50 p-1.5 flex flex-col gap-0.5">
                  <div className="px-2 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Clinical Utilities
                  </div>
                  <button
                    onClick={() => { setIsTemplateManagerOpen(true); setIsMyToolsOpen(false); }}
                    className="flex items-center gap-2 px-2.5 py-2 rounded-md text-xs font-semibold text-slate-700 hover:bg-slate-100 text-left"
                  >
                    <FileText size={13} style={{ color: "var(--theme-accent)" }} /> Template Manager
                  </button>
                  <button
                    onClick={() => { setIsTestManagerOpen(true); setIsMyToolsOpen(false); }}
                    className="flex items-center gap-2 px-2.5 py-2 rounded-md text-xs font-semibold text-slate-700 hover:bg-slate-100 text-left"
                  >
                    <FlaskConical size={13} style={{ color: "var(--theme-accent)" }} /> Test Manager
                  </button>
                  <button
                    onClick={() => { setIsLocationsManagerOpen(true); setIsMyToolsOpen(false); }}
                    className="flex items-center gap-2 px-2.5 py-2 rounded-md text-xs font-semibold text-slate-700 hover:bg-slate-100 text-left"
                  >
                    <MapPin size={13} style={{ color: "var(--theme-accent)" }} /> My Locations
                  </button>
                  {currentUser.role === "admin" && (
                    <>
                      <div className="px-2 pt-1.5 pb-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-t border-slate-100 mt-0.5">
                        Admin
                      </div>
                      <button
                        onClick={() => { setIsStaffManagerOpen(true); setIsMyToolsOpen(false); }}
                        className="flex items-center gap-2 px-2.5 py-2 rounded-md text-xs font-semibold text-slate-700 hover:bg-slate-100 text-left"
                      >
                        <UserCog size={13} style={{ color: "var(--theme-accent)" }} /> Staff
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Page container */}
        <main className="flex-1">
          {viewMode === "dashboard" && (
            <Dashboard
              currentUser={currentUser}
              onOpenPatient={(patientId) => {
                setPendingPatientId(patientId);
                setViewMode("patients");
              }}
            />
          )}
          {viewMode === "patients" && (
            <PatientsDirectory
              currentUser={currentUser}
              openPatientId={pendingPatientId}
              onOpenedPatient={() => setPendingPatientId(null)}
            />
          )}
          {viewMode === "appointments" && <Appointments currentUser={currentUser} />}
          {viewMode === "billing" && <Billing currentUser={currentUser} />}
        </main>
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
      <StaffManager
        isOpen={isStaffManagerOpen}
        onClose={() => setIsStaffManagerOpen(false)}
        currentUser={currentUser}
      />
    </VisitNotesProvider>
  );
}
