import { useState } from "react";
import { CalendarDays, ChevronDown, FileText, FlaskConical, LogOut, MapPin, Users, Wrench } from "lucide-react";
import SignIn from "./components/SignIn";
import PatientsDirectory from "./components/PatientsDirectory";
import Appointments from "./components/Appointments";
import { VisitNotesProvider } from "./components/VisitNotesManager";
import TemplateManager from "./components/TemplateManager";
import TestManager from "./components/TestManager";
import LocationsManager from "./components/LocationsManager";
import { UserSession } from "./types";

type ViewMode = "patients" | "appointments";

export default function App() {
  const [currentUser, setCurrentUser] = useState<UserSession | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("patients");
  const [isMyToolsOpen, setIsMyToolsOpen] = useState(false);
  const [isTemplateManagerOpen, setIsTemplateManagerOpen] = useState(false);
  const [isTestManagerOpen, setIsTestManagerOpen] = useState(false);
  const [isLocationsManagerOpen, setIsLocationsManagerOpen] = useState(false);

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
              onClick={() => setCurrentUser(null)}
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
                </div>
              </>
            )}
          </div>
        </div>

        {/* Page container */}
        <main className="flex-1">
          {viewMode === "patients" && <PatientsDirectory currentUser={currentUser} />}
          {viewMode === "appointments" && <Appointments currentUser={currentUser} />}
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
    </VisitNotesProvider>
  );
}
