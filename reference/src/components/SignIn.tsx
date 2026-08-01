import React, { useState, useEffect } from "react";
import { ArrowRight, Eye, EyeOff, Database, FlaskConical, CalendarClock, ShieldCheck } from "lucide-react";
import { supabase } from "../supabaseClient";

export interface UserSession {
  id?: string;
  username: string;
  name: string;
  role: "secretary" | "doctor" | "admin" | "pharmacy" | "nurse";
}

export const normalizeRole = (roleStr: string): "secretary" | "doctor" | "admin" | "pharmacy" | "nurse" => {
  const r = roleStr?.trim().toLowerCase();
  if (r === "doctor" || r === "physician") return "doctor";
  if (r === "admin" || r === "administrator") return "admin";
  if (r === "pharmacy" || r === "pharmacist") return "pharmacy";
  if (r === "nurse") return "nurse";
  return "secretary";
};

export const SPECIALTIES = [
  {
    label: "Cardiology",
    icon: "🫀",
    bg: "linear-gradient(135deg, #1a0a2e, #6b1f6b, #c0392b)",
    accent: "#9E4160",
    accentBg: "#F5E8EC",
    accentDark: "#7C2F4A",
    name: "Cardiology\nDepartment",
    desc: "Comprehensive cardiac care platform. Monitor vitals, ECGs, and manage complex heart failure cases with real-time team collaboration.",
    facts: [
      { icon: "💓", title: "Live ECG sync", text: "Real-time cardiac monitoring feeds" },
      { icon: "📊", title: "Risk stratification", text: "GRACE & TIMI score calculators" },
      { icon: "💊", title: "Anticoag tracker", text: "INR logs and dose adjustment tools" }
    ]
  },
  {
    label: "Geriatrics",
    icon: "🌿",
    bg: "linear-gradient(135deg, #0a1f0f, #1a4a2a, #2d7a4f)",
    accent: "#3E7D5C",
    accentBg: "#E3F0E9",
    accentDark: "#2F6146",
    name: "Geriatric\nMedicine",
    desc: "Holistic elder care management. Track cognitive assessments, fall risk, polypharmacy reviews, and functional decline over time.",
    facts: [
      { icon: "🧠", title: "Cognitive screening", text: "MMSE, MoCA, and CDR integrated" },
      { icon: "🏠", title: "Home assessment", text: "ADL/IADL and home modification tools" },
      { icon: "💊", title: "Polypharmacy review", text: "Beers Criteria alerts and deprescribing" }
    ]
  },
  {
    label: "Endocrinology",
    icon: "⚗️",
    bg: "linear-gradient(135deg, #1a1400, #4a3200, #8a6000)",
    accent: "#9A6B24",
    accentBg: "#F7EEDD",
    accentDark: "#7A5318",
    name: "Endocrinology\nDepartment",
    desc: "Metabolic and hormonal disorder management. Track HbA1c trends, thyroid panels, and insulin protocols across your patient cohort.",
    facts: [
      { icon: "📈", title: "HbA1c trends", text: "Longitudinal glucose and metabolic panels" },
      { icon: "🩺", title: "Thyroid tracker", text: "TSH, T3, T4 with trend visualization" },
      { icon: "💉", title: "Insulin protocols", text: "Basal-bolus titration and pump logs" }
    ]
  },
  {
    label: "Neurology",
    icon: "🧠",
    bg: "linear-gradient(135deg, #0d0a1f, #2a1a5a, #4a2a9a)",
    accent: "#6B5AA8",
    accentBg: "#ECE9F6",
    accentDark: "#52428A",
    name: "Neurology\nDepartment",
    desc: "Neurological care from stroke to Parkinson's. Document EEG findings, movement disorder scales, and cognitive trajectories in one place.",
    facts: [
      { icon: "⚡", title: "Seizure logs", text: "Episode frequency and trigger tracking" },
      { icon: "🎯", title: "Stroke protocol", text: "NIHSS scoring and tPA eligibility" },
      { icon: "🔬", title: "MRI integration", text: "Link imaging reports to patient notes" }
    ]
  },
  {
    label: "Orthopedics",
    icon: "🦴",
    bg: "linear-gradient(135deg, #0f1520, #1a3050, #1a5080)",
    accent: "#33608D",
    accentBg: "#DEE9F3",
    accentDark: "#2A5178",
    name: "Orthopedics\nDepartment",
    desc: "Musculoskeletal care and surgical planning. Manage pre-op assessments, post-surgical rehab plans, and implant tracking seamlessly.",
    facts: [
      { icon: "🏋️", title: "Rehab protocols", text: "PT/OT plan templates and progress logs" },
      { icon: "🩻", title: "Imaging review", text: "X-ray and MRI report linking" },
      { icon: "📋", title: "Pre-op checklist", text: "Surgical clearance workflow builder" }
    ]
  },
  {
    label: "Pulmonology",
    icon: "🫁",
    bg: "linear-gradient(135deg, #101b26, #1b344e, #2a5178)",
    accent: "#2E7D80",
    accentBg: "#E1F0F0",
    accentDark: "#226061",
    name: "Pulmonology\nDepartment",
    desc: "Respiratory care from COPD to sleep medicine. Track spirometry trends, oxygen therapy, and ventilator settings across your caseload.",
    facts: [
      { icon: "💨", title: "Spirometry trends", text: "FEV1/FVC longitudinal tracking" },
      { icon: "😴", title: "Sleep studies", text: "AHI logs and CPAP compliance data" },
      { icon: "🫧", title: "ABG tracker", text: "Arterial blood gas panel history" }
    ]
  }
];

