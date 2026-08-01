import { useState } from "react";
import { AlertCircle, Lock, Mail } from "lucide-react";
import { isConfigured, supabase } from "../supabaseClient";
import { UserSession } from "../types";

interface SignInProps {
  onLoginSuccess: (session: UserSession) => void;
}

// public.staff.roles is an array of staff_role; the UI (carried over from
// SIMA) only knows admin/doctor/secretary today, so this maps the DB's
// richer role set down to the closest UI-facing equivalent.
function mapStaffRole(roles: string[] | null | undefined): UserSession["role"] {
  const list = roles || [];
  if (list.includes("owner") || list.includes("admin")) return "admin";
  if (list.includes("doctor") || list.includes("nurse")) return "doctor";
  return "secretary";
}

export default function SignIn({ onLoginSuccess }: SignInProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

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

      const { data: staffRow } = await supabase
        .from("staff")
        .select("id, full_name, roles")
        .eq("user_id", data.user.id)
        .maybeSingle();

      onLoginSuccess({
        id: data.user.id,
        username: data.user.email || email,
        name: staffRow?.full_name || data.user.email || "Staff",
        email: data.user.email || email,
        role: mapStaffRole(staffRow?.roles),
      });
    } catch (err: any) {
      setError(err.message || "Could not sign in. Check your email and password.");
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
        <div className="flex items-center gap-2 mb-2">
          <img src="/sima-logo-dark.png" alt="SIMA" className="h-6 w-auto" />
          <div>
            <div className="font-bold text-slate-900 text-sm leading-tight">-Polyclinic</div>
            <div className="text-[11px] text-slate-400">Clinic sign in</div>
          </div>
        </div>

        {!isConfigured && (
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

        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-slate-600">Email</span>
          <div className="flex items-center gap-2 border border-slate-200 rounded-lg px-3 py-2">
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

        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-slate-600">Password</span>
          <div className="flex items-center gap-2 border border-slate-200 rounded-lg px-3 py-2">
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

        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-1 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: "var(--theme-accent)" }}
        >
          {isSubmitting ? "Signing in..." : "Sign In"}
        </button>
      </form>
    </div>
  );
}
