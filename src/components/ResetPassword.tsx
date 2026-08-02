import { useState } from "react";
import { AlertCircle, CheckCircle2, Lock } from "lucide-react";
import { supabase } from "../supabaseClient";

interface ResetPasswordProps {
  onDone: () => void;
}

export default function ResetPassword({ onDone }: ResetPasswordProps) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDone, setIsDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setIsSubmitting(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setIsDone(true);
    } catch (err: any) {
      setError(err.message || "Could not update the password.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 font-sans p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-white border border-slate-200 rounded-xl p-6 flex flex-col gap-4 shadow-sm"
      >
        <div className="flex items-center gap-2 mb-1">
          <img src="/sima-logo-dark.png" alt="SIMA" className="h-6 w-auto" />
          <div className="font-bold text-slate-900 text-sm">-Polyclinic</div>
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">Set a new password</h1>
          <p className="text-sm text-slate-400 mt-1">Choose a new password for your account.</p>
        </div>

        {error && (
          <div className="text-[11px] px-3 py-2 rounded-lg flex items-start gap-1.5" style={{ background: "#f9ecec", color: "#96322f" }}>
            <AlertCircle size={13} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {isDone ? (
          <>
            <div className="text-[12px] px-3 py-2 rounded-lg flex items-start gap-1.5" style={{ background: "#e7f2ec", color: "#2c6349" }}>
              <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
              <span>Password updated. You're signed in with your new password.</span>
            </div>
            <button
              type="button"
              onClick={onDone}
              className="mt-1 py-2.5 rounded-lg text-sm font-semibold text-white"
              style={{ background: "var(--theme-accent)" }}
            >
              Continue
            </button>
          </>
        ) : (
          <>
            <label className="flex flex-col gap-1.5">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">New Password</span>
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
            <label className="flex flex-col gap-1.5">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Confirm Password</span>
              <div className="flex items-center gap-2 border border-slate-200 bg-slate-50 rounded-lg px-3 py-2.5 focus-within:ring-1 focus-within:ring-[var(--theme-accent)] focus-within:bg-white transition-colors">
                <Lock size={14} className="text-slate-400" />
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  className="flex-1 text-sm outline-none bg-transparent"
                />
              </div>
            </label>
            <button
              type="submit"
              disabled={isSubmitting}
              className="mt-1 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-60"
              style={{ background: "var(--theme-accent)" }}
            >
              {isSubmitting ? "Updating..." : "Update password"}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
