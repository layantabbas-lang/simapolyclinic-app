import { useState } from "react";
import { AlertCircle, ArrowRight, CheckCircle2, Lock, Mail } from "lucide-react";
import { isConfigured, supabase } from "../supabaseClient";
import { buildSessionFromAuthUser } from "../authSession";
import { UserSession } from "../types";

interface SignInProps {
  onLoginSuccess: (session: UserSession) => void;
}

type Mode = "signin" | "forgot";

export default function SignIn({ onLoginSuccess }: SignInProps) {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const resetMessages = () => {
    setError(null);
    setInfo(null);
  };

  const switchMode = (next: Mode) => {
    resetMessages();
    setPassword("");
    setMode(next);
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();

    if (!isConfigured) {
      // No Supabase project yet — this is the only path available, and it
      // never touches real data (see .env.example / README setup steps).
      const resolvedEmail = email || "staff@clinic.local";
      onLoginSuccess({
        username: resolvedEmail,
        name: email ? email.split("@")[0] : "Staff",
        email: resolvedEmail,
        role: "admin",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError || !data.user) {
        throw new Error(authError?.message || "Sign in failed.");
      }
      onLoginSuccess(await buildSessionFromAuthUser(data.user));
    } catch (err: any) {
      setError(err.message || "Could not sign in. Check your email and password.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();
    if (!email.trim()) {
      setError("Enter your email first.");
      return;
    }
    setIsSubmitting(true);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      });
      if (resetError) throw resetError;
      setInfo("Check your inbox — we sent a link to reset your password.");
    } catch (err: any) {
      setError(err.message || "Could not send the reset link.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const heading = mode === "signin" ? "Sign in" : "Reset password";
  const subtitle =
    mode === "signin"
      ? "Welcome back — enter your staff credentials to continue."
      : "Enter the email on your staff account and we'll send you a reset link.";

  return (
    <div className="min-h-screen flex font-sans">
      {/* Branding panel */}
      <div
        className="hidden md:flex md:w-[42%] flex-col items-center justify-center gap-5 px-10 text-center"
        style={{ background: "linear-gradient(160deg, #16202b 0%, #2a5178 55%, #438a6a 130%)" }}
      >
        <div className="w-28 h-28 rounded-full bg-white flex items-center justify-center shadow-lg p-4">
          <img src="/sima-logo-dark.png" alt="SIMA" className="w-full h-auto" />
        </div>
        <div>
          <div className="text-white font-bold text-2xl">-Polyclinic</div>
          <div className="text-[#c2d5e7] text-sm mt-1">Multi-clinic care management</div>
        </div>
        <div className="text-[#c2d5e7] text-xs tracking-wide">
          Patients &bull; Appointments &bull; Clinical Notes
        </div>
        <div className="text-white/50 text-[11px] tracking-wide mt-6">
          Admin &bull; Doctor &bull; Secretary
        </div>
      </div>

      {/* Sign-in panel */}
      <div className="flex-1 flex items-center justify-center bg-white px-6">
        <form
          onSubmit={mode === "signin" ? handleSignIn : handleForgotPassword}
          className="w-full max-w-sm flex flex-col gap-4"
        >
          <div className="md:hidden flex items-center gap-2 mb-2">
            <img src="/sima-logo-dark.png" alt="SIMA" className="h-6 w-auto" />
            <div className="font-bold text-slate-900 text-sm">-Polyclinic</div>
          </div>

          <div>
            <h1 className="text-2xl font-bold text-slate-900">{heading}</h1>
            <p className="text-sm text-slate-400 mt-1">{subtitle}</p>
          </div>

          {!isConfigured && mode === "signin" && (
            <div
              className="text-[11px] px-3 py-2 rounded-lg"
              style={{ background: "#faf3e3", color: "#75581a" }}
            >
              Mock mode — any email/password signs you in. Real auth needs a
              Supabase project (see .env.example).
            </div>
          )}

          {error && (
            <div
              className="text-[11px] px-3 py-2 rounded-lg flex items-start gap-1.5"
              style={{ background: "#f9ecec", color: "#96322f" }}
            >
              <AlertCircle size={13} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {info && (
            <div
              className="text-[11px] px-3 py-2 rounded-lg flex items-start gap-1.5"
              style={{ background: "#e7f2ec", color: "#2c6349" }}
            >
              <CheckCircle2 size={13} className="shrink-0 mt-0.5" />
              <span>{info}</span>
            </div>
          )}

          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Email</span>
            <div className="flex items-center gap-2 border border-slate-200 bg-slate-50 rounded-lg px-3 py-2.5 focus-within:ring-1 focus-within:ring-[var(--theme-accent)] focus-within:bg-white transition-colors">
              <Mail size={14} className="text-slate-400" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@clinic.com"
                className="flex-1 text-sm outline-none bg-transparent"
              />
            </div>
          </label>

          {mode === "signin" && (
            <label className="flex flex-col gap-1.5">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Password</span>
              <div className="flex items-center gap-2 border border-slate-200 bg-slate-50 rounded-lg px-3 py-2.5 focus-within:ring-1 focus-within:ring-[var(--theme-accent)] focus-within:bg-white transition-colors">
                <Lock size={14} className="text-slate-400" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="flex-1 text-sm outline-none bg-transparent"
                />
              </div>
            </label>
          )}

          {mode === "signin" && (
            <button
              type="button"
              onClick={() => switchMode("forgot")}
              className="text-right text-[11px] font-semibold -mt-2"
              style={{ color: "var(--theme-accent)" }}
            >
              Forgot password?
            </button>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-1 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-60 flex items-center justify-center gap-1.5"
            style={{ background: "var(--theme-accent)" }}
          >
            {isSubmitting
              ? "Please wait..."
              : mode === "signin"
              ? (<>Sign in <ArrowRight size={14} /></>)
              : "Send reset link"}
          </button>

          {mode === "forgot" && (
            <div className="text-center text-[11px] text-slate-400">
              <button type="button" onClick={() => switchMode("signin")} className="font-semibold" style={{ color: "var(--theme-accent)" }}>
                Back to sign in
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