interface SignInProps {
  onLoginSuccess: (session: UserSession) => void;
}

const ACCENT = "#0d9488";
const ACCENT_DARK = "#0b6e66";
const ACCENT_BG = "#e6f4f2";
const INK = "#16202b";

const FEATURES = [
  { Icon: Database, title: "Unified patient archive", text: "Records, labs and history in one chart" },
  { Icon: FlaskConical, title: "Smart lab extraction", text: "Documents become structured, trendable results" },
  { Icon: CalendarClock, title: "Integrated operations", text: "Scheduling, orders and pharmacy in one flow" },
  { Icon: ShieldCheck, title: "Secure by design", text: "Role-based access to encrypted records" }
];

export default function SignIn({ onLoginSuccess }: SignInProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [dbStatus, setDbStatus] = useState<"connected" | "mock">("connected");

  const [forgotMode, setForgotMode] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetSent, setResetSent] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [isSendingReset, setIsSendingReset] = useState(false);

  useEffect(() => {
    const testDb = async () => {
      try {
        const { error } = await supabase.from("profiles").select("id").limit(1);
        setDbStatus(error?.message?.includes("missing") ? "mock" : "connected");
      } catch {
        setDbStatus("mock");
      }
    };
    testDb();
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!username.trim() || !password) {
      setError("Please enter your email and password.");
      return;
    }
    setIsLoading(true);

    try {
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: username.trim(),
        password,
      });

      if (authError || !authData?.user) {
        throw authError || new Error("Sign in failed.");
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", authData.user.id)
        .single();

      if (profileError) {
        console.warn("Signed in but couldn't load profile record:", profileError.message);
      }

      const resolvedRole = normalizeRole(profile?.role || "secretary");
      const fullName = profile?.full_name || authData.user.user_metadata?.full_name || username.split("@")[0];

      onLoginSuccess({
        id: authData.user.id,
        username: authData.user.email || username,
        name: fullName,
        role: resolvedRole,
      });
    } catch (err: any) {
      setError(err.message || "Invalid email or password.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetError(null);

    if (!resetEmail.trim()) {
      setResetError("Please enter your account email.");
      return;
    }
    setIsSendingReset(true);
    try {
      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(resetEmail.trim(), {
        redirectTo: window.location.origin,
      });
      if (resetErr) throw resetErr;
      setResetSent(true);
    } catch (err: any) {
      setResetError(err.message || "Could not send reset email. Please try again.");
    } finally {
      setIsSendingReset(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    border: "1px solid #dee4eb",
    borderRadius: "9px",
    padding: "9px 13px",
    fontSize: "13px",
    color: INK,
    background: "#f6f8fa",
    outline: "none"
  };

  const focusInput = (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.style.borderColor = ACCENT;
    e.target.style.boxShadow = `0 0 0 3px ${ACCENT}22`;
  };
  const blurInput = (e: React.FocusEvent<HTMLInputElement>) => {
    e.target.style.borderColor = "#dee4eb";
    e.target.style.boxShadow = "none";
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: "10px",
    fontWeight: 700,
    color: "#8a96a5",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    marginBottom: "5px"
  };

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      background: INK,
      fontFamily: "var(--font-sans), system-ui, -apple-system, sans-serif"
    }}>
      <div style={{
        width: "100%",
        background: "#1e293b"
      }}>
        <div style={{ minHeight: "100vh" }} className="grid grid-cols-1 md:grid-cols-[1.15fr_480px]">

          {/* LEFT PANEL — brand story */}
          <div style={{
            padding: "4rem 4.5rem",
            flexDirection: "column",
            justifyContent: "space-between"
          }} className="hidden md:flex">
            <div>
              <img src="/logo-light.svg" alt="SIMA" style={{ width: "240px", display: "block", marginLeft: "-15px" }} />
              <div style={{
                fontSize: "11px",
                letterSpacing: "0.22em",
                textTransform: "uppercase",
                color: ACCENT,
                marginTop: "0.4rem",
                marginBottom: "1.1rem",
                fontWeight: 700
              }}>
                Smart Integrated Medical Archive
              </div>
              <p style={{
                fontSize: "14px",
                color: "rgba(255,255,255,0.65)",
                lineHeight: 1.75,
                maxWidth: "360px"
              }}>
                One secure workspace for patient records, laboratory archives, scheduling, pharmacy and clinical documentation.
              </p>

              <div style={{
                display: "flex",
                flexDirection: "column",
                gap: "9px",
                marginTop: "1.75rem"
              }}>
                {FEATURES.map(({ Icon, title, text }, fIdx) => (
                  <div
                    key={fIdx}
                    style={{
                      background: "rgba(255,255,255,0.06)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: "10px",
                      padding: "11px 14px",
                      display: "flex",
                      alignItems: "center",
                      gap: "13px"
                    }}
                  >
                    <div style={{
                      width: "32px",
                      height: "32px",
                      borderRadius: "8px",
                      background: "rgba(13,148,136,0.16)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0
                    }}>
                      <Icon size={16} style={{ color: ACCENT }} />
                    </div>
                    <div>
                      <div style={{ fontSize: "12.5px", fontWeight: 700, color: "rgba(255,255,255,0.92)" }}>{title}</div>
                      <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.5)" }}>{text}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ fontSize: "10.5px", color: "rgba(255,255,255,0.35)", letterSpacing: "0.06em", marginTop: "1.5rem" }}>
              simalbi.com
            </div>
          </div>

          {/* RIGHT PANEL — sign-in form */}
          <div style={{
            background: "#fcfdfe",
            padding: "3rem 2.5rem",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            borderLeft: "1px solid rgba(255,255,255,0.08)"
          }}>
            <div style={{ width: "100%", maxWidth: "360px", margin: "0 auto" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "9px", marginBottom: "4px" }}>
              <div style={{
                width: "30px",
                height: "30px",
                borderRadius: "8px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: ACCENT
              }}>
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M2 12 h4 l2.2 -5.5 l3.2 8.5 l2.2 -5.5 l1.2 2.5 h3.2" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <div style={{ fontSize: "17px", fontWeight: 800, color: INK, letterSpacing: "0.06em" }}>
                SIMA
              </div>
              <span style={{
                fontSize: "9px",
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                padding: "2px 8px",
                borderRadius: "20px",
                marginLeft: "4px",
                background: ACCENT_BG,
                color: ACCENT_DARK
              }}>
                Medical Archive
              </span>
            </div>

            <h2 style={{ fontSize: "24px", fontWeight: 700, color: INK, marginTop: "1.5rem", marginBottom: "4px", letterSpacing: "-0.02em" }}>
              Welcome back
            </h2>
            <p style={{ fontSize: "12px", color: "#8a96a5", marginBottom: "1.25rem" }}>
              Sign in to your SIMA workspace
            </p>

            <div style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              borderRadius: "20px",
              padding: "4px 10px",
              marginBottom: "1.25rem",
              fontSize: "10px",
              fontWeight: 600,
              width: "fit-content",
              background: ACCENT_BG,
              color: ACCENT_DARK,
              border: `1px solid ${ACCENT}33`
            }}>
              <span style={{
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                background: ACCENT,
                display: "inline-block",
                animation: "pulse 2s infinite"
              }} />
              <span>{dbStatus === "connected" ? "Secure Connection" : "Local Fallback"}</span>
            </div>

            {!forgotMode && error && (
              <div style={{
                background: "#f9ecec",
                border: "1px solid #e7bcbc",
                borderRadius: "8px",
                padding: "10px 12px",
                marginBottom: "1rem",
                fontSize: "11.5px",
                color: "#7a2826",
                lineHeight: 1.4
              }}>
                {error}
              </div>
            )}

            {forgotMode ? (
              <form onSubmit={handleForgotPassword} style={{ display: "flex", flexDirection: "column" }}>
                <p style={{ fontSize: "12px", color: "#5a6675", lineHeight: 1.5, marginTop: 0, marginBottom: "0.9rem" }}>
                  Enter your account email and we'll send you a link to set a new password.
                </p>

                {resetError && (
                  <div style={{
                    background: "#f9ecec",
                    border: "1px solid #e7bcbc",
                    borderRadius: "8px",
                    padding: "10px 12px",
                    marginBottom: "1rem",
                    fontSize: "11.5px",
                    color: "#7a2826",
                    lineHeight: 1.4
                  }}>
                    {resetError}
                  </div>
                )}

                {resetSent ? (
                  <div style={{
                    background: "#e7f7ee",
                    border: "1px solid #b6e8cd",
                    borderRadius: "8px",
                    padding: "10px 12px",
                    marginBottom: "1rem",
                    fontSize: "11.5px",
                    color: "#1c7a4a",
                    lineHeight: 1.4
                  }}>
                    Reset link sent to {resetEmail}. Check your inbox (and spam folder) and follow the link to set a new password.
                  </div>
                ) : (
                  <div style={{ marginBottom: "0.8rem" }}>
                    <label style={labelStyle}>Account Email</label>
                    <input
                      type="email"
                      placeholder="doctor@simalbi.com"
                      value={resetEmail}
                      onChange={(e) => setResetEmail(e.target.value)}
                      style={inputStyle}
                      onFocus={focusInput}
                      onBlur={blurInput}
                    />
                  </div>
                )}

                {!resetSent && (
                  <button
                    type="submit"
                    disabled={isSendingReset}
                    style={{
                      width: "100%",
                      border: "none",
                      borderRadius: "9px",
                      padding: "10px 16px",
                      fontSize: "13px",
                      fontWeight: 700,
                      cursor: isSendingReset ? "not-allowed" : "pointer",
                      color: "#fcfdfe",
                      background: ACCENT,
                      marginBottom: "0.9rem"
                    }}
                  >
                    {isSendingReset ? "Sending..." : "Send reset link"}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setForgotMode(false);
                    setResetError(null);
                    setResetSent(false);
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    color: ACCENT,
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                    padding: 0,
                    textAlign: "left"
                  }}
                >
                  ← Back to sign in
                </button>
              </form>
            ) : (
            <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ marginBottom: "0.8rem" }}>
                <label style={labelStyle}>Email or Username</label>
                <input
                  type="text"
                  placeholder="doctor@simalbi.com"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  style={inputStyle}
                  onFocus={focusInput}
                  onBlur={blurInput}
                />
              </div>

              <div style={{ marginBottom: "0.8rem" }}>
                <label style={labelStyle}>Password</label>
                <div style={{ position: "relative" }}>
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    style={{ ...inputStyle, padding: "9px 40px 9px 13px" }}
                    onFocus={focusInput}
                    onBlur={blurInput}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{
                      position: "absolute",
                      right: "12px",
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "#c9d2dc",
                      display: "flex",
                      alignItems: "center"
                    }}
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              <div style={{ textAlign: "right", marginTop: "-2px", marginBottom: "1rem" }}>
                <button
                  type="button"
                  onClick={() => {
                    setForgotMode(true);
                    setError(null);
                    setResetError(null);
                    setResetSent(false);
                    setResetEmail(username);
                  }}
                  style={{
                    fontSize: "11px",
                    textDecoration: "none",
                    color: ACCENT,
                    fontWeight: 600,
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: 0
                  }}
                >
                  Forgot password?
                </button>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                style={{
                  width: "100%",
                  border: "none",
                  borderRadius: "9px",
                  padding: "10px 16px",
                  fontSize: "13px",
                  fontWeight: 700,
                  cursor: isLoading ? "not-allowed" : "pointer",
                  color: "#fcfdfe",
                  background: ACCENT,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                  transition: "opacity 0.2s, transform 0.1s",
                  marginBottom: "1.25rem"
                }}
              >
                {isLoading ? "Signing in..." : "Sign in"}
                {!isLoading && <ArrowRight size={15} />}
              </button>
            </form>
            )}


            <div style={{ marginTop: "1.5rem", fontSize: "10px", color: "#c9d2dc", lineHeight: 1.5, textAlign: "center" }}>
              Protected by enterprise-grade encryption &bull; SIMA &copy; 2026
            </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
