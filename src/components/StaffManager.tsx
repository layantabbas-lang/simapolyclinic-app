import { useEffect, useState } from "react";
import { AlertCircle, Check, Plus, UserCog, UserRound, X } from "lucide-react";
import { supabase } from "../supabaseClient";
import { UserSession } from "../types";

interface StaffManagerProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser?: UserSession | null;
}

interface StaffRow {
  id: string;
  full_name: string;
  email: string;
  roles: string[];
  phone: string | null;
  is_active: boolean;
  user_id: string | null;
}

const ALL_ROLES = ["owner", "admin", "doctor", "nurse", "receptionist", "accountant", "lab_tech"];

// Adding staff here only creates the roster row (name/email/roles) —
// there's no backend here to hold a service-role key, and self-signup is
// intentionally not offered (only the admin creates accounts). So the
// actual login still has to be created by the admin in the Supabase
// Dashboard (Authentication -> Users -> Add user) with this exact email.
// The trigger in 0008_provisioning.sql auto-links the two the moment that
// account exists. "Pending" below means the row exists but no login has
// been created for it yet.
export default function StaffManager({ isOpen, onClose, currentUser }: StaffManagerProps) {
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newRoles, setNewRoles] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) fetchStaff();
  }, [isOpen]);

  const showStatus = (text: string, type: "success" | "error") => {
    setStatusMessage({ text, type });
    setTimeout(() => setStatusMessage(null), 4000);
  };

  const fetchStaff = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("staff")
        .select("id, full_name, email, roles, phone, is_active, user_id")
        .order("full_name");
      if (error) throw error;
      setStaff(data || []);
    } catch (err: any) {
      showStatus(err.message || "Could not load staff.", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const toggleRole = (role: string) => {
    setNewRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));
  };

  const resetForm = () => {
    setNewName("");
    setNewEmail("");
    setNewPhone("");
    setNewRoles([]);
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newEmail.trim() || newRoles.length === 0) {
      showStatus("Name, email, and at least one role are required.", "error");
      return;
    }
    setIsSaving(true);
    try {
      const { error } = await supabase.from("staff").insert([{
        full_name: newName.trim(),
        email: newEmail.trim(),
        phone: newPhone.trim() || null,
        roles: newRoles,
      }]);
      if (error) throw error;
      showStatus(`Added ${newName.trim()} — create their login in Supabase Dashboard → Authentication → Users → Add user, using ${newEmail.trim()}.`, "success");
      resetForm();
      setIsAddOpen(false);
      fetchStaff();
    } catch (err: any) {
      showStatus(err.message || "Could not add this staff member.", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleActive = async (member: StaffRow) => {
    try {
      const { error } = await supabase.from("staff").update({ is_active: !member.is_active }).eq("id", member.id);
      if (error) throw error;
      setStaff((prev) => prev.map((s) => (s.id === member.id ? { ...s, is_active: !s.is_active } : s)));
    } catch (err: any) {
      showStatus(err.message || "Could not update this staff member.", "error");
    }
  };

  if (!isOpen) return null;
  if (currentUser?.role !== "admin") return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden border border-slate-200">
        <div className="bg-[var(--theme-accent-dark)] text-white px-6 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="p-1.5 bg-white/10 rounded-lg text-white">
              <UserCog size={20} />
            </span>
            <div>
              <h2 className="text-base font-bold">Staff</h2>
              <p className="text-[11px] text-[var(--theme-accent-bg)] font-medium">Who has access, and what they can do.</p>
            </div>
          </div>
          <button onClick={onClose} className="text-white hover:bg-white/10 p-1.5 rounded-lg transition-colors cursor-pointer">
            <X size={18} />
          </button>
        </div>

        {statusMessage && (
          <div className={`px-6 py-2.5 flex items-center gap-2 text-xs font-bold shrink-0 ${
            statusMessage.type === "success" ? "bg-emerald-50 border-b border-emerald-100 text-emerald-800" : "bg-rose-50 border-b border-rose-100 text-rose-800"
          }`}>
            {statusMessage.type === "error" ? <AlertCircle size={14} /> : <Check size={14} />}
            <span>{statusMessage.text}</span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {isLoading ? (
            <div className="h-32 flex flex-col items-center justify-center text-slate-400 gap-1.5">
              <div className="w-5 h-5 border-2 border-[var(--theme-accent)] border-t-transparent rounded-full animate-spin" />
              <span className="text-xs font-semibold">Loading staff...</span>
            </div>
          ) : staff.length === 0 ? (
            <div className="h-32 flex flex-col items-center justify-center text-center p-4 bg-slate-50 border border-slate-200 rounded-xl">
              <UserRound className="h-7 w-7 text-slate-300 mb-1.5" />
              <p className="text-xs font-bold text-slate-500">No staff yet</p>
            </div>
          ) : (
            staff.map((member) => (
              <div key={member.id} className={`flex items-center gap-3 p-2.5 rounded-lg border ${member.is_active ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50"}`}>
                <div className="w-8 h-8 rounded-full bg-[var(--theme-accent-bg)] flex items-center justify-center text-[10px] font-bold shrink-0" style={{ color: "var(--theme-accent-dark)" }}>
                  {member.full_name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`text-xs font-bold ${member.is_active ? "text-slate-800" : "text-slate-400 line-through"}`}>{member.full_name}</span>
                    {!member.user_id && (
                      <span className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold uppercase">Pending signup</span>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-400 truncate">{member.email}</div>
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {member.roles.map((r) => (
                      <span key={r} className="text-[9px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-semibold uppercase">{r}</span>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => handleToggleActive(member)}
                  className="text-[10px] font-bold px-2 py-1 rounded shrink-0"
                  style={member.is_active ? { background: "#f3dbdb", color: "#96322f" } : { background: "#d5e8de", color: "#2c6349" }}
                >
                  {member.is_active ? "Deactivate" : "Reactivate"}
                </button>
              </div>
            ))
          )}
        </div>

        <div className="border-t border-slate-200 shrink-0 bg-slate-50">
          {!isAddOpen ? (
            <button
              onClick={() => setIsAddOpen(true)}
              className="w-full flex items-center justify-center gap-1.5 text-xs font-bold text-white py-2.5"
              style={{ background: "var(--theme-accent)" }}
            >
              <Plus size={14} /> Add Staff
            </button>
          ) : (
            <form onSubmit={handleAdd} className="p-4 flex flex-col gap-2.5 text-xs">
              <div className="grid grid-cols-2 gap-2.5">
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Full name"
                  className="border border-slate-300 rounded-md px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)] bg-white"
                />
                <input
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="Email"
                  type="email"
                  className="border border-slate-300 rounded-md px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)] bg-white"
                />
              </div>
              <input
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="Phone (optional)"
                className="border border-slate-300 rounded-md px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)] bg-white"
              />
              <div className="flex flex-wrap gap-1.5">
                {ALL_ROLES.map((role) => (
                  <button
                    type="button"
                    key={role}
                    onClick={() => toggleRole(role)}
                    className="text-[10px] font-bold px-2 py-1 rounded uppercase"
                    style={newRoles.includes(role)
                      ? { background: "var(--theme-accent)", color: "white" }
                      : { background: "white", color: "#71808f", border: "1px solid #dee4eb" }}
                  >
                    {role}
                  </button>
                ))}
              </div>
              <div className="flex gap-2 mt-1">
                <button
                  type="button"
                  onClick={() => { setIsAddOpen(false); resetForm(); }}
                  className="flex-1 text-xs font-bold text-slate-500 py-2 rounded-md border border-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="flex-1 text-xs font-bold text-white py-2 rounded-md disabled:opacity-60"
                  style={{ background: "var(--theme-accent)" }}
                >
                  {isSaving ? "Saving..." : "Save"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
