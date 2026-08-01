import React, { useState, useEffect } from "react";
import {
  Users, UserPlus, CalendarDays, DollarSign, TrendingUp, TrendingDown,
  Trash2, RefreshCw, AlertCircle, Check, Code, Copy, Info, Plus, X, BarChart3, Building2, Clock
} from "lucide-react";
import { supabase } from "../supabaseClient";
import { UserSession } from "./SignIn";
import { ScheduleManagerView } from "./ScheduleManager";

interface AdminConsoleProps { currentUser: UserSession; }

interface StaffProfile {
  id: string;
  created_at?: string;
  email: string;
  full_name: string;
  phone?: string | null;
  role: "secretary" | "doctor" | "admin" | "pharmacy" | "nurse";
}

interface AccessSchedule {
  id: string; username: string; name: string; role: string;
  allowedStartDate: string; allowedEndDate: string;
  status: "active" | "expired" | "pending";
}

interface AccountingItem {
  id: string; date: string; type: "revenue" | "expense";
  category: string; amount: number; description: string;
  status: "cleared" | "pending";
}

const S: Record<string, React.CSSProperties> = {
  page: { fontFamily: "system-ui,-apple-system,sans-serif", background: "#f4f6f9", minHeight: "100%" },
  banner: {
    background: "#2b3949", borderBottom: "1px solid var(--theme-accent)",
    padding: "20px 24px", display: "flex", flexWrap: "wrap" as const,
    justifyContent: "space-between", alignItems: "flex-start", gap: "16px",
  },
  bannerEyebrow: { fontSize: "10px", color: "var(--theme-accent-bg)", fontFamily: "monospace", textTransform: "uppercase" as const, letterSpacing: "0.08em", marginBottom: "4px" },
  bannerTitle: { fontSize: "18px", fontWeight: 600, color: "#f6f8fa", margin: "0 0 4px" },
  bannerSub: { fontSize: "12px", color: "#c9d2dc" },
  tabBar: { display: "flex", background: "#1f2e3e", border: "1px solid var(--theme-accent)", borderRadius: "8px", padding: "3px", gap: "2px", flexWrap: "wrap" as const },
  tab: (active: boolean, color = "var(--theme-accent)"): React.CSSProperties => ({
    padding: "6px 14px", borderRadius: "6px", border: "none", fontSize: "12px",
    fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", gap: "6px",
    background: active ? color : "transparent",
    color: active ? "#fcfdfe" : "#8a96a5",
    transition: "all 0.15s",
  }),
  body: { padding: "24px" },
  card: {
    background: "#fcfdfe", border: "0.5px solid #dee4eb",
    borderRadius: "10px", overflow: "hidden",
  },
  cardHeader: {
    padding: "12px 16px", background: "#f6f8fa",
    borderBottom: "0.5px solid #dee4eb",
    display: "flex", alignItems: "center", justifywrap: "wrap", justifyContent: "space-between",
  },
  cardHeaderLabel: { fontSize: "11px", fontWeight: 600, color: "#5d6b7c", textTransform: "uppercase" as const, letterSpacing: "0.06em" },
  sectionHead: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "20px", paddingBottom: "16px", borderBottom: "0.5px solid #dee4eb" },
  sectionTitle: { fontSize: "14px", fontWeight: 600, color: "#26313e", margin: "0 0 4px" },
  sectionSub: { fontSize: "12px", color: "#5d6b7c", margin: 0 },
  btnPrimary: (color = "var(--theme-accent)"): React.CSSProperties => ({
    padding: "7px 14px", background: color, border: "none", borderRadius: "7px",
    color: "#fcfdfe", fontSize: "12px", fontWeight: 600, cursor: "pointer",
    display: "flex", alignItems: "center", gap: "6px",
  }),
  btnGhost: {
    padding: "7px 14px", background: "#fcfdfe", border: "0.5px solid #dee4eb",
    borderRadius: "7px", color: "#3c4b5c", fontSize: "12px", cursor: "pointer",
    display: "flex", alignItems: "center", gap: "6px",
  },
  label: { display: "block", fontSize: "11px", color: "#5d6b7c", marginBottom: "4px", fontWeight: 500 },
  input: {
    width: "100%", padding: "8px 10px", background: "#f6f8fa",
    border: "0.5px solid #c9d2dc", borderRadius: "7px",
    fontSize: "13px", color: "#26313e", outline: "none", boxSizing: "border-box" as const,
  },
  metricCard: {
    background: "#fcfdfe", border: "0.5px solid #dee4eb", borderRadius: "10px", padding: "16px",
  },
};

export default function AdminConsole({ currentUser }: AdminConsoleProps) {
  const [activeTab, setActiveTab] = useState<"users" | "access" | "accounting" | "analytics" | "rooms" | "schedule">("users");
  const [dbUsers, setDbUsers] = useState<StaffProfile[]>([]);
  // Derived from real staff profiles -- no placeholder doctor names anywhere.
  const doctorNames = dbUsers.filter(u => u.role === "doctor").map(u => u.full_name);
  const [isUsersLoading, setIsUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [isAddingUser, setIsAddingUser] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newRole, setNewRole] = useState<"secretary" | "doctor" | "admin" | "pharmacy" | "nurse">("secretary");
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);

  // Dynamic parameters-driven analytics states
  const [appointments, setAppointments] = useState<any[]>([]);
  const [isAptsLoading, setIsAptsLoading] = useState(false);
  const [aptsError, setAptsError] = useState<string | null>(null);
  const [selectedDoctorParam, setSelectedDoctorParam] = useState("all");
  const [selectedRoomParam, setSelectedRoomParam] = useState("all");
  // Defaults to the current real month instead of a fixed stale date.
  const [selectedStartDateParam, setSelectedStartDateParam] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
  });
  const [selectedEndDateParam, setSelectedEndDateParam] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split("T")[0];
  });

  // Dynamic loaded rooms states (Real-time Supabase table sync)
  const [rooms, setRooms] = useState<any[]>([]);
  const [isRoomsLoading, setIsRoomsLoading] = useState(false);
  const [roomsError, setRoomsError] = useState<string | null>(null);

  // Add / Edit room panel toggle states
  const [isAddingRoom, setIsAddingRoom] = useState(false);
  const [roomName, setRoomName] = useState("");
  const [roomMachines, setRoomMachines] = useState("");
  const [roomDescription, setRoomDescription] = useState("");
  const [roomCapacity, setRoomCapacity] = useState(1);
  const [editingRoom, setEditingRoom] = useState<any | null>(null);

  // Starts empty on purpose -- this tab isn't wired to a real Supabase table
  // yet (see note below), so no placeholder people belong here.
  const [accessRecords, setAccessRecords] = useState<AccessSchedule[]>([]);
  const [schedUsername, setSchedUsername] = useState("");
  const [schedName, setSchedName] = useState("");
  const [schedStartDate, setSchedStartDate] = useState("2026-06-13");
  const [schedEndDate, setSchedEndDate] = useState("2026-07-13");

  // Starts empty on purpose -- also not wired to a real Supabase table yet.
  const [accountingEntries, setAccountingEntries] = useState<AccountingItem[]>([]);
  const [newTxType, setNewTxType] = useState<"revenue" | "expense">("revenue");
  const [newTxAmount, setNewTxAmount] = useState("");
  const [newTxCategory, setNewTxCategory] = useState("Patient Consultation");
  const [newTxDesc, setNewTxDesc] = useState("");
  const [newTxDate, setNewTxDate] = useState("2026-06-13");

  const totalRevenue = accountingEntries.filter(t => t.type === "revenue").reduce((s, t) => s + t.amount, 0);
  const totalExpenses = accountingEntries.filter(t => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const netGain = totalRevenue - totalExpenses;

  const fetchClinicUsers = async () => {
    setIsUsersLoading(true); setUsersError(null);
    try {
      const { data, error } = await supabase.from("profiles").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      setDbUsers(data || []);
    } catch (err: any) {
      setUsersError(err.message || "Failed to load users from Supabase.");
    } finally { setIsUsersLoading(false); }
  };

  const fetchAppointmentsForAnalytics = async () => {
    setIsAptsLoading(true); setAptsError(null);
    try {
      const { data, error } = await supabase
        .from("appointments")
        .select("*, patients(first_name, surname), profiles(full_name), rooms(name)")
        .order("schedule_time", { ascending: true });
      if (error) throw error;
      if (data && data.length > 0) {
        const loaded = data.map((row: any) => {
          const fullTimestamp = new Date(row.schedule_time);
          const formattedTime = !isNaN(fullTimestamp.getTime())
            ? `${String(fullTimestamp.getHours()).padStart(2, "0")}:${String(fullTimestamp.getMinutes()).padStart(2, "0")}`
            : "10:00";
          const formattedDateStr = !isNaN(fullTimestamp.getTime())
            ? fullTimestamp.toISOString().split("T")[0]
            : new Date().toISOString().split("T")[0];
          const patientName = row.patients
            ? `${row.patients.first_name || ""} ${row.patients.surname || ""}`.trim()
            : "Unknown Patient";
          return {
            id: String(row.id),
            patientName: patientName || "Unknown Patient",
            birthDate: "",
            appointmentTime: formattedTime,
            dateStr: formattedDateStr,
            doctorName: row.profiles?.full_name || "Unassigned",
            documentType: "Comprehensive Blood Panel",
            status: "Awaiting Scan",
            notes: "Loaded directly from cloud database row entry.",
            room: row.rooms?.name || "Unassigned",
            durationHours: Number(row.duration_hours) || 1
          };
        });
        setAppointments(loaded);
      } else {
        setAppointments([]);
      }
    } catch (err: any) {
      console.warn("Analytics Sync Notice:", err.message);
      setAptsError(err.message || "Database connection offline.");
      setAppointments([]);
    } finally {
      setIsAptsLoading(false);
    }
  };

  const fetchRooms = async () => {
    setIsRoomsLoading(true); setRoomsError(null);
    try {
      const { data, error } = await supabase.from("rooms").select("*").order("name", { ascending: true });
      if (error) throw error;
      if (data && data.length > 0) {
        setRooms(data);
      }
    } catch (err: any) {
      console.warn("Rooms DB Sync Notice:", err.message);
    } finally {
      setIsRoomsLoading(false);
    }
  };

  useEffect(() => { 
    fetchClinicUsers(); 
    fetchAppointmentsForAnalytics();
    fetchRooms();
  }, []);

  const handleAddRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    setRoomsError(null);
    if (!roomName.trim()) { setRoomsError("Room name is required."); return; }
    try {
      const { error } = await supabase.from("rooms").insert([{
        name: roomName.trim(),
        machines: roomMachines.trim(),
        description: roomDescription.trim(),
        capacity: Number(roomCapacity)
      }]);
      if (error) throw error;
      
      setRoomName("");
      setRoomMachines("");
      setRoomDescription("");
      setRoomCapacity(1);
      setIsAddingRoom(false);
      fetchRooms();
    } catch (err: any) {
      console.warn("Fallback offline execution on Add Room:", err.message);
      const id = "local-" + Date.now();
      const newLocalRoom = {
        id,
        name: roomName.trim(),
        machines: roomMachines.trim(),
        description: roomDescription.trim(),
        capacity: Number(roomCapacity)
      };
      setRooms(prev => [...prev, newLocalRoom].sort((a,b) => a.name.localeCompare(b.name)));
      setRoomName("");
      setRoomMachines("");
      setRoomDescription("");
      setRoomCapacity(1);
      setIsAddingRoom(false);
      setRoomsError("Room created locally. Run the SQL script below in your Supabase dashboard to synchronize rooms on-cloud.");
    }
  };

  const handleEditRoomSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRoom) return;
    setRoomsError(null);
    try {
      if (typeof editingRoom.id === "number" || (typeof editingRoom.id === "string" && !editingRoom.id.startsWith("local-") && !editingRoom.id.startsWith("mock-"))) {
        const { error } = await supabase.from("rooms").update({
          name: editingRoom.name,
          machines: editingRoom.machines,
          description: editingRoom.description,
          capacity: Number(editingRoom.capacity)
        }).eq("id", editingRoom.id);
        if (error) throw error;
      }
      setRooms(prev => prev.map(r => r.id === editingRoom.id ? editingRoom : r));
      setEditingRoom(null);
      fetchRooms();
    } catch (err: any) {
      console.warn("Fallback offline edit applied:", err.message);
      setRooms(prev => prev.map(r => r.id === editingRoom.id ? editingRoom : r));
      setEditingRoom(null);
    }
  };

  const handleDeleteRoom = async (roomId: any) => {
    if (!confirm("Are you sure you want to remove this room? Registered appointments referencing this room will persist but the configuration row will be deleted.")) return;
    setRoomsError(null);
    try {
      if (typeof roomId === "number" || (typeof roomId === "string" && !roomId.startsWith("local-") && !roomId.startsWith("mock-"))) {
        const { error } = await supabase.from("rooms").delete().eq("id", roomId);
        if (error) throw error;
      }
      setRooms(prev => prev.filter(r => r.id !== roomId));
      fetchRooms();
    } catch (err: any) {
      console.warn("Fallback offline delete applied:", err.message);
      setRooms(prev => prev.filter(r => r.id !== roomId));
    }
  };

  const handleAddNewUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setUsersError(null); setSubmitSuccess(null);
    const email = newEmail.trim().toLowerCase();
    if (!newName.trim() || !email || !newPassword) { setUsersError("Fill in all fields."); return; }
    if (!email.includes("@")) { setUsersError("Enter a real email address for this staff member to sign in with."); return; }

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) { setUsersError("Your session expired -- please sign in again."); return; }

      const response = await fetch("/api/admin/create-staff", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          email,
          password: newPassword,
          full_name: newName.trim(),
          role: newRole,
          phone: newPhone.trim(),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not create the account.");

      setSubmitSuccess(`${newName} added successfully.`);
      setNewName(""); setNewEmail(""); setNewPassword(""); setNewPhone(""); setNewRole("secretary"); setIsAddingUser(false);
      fetchClinicUsers();
    } catch (err: any) { setUsersError(err.message); }
  };

  const handleAddSchedule = (e: React.FormEvent) => {
    e.preventDefault();
    if (!schedUsername.trim() || !schedName.trim()) return;
    setAccessRecords([{ id: `acc-${Date.now()}`, username: schedUsername.trim().toLowerCase(), name: schedName.trim(), role: "doctor", allowedStartDate: schedStartDate, allowedEndDate: schedEndDate, status: "active" }, ...accessRecords]);
    setSchedUsername(""); setSchedName("");
  };

  const handleAddTx = (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(newTxAmount);
    if (isNaN(amt) || amt <= 0) return;
    setAccountingEntries([{ id: `tx-${Date.now()}`, date: newTxDate, type: newTxType, category: newTxCategory, amount: amt, description: newTxDesc || (newTxType === "revenue" ? "Clinical receipt" : "Operation bill"), status: "cleared" }, ...accountingEntries]);
    setNewTxAmount(""); setNewTxDesc("");
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(id);
    setTimeout(() => setCopiedText(null), 2000);
  };

  const roleBadge = (role: string) => {
    const map: Record<string, { bg: string; color: string }> = {
      admin: { bg: "#dee9f3", color: "#2a5178" },
      doctor: { bg: "#d5e8de", color: "#24503c" },
      secretary: { bg: "#edf3f8", color: "#2a5178" },
      pharmacy: { bg: "#f3e8ff", color: "#6d28d9" },
      nurse: { bg: "#fef3e0", color: "#92400e" },
    };
    const s = map[role] || { bg: "#edf1f5", color: "#3c4b5c" };
    return (
      <span style={{ background: s.bg, color: s.color, fontSize: "10px", fontWeight: 700, padding: "2px 8px", borderRadius: "20px", fontFamily: "monospace", textTransform: "uppercase" as const }}>
        {role}
      </span>
    );
  };

  return (
    <div style={S.page}>
      {/* Banner */}
      <div style={S.banner}>
        <div>
          <div style={S.bannerEyebrow}>Clinical master control · Owner dashboard</div>
          <h2 style={S.bannerTitle}>Administrator control panel</h2>
          <p style={S.bannerSub}>Authenticated as <span style={{ color: "#dee9f3" }}>{currentUser.name}</span></p>
        </div>         <div style={S.tabBar}>
          <button style={S.tab(activeTab === "users")} onClick={() => setActiveTab("users")}>
            <Users size={13} /> Manage staff
          </button>
          <button style={S.tab(activeTab === "rooms")} onClick={() => setActiveTab("rooms")}>
            <Building2 size={13} /> Manage Rooms
          </button>
          <button style={S.tab(activeTab === "access")} onClick={() => setActiveTab("access")}>
            <CalendarDays size={13} /> Access timetable
          </button>
          <button style={S.tab(activeTab === "accounting")} onClick={() => setActiveTab("accounting")}>
            <DollarSign size={13} /> Accounting
          </button>
          <button style={S.tab(activeTab === "analytics")} onClick={() => setActiveTab("analytics")}>
            <BarChart3 size={13} /> Room &amp; Doctor analytics
          </button>
          <button style={S.tab(activeTab === "schedule")} onClick={() => setActiveTab("schedule")}>
            <Clock size={13} /> Schedule Manager
          </button>
        </div>
      </div>

      <div style={S.body}>

        {/* TAB: USERS */}
        {activeTab === "users" && (
          <div>
            <div style={S.sectionHead}>
              <div>
                <h3 style={S.sectionTitle}>Clinician accounts</h3>
                <p style={S.sectionSub}>Manage and create staff accounts in your Supabase database.</p>
              </div>
              <button style={S.btnPrimary()} onClick={() => { setUsersError(null); setSubmitSuccess(null); setIsAddingUser(!isAddingUser); }}>
                <UserPlus size={13} />
                {isAddingUser ? "Cancel" : "Add clinician"}
              </button>
            </div>

            {usersError && (
              <div style={{ background: "#f9ecec", border: "0.5px solid #e7bcbc", borderRadius: "8px", padding: "10px 14px", marginBottom: "16px", fontSize: "12px", color: "#7a2826", display: "flex", gap: "8px" }}>
                <AlertCircle size={14} style={{ flexShrink: 0, marginTop: "1px" }} /> {usersError}
              </div>
            )}
            {submitSuccess && (
              <div style={{ background: "#e7f2ec", border: "0.5px solid #b5d6c5", borderRadius: "8px", padding: "10px 14px", marginBottom: "16px", fontSize: "12px", color: "#24503c", display: "flex", gap: "8px" }}>
                <Check size={14} style={{ flexShrink: 0 }} /> {submitSuccess}
              </div>
            )}

            {isAddingUser && (
              <div style={{ background: "#101b26", border: "0.5px solid #2b3949", borderRadius: "10px", padding: "20px", marginBottom: "20px", maxWidth: "480px" }}>
                <div style={{ fontSize: "11px", color: "#6e9cc9", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "16px", paddingBottom: "12px", borderBottom: "0.5px solid #1c2836", display: "flex", alignItems: "center", gap: "6px" }}>
                  <UserPlus size={12} /> New clinician registration
                </div>
                <form onSubmit={handleAddNewUser} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                  <div style={{ gridColumn: "1/-1" }}>
                    <label style={{ ...S.label, color: "#8a96a5" }}>Full name</label>
                    <input type="text" required placeholder="Dr. Robert Carter" value={newName} onChange={e => setNewName(e.target.value)} style={{ ...S.input, background: "#101b26", border: "0.5px solid #3c4b5c", color: "#f6f8fa" }} />
                  </div>
                  <div>
                    <label style={{ ...S.label, color: "#8a96a5" }}>Email (used to sign in)</label>
                    <input type="email" required placeholder="rcarter@clinic.com" value={newEmail} onChange={e => setNewEmail(e.target.value)} style={{ ...S.input, background: "#101b26", border: "0.5px solid #3c4b5c", color: "#f6f8fa", fontFamily: "monospace" }} />
                  </div>
                  <div>
                    <label style={{ ...S.label, color: "#8a96a5" }}>Password</label>
                    <input type="password" required placeholder="••••••••" value={newPassword} onChange={e => setNewPassword(e.target.value)} style={{ ...S.input, background: "#101b26", border: "0.5px solid #3c4b5c", color: "#f6f8fa" }} />
                  </div>
                  <div style={{ gridColumn: "1/-1" }}>
                    <label style={{ ...S.label, color: "#8a96a5" }}>Role</label>
                    <select value={newRole} onChange={e => setNewRole(e.target.value as any)} style={{ ...S.input, background: "#101b26", border: "0.5px solid #3c4b5c", color: "#c9d2dc" }}>
                      <option value="secretary">Secretary — Calendar scheduling</option>
                      <option value="doctor">Physician — Lab extractor</option>
                      <option value="admin">Administrator — Full access</option>
                      <option value="pharmacy">Pharmacy — Inventory & vendors</option>
                      <option value="nurse">Nurse — Dispense & charge medicine</option>
                    </select>
                  </div>
                  <div style={{ gridColumn: "1/-1" }}>
                    <label style={{ ...S.label, color: "#8a96a5" }}>Phone number (for WhatsApp updates)</label>
                    <input type="text" placeholder="e.g. +961 3 123 456" value={newPhone} onChange={e => setNewPhone(e.target.value)} style={{ ...S.input, background: "#101b26", border: "0.5px solid #3c4b5c", color: "#f6f8fa" }} />
                  </div>
                  <div style={{ gridColumn: "1/-1", display: "flex", justifyContent: "flex-end", gap: "8px", paddingTop: "8px", borderTop: "0.5px solid #1c2836" }}>
                    <button type="button" onClick={() => setIsAddingUser(false)} style={{ padding: "7px 14px", background: "#1c2836", border: "0.5px solid #3c4b5c", borderRadius: "7px", color: "#8a96a5", fontSize: "12px", cursor: "pointer" }}>Cancel</button>
                    <button type="submit" style={S.btnPrimary()}>Save to Supabase</button>
                  </div>
                </form>
              </div>
            )}

            <div style={S.card}>
              <div style={S.cardHeader}>
                <span style={S.cardHeaderLabel}>Active users — profiles (Supabase Auth)</span>
                <button onClick={fetchClinicUsers} style={{ background: "none", border: "none", cursor: "pointer", color: "#5d6b7c" }} title="Refresh">
                  <RefreshCw size={13} />
                </button>
              </div>
              {isUsersLoading ? (
                <div style={{ padding: "40px", textAlign: "center", color: "#8a96a5", fontSize: "13px" }}>Loading users...</div>
              ) : dbUsers.length === 0 ? (
                <div style={{ padding: "40px", textAlign: "center", color: "#8a96a5", fontSize: "13px" }}>No users found. Add one above.</div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                  <thead>
                    <tr style={{ background: "#f6f8fa" }}>
                      {["Name", "Email", "Phone", "Role", "ID"].map(h => (
                        <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: "10px", color: "#8a96a5", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "0.5px solid #dee4eb" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dbUsers.map((user, i) => (
                      <tr key={i} style={{ borderBottom: "0.5px solid #edf1f5" }}>
                        <td style={{ padding: "10px 14px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <div style={{ width: "26px", height: "26px", borderRadius: "50%", background: "#dee9f3", color: "#2a5178", fontSize: "11px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{(user.full_name || "?")[0]}</div>
                            <span style={{ fontWeight: 600, color: "#26313e" }}>{user.full_name}</span>
                          </div>
                        </td>
                        <td style={{ padding: "10px 14px", fontFamily: "monospace", color: "#3c4b5c", fontSize: "12px" }}>{user.email}</td>
                        <td style={{ padding: "10px 14px", fontFamily: "monospace", color: "#3c4b5c" }}>{user.phone || "—"}</td>
                        <td style={{ padding: "10px 14px" }}>{roleBadge(user.role)}</td>
                        <td style={{ padding: "10px 14px", fontFamily: "monospace", color: "#8a96a5", fontSize: "11px" }}>{user.id ? user.id.slice(0, 8) : `ROW-${i + 1}`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* TAB: ACCESS */}
        {activeTab === "access" && (
          <div>
            <div style={S.sectionHead}>
              <div>
                <h3 style={S.sectionTitle}>Access timetable</h3>
                <p style={S.sectionSub}>Set and manage staff login date ranges and permissions.</p>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: "16px" }}>
              <div style={{ ...S.card, padding: "16px" }}>
                <div style={{ fontSize: "12px", fontWeight: 600, color: "#3c4b5c", marginBottom: "14px", paddingBottom: "10px", borderBottom: "0.5px solid #dee4eb" }}>
                  Add access rule
                </div>
                <form onSubmit={handleAddSchedule} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {[
                    { label: "Full name", val: schedName, set: setSchedName, placeholder: "Dr. Robert Carter", mono: false },
                    { label: "Username", val: schedUsername, set: setSchedUsername, placeholder: "r_carter", mono: true },
                  ].map(({ label, val, set, placeholder, mono }) => (
                    <div key={label}>
                      <label style={S.label}>{label}</label>
                      <input required placeholder={placeholder} value={val} onChange={e => set(e.target.value)} style={{ ...S.input, fontFamily: mono ? "monospace" : "inherit" }} />
                    </div>
                  ))}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                    <div><label style={S.label}>From</label><input type="date" required value={schedStartDate} onChange={e => setSchedStartDate(e.target.value)} style={S.input} /></div>
                    <div><label style={S.label}>Until</label><input type="date" required value={schedEndDate} onChange={e => setSchedEndDate(e.target.value)} style={S.input} /></div>
                  </div>
                  <button type="submit" style={{ ...S.btnPrimary(), justifyContent: "center", marginTop: "4px" }}>Set access range</button>
                </form>
              </div>

              <div style={S.card}>
                <div style={S.cardHeader}>
                  <span style={S.cardHeaderLabel}>Authorized roster — {accessRecords.length} records</span>
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                  <thead>
                    <tr style={{ background: "#f6f8fa" }}>
                      {["Personnel", "Valid from", "Valid until", "Status", ""].map(h => (
                        <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: "10px", color: "#8a96a5", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "0.5px solid #dee4eb" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {accessRecords.map(rec => (
                      <tr key={rec.id} style={{ borderBottom: "0.5px solid #edf1f5" }}>
                        <td style={{ padding: "10px 14px" }}>
                          <div style={{ fontWeight: 600, color: "#26313e" }}>{rec.name}</div>
                          <div style={{ fontSize: "11px", color: "#8a96a5", fontFamily: "monospace" }}>{rec.username}</div>
                        </td>
                        <td style={{ padding: "10px 14px", fontFamily: "monospace", fontSize: "12px", color: "#3c4b5c" }}>{rec.allowedStartDate}</td>
                        <td style={{ padding: "10px 14px", fontFamily: "monospace", fontSize: "12px", color: "#3c4b5c" }}>{rec.allowedEndDate}</td>
                        <td style={{ padding: "10px 14px" }}>
                          <span style={{ fontSize: "11px", padding: "2px 8px", borderRadius: "20px", fontWeight: 500, background: rec.status === "active" ? "#d5e8de" : "#f5e7c8", color: rec.status === "active" ? "#24503c" : "#5c4514" }}>{rec.status}</span>
                        </td>
                        <td style={{ padding: "10px 14px", textAlign: "right" }}>
                          <button onClick={() => setAccessRecords(accessRecords.filter(r => r.id !== rec.id))} style={{ background: "none", border: "none", cursor: "pointer", color: "#c9d2dc" }}>
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB: ACCOUNTING */}
        {activeTab === "accounting" && (
          <div>
            <div style={S.sectionHead}>
              <div>
                <h3 style={S.sectionTitle}>Clinical financial desk</h3>
                <p style={S.sectionSub}>Monitor cash flow, log records, and review the practice ledger.</p>
              </div>
            </div>

            {/* Alert if negative */}
            {netGain < 0 && (
              <div style={{ background: "#f9ecec", border: "0.5px solid #e7bcbc", borderRadius: "8px", padding: "12px 16px", marginBottom: "20px", display: "flex", alignItems: "center", gap: "10px", fontSize: "13px", color: "#7a2826" }}>
                <AlertCircle size={16} style={{ flexShrink: 0 }} />
                <span><strong>Net margin is negative (${netGain.toFixed(2)}).</strong> Operating expenses exceed income. Review the ledger below.</span>
              </div>
            )}

            {/* Metrics */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "12px", marginBottom: "20px" }}>
              {[
                { label: "Total income", value: `$${totalRevenue.toFixed(2)}`, sub: "Consultations & labs", icon: <TrendingUp size={14} />, color: "#438a6a", bg: "#e7f2ec" },
                { label: "Operating expenses", value: `$${totalExpenses.toFixed(2)}`, sub: "Rent, wages & licenses", icon: <TrendingDown size={14} />, color: "#c05654", bg: "#f9ecec" },
                { label: "Net margin", value: `${netGain < 0 ? "-" : "+"}$${Math.abs(netGain).toFixed(2)}`, sub: "Cleared cash flow", icon: <DollarSign size={14} />, color: netGain >= 0 ? "#438a6a" : "#c05654", bg: netGain >= 0 ? "#e7f2ec" : "#f9ecec" },
              ].map(m => (
                <div key={m.label} style={S.metricCard}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
                    <span style={{ fontSize: "11px", color: "#5d6b7c", fontWeight: 500 }}>{m.label}</span>
                    <span style={{ background: m.bg, color: m.color, padding: "4px", borderRadius: "6px" }}>{m.icon}</span>
                  </div>
                  <div style={{ fontSize: "22px", fontWeight: 600, color: m.color }}>{m.value}</div>
                  <div style={{ fontSize: "11px", color: "#8a96a5", marginTop: "4px" }}>{m.sub}</div>
                </div>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: "16px" }}>
              {/* Form */}
              <div style={{ ...S.card, padding: "16px" }}>
                <div style={{ fontSize: "12px", fontWeight: 600, color: "#3c4b5c", marginBottom: "14px", paddingBottom: "10px", borderBottom: "0.5px solid #dee4eb" }}>Log new record</div>
                <form onSubmit={handleAddTx} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <div>
                    <label style={S.label}>Type</label>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
                      {(["revenue", "expense"] as const).map(t => (
                        <button key={t} type="button" onClick={() => setNewTxType(t)} style={{ padding: "7px", borderRadius: "7px", border: "0.5px solid", cursor: "pointer", fontSize: "12px", fontWeight: 600, background: newTxType === t ? (t === "revenue" ? "#24503c" : "#7a2826") : "#f6f8fa", color: newTxType === t ? "#fcfdfe" : "#3c4b5c", borderColor: newTxType === t ? "transparent" : "#dee4eb" }}>
                          {t === "revenue" ? "Revenue +" : "Expense −"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                    <div><label style={S.label}>Date</label><input type="date" value={newTxDate} onChange={e => setNewTxDate(e.target.value)} style={S.input} /></div>
                    <div><label style={S.label}>Amount ($)</label><input type="number" step="0.01" required placeholder="0.00" value={newTxAmount} onChange={e => setNewTxAmount(e.target.value)} style={{ ...S.input, fontFamily: "monospace" }} /></div>
                  </div>
                  <div>
                    <label style={S.label}>Category</label>
                    <select value={newTxCategory} onChange={e => setNewTxCategory(e.target.value)} style={S.input}>
                      {["Patient Consultation", "Hematology Lab", "Prescription Scan", "Clinic Rent", "Staff Salary", "AI Pipeline License"].map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={S.label}>Description</label>
                    <textarea placeholder="e.g. Monthly lease payment" value={newTxDesc} onChange={e => setNewTxDesc(e.target.value)} style={{ ...S.input, height: "56px", resize: "none" }} />
                  </div>
                  <button type="submit" style={{ ...S.btnPrimary(), justifyContent: "center" }}>Save record</button>
                </form>
              </div>

              {/* Ledger */}
              <div style={S.card}>
                <div style={S.cardHeader}>
                  <span style={S.cardHeaderLabel}>Financial ledger — {accountingEntries.length} entries</span>
                  <span style={{ fontSize: "12px", fontWeight: 600, color: netGain < 0 ? "#c05654" : "#438a6a" }}>
                    Net: {netGain < 0 ? "-" : "+"}${Math.abs(netGain).toFixed(2)}
                  </span>
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                  <thead>
                    <tr style={{ background: "#f6f8fa" }}>
                      {["Date", "Category", "Description", "Amount", ""].map(h => (
                        <th key={h} style={{ padding: "10px 14px", textAlign: h === "Amount" ? "right" : "left", fontSize: "10px", color: "#8a96a5", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "0.5px solid #dee4eb" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {accountingEntries.map(tx => (
                      <tr key={tx.id} style={{ borderBottom: "0.5px solid #edf1f5" }}>
                        <td style={{ padding: "10px 14px", fontFamily: "monospace", fontSize: "12px", color: "#5d6b7c" }}>{tx.date}</td>
                        <td style={{ padding: "10px 14px" }}>
                          <span style={{ fontSize: "11px", padding: "2px 8px", borderRadius: "20px", background: "#edf1f5", color: "#3c4b5c", fontWeight: 500 }}>{tx.category}</span>
                          {tx.status === "pending" && <span style={{ marginLeft: "6px", fontSize: "10px", color: "#8f6d1e", background: "#f5e7c8", padding: "1px 6px", borderRadius: "10px" }}>Pending</span>}
                        </td>
                        <td style={{ padding: "10px 14px", color: "#5d6b7c", fontSize: "12px" }}>{tx.description}</td>
                        <td style={{ padding: "10px 14px", textAlign: "right", fontFamily: "monospace", fontWeight: 600, color: tx.type === "revenue" ? "#35795c" : "#b3403e" }}>
                          {tx.type === "revenue" ? "+" : "−"}${tx.amount.toFixed(2)}
                        </td>
                        <td style={{ padding: "10px 14px", textAlign: "right" }}>
                          <button onClick={() => setAccountingEntries(accountingEntries.filter(t => t.id !== tx.id))} style={{ background: "none", border: "none", cursor: "pointer", color: "#c9d2dc" }}>
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}

        {/* TAB: MANAGE ROOMS */}
        {activeTab === "rooms" && (
          <div>
            <div style={S.sectionHead}>
              <div>
                <h3 style={S.sectionTitle}>Physical Suites & Medical Equipment Rooms</h3>
                <p style={S.sectionSub}>Register clinical examination suites, map active medical machines, and configure capacities.</p>
              </div>
              <button 
                onClick={() => { fetchRooms(); }} 
                disabled={isRoomsLoading}
                style={{ ...S.btnPrimary(), opacity: isRoomsLoading ? 0.6 : 1 }}
              >
                <RefreshCw size={13} className={isRoomsLoading ? "animate-spin" : ""} />
                {isRoomsLoading ? "Syncing..." : "Sync Rooms"}
              </button>
            </div>

            {roomsError && (
              <div style={{ background: "#f9ecec", border: "0.5px solid #e7bcbc", borderRadius: "8px", padding: "12px 14px", marginBottom: "16px", fontSize: "12px", color: "#7a2826", display: "flex", gap: "8px" }}>
                <AlertCircle size={14} style={{ flexShrink: 0, marginTop: "1px" }} /> {roomsError}
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: "20px", alignItems: "start" }} className="max-md:grid-cols-1">
              {/* Rooms List Card */}
              <div style={S.card}>
                <div style={S.cardHeader}>
                  <span style={S.cardHeaderLabel}>Active Rooms Catalog ({rooms.length})</span>
                  <span style={{ fontSize: "11px", color: "#4a7ba6", fontWeight: 500 }}>Configured on Supabase rooms table</span>
                </div>
                <div style={{ padding: "16px" }}>
                  {rooms.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "40px 20px", color: "#5d6b7c" }}>
                      <Building2 size={36} style={{ color: "#c9d2dc", margin: "0 auto 12px" }} />
                      <p style={{ fontWeight: 600, fontSize: "13px", margin: "0 0 4px" }}>No registered suites found</p>
                      <p style={{ fontSize: "12px", margin: 0 }}>Register clinical suites at the side panel or execute the SQL editor script.</p>
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                      {rooms.map((room) => (
                        <div 
                          key={room.id || room.name} 
                          style={{ 
                            border: "0.5px solid #dee4eb", 
                            borderRadius: "10px", 
                            padding: "14px", 
                            background: "#fcfdfe",
                            display: "flex",
                            justifyContent: "space-between",
                            gap: "16px"
                          }}
                        >
                          <div style={{ flex: 1 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                              <h4 style={{ margin: 0, fontSize: "13px", fontWeight: 700, color: "#26313e" }}>{room.name}</h4>
                              <span style={{ fontSize: "10px", fontWeight: 700, background: "var(--theme-accent-bg)", color: "var(--theme-accent)", padding: "2px 8px", borderRadius: "20px" }}>
                                Capacity: {room.capacity || 1} staff
                              </span>
                            </div>
                            
                            {room.description && (
                              <p style={{ margin: "0 0 10px 0", fontSize: "12px", color: "#5d6b7c" }}>{room.description}</p>
                            )}
                            
                            {/* Medical Machines list (Pure DB sync state as requested) */}
                            <div>
                              <span style={{ display: "block", fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "#4a5a6d", marginBottom: "4px" }}>
                                Registered Medical Machines & Hardware
                              </span>
                              {room.machines ? (
                                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                                  {room.machines.split(",").map((m: string, idx: number) => {
                                    const cleaned = m.trim();
                                    if (!cleaned) return null;
                                    return (
                                      <span key={idx} style={{ fontSize: "10px", background: "#edf1f5", color: "#3c4b5c", padding: "1px 6px", borderRadius: "4px", border: "0.5px solid #c9d2dc" }}>
                                        {cleaned}
                                      </span>
                                    );
                                  })}
                                </div>
                              ) : (
                                <span style={{ fontSize: "11px", color: "#8a96a5", fontStyle: "italic" }}>
                                  No registered medical hardware inside this room catalog.
                                </span>
                              )}
                            </div>
                          </div>

                          <div style={{ display: "flex", flexDirection: "column", gap: "6px", justifyContent: "center" }}>
                            <button 
                              onClick={() => setEditingRoom(room)}
                              style={{ ...S.btnGhost, padding: "5px 10px", fontSize: "11px" }}
                            >
                              Edit Info
                            </button>
                            <button 
                              onClick={() => handleDeleteRoom(room.id)}
                              style={{ ...S.btnGhost, padding: "5px 10px", fontSize: "11px", color: "#96322f", borderColor: "#e7bcbc" }}
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Sidebar Action Block (Add/Edit) */}
              <div>
                {/* EDITING SUITE */}
                {editingRoom ? (
                  <div style={{ ...S.card, padding: "16px", background: "#edf3f8", border: "0.5px solid #9dbbd6" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
                      <span style={{ fontSize: "12px", fontWeight: 700, color: "#224264", fontFamily: "monospace", textTransform: "uppercase" }}>
                        Modify Clinical Suite
                      </span>
                      <button onClick={() => setEditingRoom(null)} style={{ border: "none", background: "none", cursor: "pointer", color: "#5d6b7c" }}>
                        <X size={14} />
                      </button>
                    </div>

                    <form onSubmit={handleEditRoomSubmit} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                      <div>
                        <label style={S.label}>Suite Name / ID</label>
                        <input 
                          type="text" 
                          required
                          value={editingRoom.name} 
                          onChange={(e) => setEditingRoom({ ...editingRoom, name: e.target.value })}
                          style={S.input} 
                        />
                      </div>

                      <div>
                        <label style={S.label}>Clinical Description</label>
                        <textarea 
                          rows={2}
                          value={editingRoom.description || ""} 
                          onChange={(e) => setEditingRoom({ ...editingRoom, description: e.target.value })}
                          style={{ ...S.input, resize: "vertical", fontFamily: "inherit" }} 
                        />
                      </div>

                      <div>
                        <label style={S.label}>Medical Hardware (Comma Separated)</label>
                        <input 
                          type="text" 
                          placeholder="e.g. CT Scanner, Ultrasonography Machine"
                          value={editingRoom.machines || ""} 
                          onChange={(e) => setEditingRoom({ ...editingRoom, machines: e.target.value })}
                          style={S.input} 
                        />
                        <span style={{ fontSize: "9px", color: "#5d6b7c", marginTop: "2px", display: "block" }}>
                          Type hardware separated by commas. Saved parameters persist on Supabase rooms.
                        </span>
                      </div>

                      <div>
                        <label style={S.label}>Suite Doctor Capacity</label>
                        <input 
                          type="number" 
                          min={1}
                          required
                          value={editingRoom.capacity || 1} 
                          onChange={(e) => setEditingRoom({ ...editingRoom, capacity: Number(e.target.value) })}
                          style={S.input} 
                        />
                      </div>

                      <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
                        <button type="submit" style={S.btnPrimary()}>
                          Save Updates
                        </button>
                        <button type="button" onClick={() => setEditingRoom(null)} style={S.btnGhost}>
                          Cancel
                        </button>
                      </div>
                    </form>
                  </div>
                ) : (
                  /* REGISTER NEW SUITE */
                  <div style={{ ...S.card, padding: "16px" }}>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: "#1b344e", fontFamily: "monospace", textTransform: "uppercase", marginBottom: "14px" }}>
                      Register Suite A, B, C or custom
                    </div>

                    <form onSubmit={handleAddRoom} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                      <div>
                        <label style={S.label}>Suite Name / Designation</label>
                        <input 
                          type="text" 
                          required
                          placeholder="e.g. Room A, Room B, Suite 101"
                          value={roomName} 
                          onChange={(e) => setRoomName(e.target.value)}
                          style={S.input} 
                        />
                      </div>

                      <div>
                        <label style={S.label}>Visual Description</label>
                        <textarea 
                          rows={2}
                          placeholder="Provide outpatient care suite details..."
                          value={roomDescription} 
                          onChange={(e) => setRoomDescription(e.target.value)}
                          style={{ ...S.input, resize: "vertical", fontFamily: "inherit" }} 
                        />
                      </div>

                      <div>
                        <label style={S.label}>Medical Hardware & Machines (Comma Separated)</label>
                        <input 
                          type="text" 
                          placeholder="e.g. Hematology System, CT Scanner"
                          value={roomMachines} 
                          onChange={(e) => setRoomMachines(e.target.value)}
                          style={S.input} 
                        />
                        <span style={{ fontSize: "9px", color: "#5d6b7c", marginTop: "2px", display: "block" }}>
                          Used purely to configure medical infrastructure on the backend Supabase catalog.
                        </span>
                      </div>

                      <div>
                        <label style={S.label}>Coexisting Doctor capacity</label>
                        <input 
                          type="number" 
                          min={1}
                          required
                          value={roomCapacity} 
                          onChange={(e) => setRoomCapacity(Number(e.target.value))}
                          style={S.input} 
                        />
                      </div>

                      <button type="submit" style={{ ...S.btnPrimary(), marginTop: "4px", width: "100%", justifyContent: "center" }}>
                        <Plus size={13} />
                        Add Suite
                      </button>
                    </form>
                  </div>
                )}
              </div>
            </div>

          </div>
        )}

        {/* TAB: ANALYTICS */}
        {activeTab === "analytics" && (
          <div>
            <div style={S.sectionHead}>
              <div>
                <h3 style={S.sectionTitle}>Physician & Room Utilization Analysis</h3>
                <p style={S.sectionSub}>Analyze room usage loads, physician allocation, and schedule metrics across dynamic console parameters.</p>
              </div>
              <button 
                onClick={() => { fetchAppointmentsForAnalytics(); }} 
                disabled={isAptsLoading}
                style={{ ...S.btnPrimary(), opacity: isAptsLoading ? 0.6 : 1 }}
              >
                <RefreshCw size={13} className={isAptsLoading ? "animate-spin" : ""} />
                {isAptsLoading ? "Syncing..." : "Sync Database"}
              </button>
            </div>

            {/* Alert info */}
            {aptsError && (
              <div style={{ background: "#edf3f8", border: "0.5px solid #c2d5e7", borderRadius: "8px", padding: "10px 14px", marginBottom: "16px", fontSize: "12px", color: "#1b344e", display: "flex", gap: "8px" }}>
                <Info size={14} style={{ flexShrink: 0, marginTop: "1px" }} /> {aptsError}
              </div>
            )}

            {/* Parametrical Controls Header */}
            <div style={{ background: "#fcfdfe", border: "0.5px solid #dee4eb", borderRadius: "10px", padding: "16px", marginBottom: "20px" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--theme-accent)", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "12px" }}>
                Dashboard Parameters
              </div>
              
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
                <div>
                  <label style={S.label}>Assigned Physician Parameter</label>
                  <select
                    value={selectedDoctorParam}
                    onChange={e => setSelectedDoctorParam(e.target.value)}
                    style={S.input}
                  >
                    <option value="all">
                      All Physicians{doctorNames.length > 0 ? ` (${doctorNames.join(", ")})` : ""}
                    </option>
                    {doctorNames.map((name, idx) => (
                      <option key={idx} value={name}>{name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={S.label}>Room Utilization Location</label>
                  <select 
                    value={selectedRoomParam} 
                    onChange={e => setSelectedRoomParam(e.target.value)}
                    style={S.input}
                  >
                    <option value="all">All Rooms ({rooms.map(r => r.name).join(", ")})</option>
                    {rooms.map((r, idx) => (
                      <option key={idx} value={r.name}>{r.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={S.label}>Analyzed Date Range (From)</label>
                  <input 
                    type="date" 
                    value={selectedStartDateParam} 
                    onChange={e => setSelectedStartDateParam(e.target.value)}
                    style={S.input} 
                  />
                </div>

                <div>
                  <label style={S.label}>Analyzed Date Range (Until)</label>
                  <input 
                    type="date" 
                    value={selectedEndDateParam} 
                    onChange={e => setSelectedEndDateParam(e.target.value)}
                    style={S.input} 
                  />
                </div>
              </div>
            </div>

            {/* Compute and display values based on active filters */}
            {(() => {
              // Filters execution
              const filtered = appointments.filter(apt => {
                const matchDoc = selectedDoctorParam === "all" || apt.doctorName === selectedDoctorParam;
                const matchRoom = selectedRoomParam === "all" || apt.room === selectedRoomParam;
                const matchDate = apt.dateStr >= selectedStartDateParam && apt.dateStr <= selectedEndDateParam;
                return matchDoc && matchRoom && matchDate;
              });

              const totalHours = filtered.reduce((acc, curr) => acc + (curr.durationHours || 1), 0);
              const totalSlots = filtered.length;

              // Compute allocations
              const roomAlloc: Record<string, number> = {};
              rooms.forEach(r => { roomAlloc[r.name] = 0; });
              const docAlloc: Record<string, number> = {};
              doctorNames.forEach(name => { docAlloc[name] = 0; });

              filtered.forEach(apt => {
                const r = apt.room || "Unassigned";
                const d = apt.doctorName || "Unassigned";
                const h = apt.durationHours || 1;

                roomAlloc[r] = (roomAlloc[r] || 0) + h;
                docAlloc[d] = (docAlloc[d] || 0) + h;
              });

              return (
                <div>
                  {/* Dynamic Metrics cards inline */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", marginBottom: "20px" }}>
                    <div style={S.metricCard}>
                      <span style={{ fontSize: "11px", color: "#5d6b7c", fontWeight: 500 }}>Active Equipment Hours</span>
                      <div style={{ fontSize: "24px", fontWeight: 700, color: "#1b344e", marginTop: "4px" }}>
                        {totalHours} hrs
                      </div>
                      <span style={{ fontSize: "10px", color: "#8a96a5", marginTop: "2px" }}>Capacity allocated across filters</span>
                    </div>

                    <div style={S.metricCard}>
                      <span style={{ fontSize: "11px", color: "#5d6b7c", fontWeight: 500 }}>Active Sessions count</span>
                      <div style={{ fontSize: "24px", fontWeight: 700, color: "#1b344e", marginTop: "4px" }}>
                        {totalSlots} appointments
                      </div>
                      <span style={{ fontSize: "10px", color: "#8a96a5", marginTop: "2px" }}>Continuous clinic occupancies</span>
                    </div>

                    <div style={S.metricCard}>
                      <span style={{ fontSize: "11px", color: "#5d6b7c", fontWeight: 500 }}>Load Density rating</span>
                      <div style={{ fontSize: "24px", fontWeight: 700, color: totalHours > 12 ? "#96322f" : "#2a5178", marginTop: "4px" }}>
                        {totalHours === 0 ? "Empty" : totalHours > 15 ? "Critical Peak" : totalHours > 8 ? "Moderate Load" : "Light usage"}
                      </div>
                      <span style={{ fontSize: "10px", color: "#8a96a5", marginTop: "2px" }}>Real-time room occupancy state</span>
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                    {/* Room Usage load Breakdown */}
                    <div style={{ ...S.card, padding: "16px" }}>
                      <div style={{ fontSize: "12px", fontWeight: 600, color: "#26313e", marginBottom: "14px", paddingBottom: "10px", borderBottom: "0.5px solid #dee4eb" }}>
                        Room Usage Load Distribution (Hours Occupied)
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                        {Object.entries(roomAlloc).map(([roomName, hours]) => {
                          const pct = totalHours > 0 ? Math.round((hours / totalHours) * 100) : 0;
                          return (
                            <div key={roomName}>
                              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#3c4b5c", marginBottom: "4px", fontWeight: 500 }}>
                                <span style={{ fontWeight: 600 }}>{roomName}</span>
                                <span>{hours} {hours === 1 ? "hour" : "hours"} ({pct}%)</span>
                              </div>
                              <div style={{ width: "100%", height: "8px", background: "#edf1f5", borderRadius: "10px", overflow: "hidden" }}>
                                <div style={{ width: `${pct}%`, height: "100%", background: roomName === "Room A" ? "var(--theme-accent)" : roomName === "Room B" ? "#438a6a" : roomName === "Room C" ? "#cfa34d" : "#4a7ba6", borderRadius: "10px", transition: "width 0.3s" }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Physician occupancy Breakdown */}
                    <div style={{ ...S.card, padding: "16px" }}>
                      <div style={{ fontSize: "12px", fontWeight: 600, color: "#26313e", marginBottom: "14px", paddingBottom: "10px", borderBottom: "0.5px solid #dee4eb" }}>
                        Physician Assigned Equipment Hours
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                        {Object.entries(docAlloc).map(([doctor, hours]) => {
                          const pct = totalHours > 0 ? Math.round((hours / totalHours) * 100) : 0;
                          return (
                            <div key={doctor}>
                              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#3c4b5c", marginBottom: "4px", fontWeight: 500 }}>
                                <span style={{ fontWeight: 600 }}>{doctor}</span>
                                <span>{hours} {hours === 1 ? "hour" : "hours"} ({pct}%)</span>
                              </div>
                              <div style={{ width: "100%", height: "8px", background: "#edf1f5", borderRadius: "10px", overflow: "hidden" }}>
                                <div style={{ width: `${pct}%`, height: "100%", background: "var(--theme-accent)", borderRadius: "10px", transition: "width 0.3s" }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Filtered active roster detailed table lists */}
                  <div style={{ ...S.card, marginTop: "20px" }}>
                    <div style={S.cardHeader}>
                      <span style={S.cardHeaderLabel}>Parameters match list &mdash; {totalSlots} sessions found</span>
                    </div>
                    {filtered.length === 0 ? (
                      <div style={{ padding: "40px", textAlign: "center", color: "#5d6b7c", fontSize: "12px" }}>
                        No records match the active parameter combinations. Check the date ranges above.
                      </div>
                    ) : (
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                        <thead>
                          <tr style={{ background: "#f6f8fa" }}>
                            {["Patient Name", "Assigned Physician", "Active Room", "Duration Locked", "Date slot"].map(h => (
                              <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: "10px", color: "#8a96a5", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "0.5px solid #dee4eb" }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map((item, idx) => (
                            <tr key={idx} style={{ borderBottom: "0.5px solid #edf1f5" }}>
                              <td style={{ padding: "10px 14px", fontWeight: 600, color: "#26313e" }}>{item.patientName}</td>
                              <td style={{ padding: "10px 14px", color: "#4a5a6d" }}>{item.doctorName}</td>
                              <td style={{ padding: "10px 14px" }}>
                                <span style={{ background: item.room === "Room B" ? "#e7f2ec" : item.room === "Room C" ? "#faf3e3" : "#edf3f8", color: item.room === "Room B" ? "#2c6349" : item.room === "Room C" ? "#75581a" : "#33608d", padding: "2px 8px", borderRadius: "12px", fontSize: "11px", fontWeight: 700 }}>
                                  {item.room || "Room A"}
                                </span>
                              </td>
                              <td style={{ padding: "10px 14px", fontFamily: "monospace", fontWeight: 600, color: "#1f2e3e" }}>
                                {item.durationHours || 1} {(item.durationHours || 1) === 1 ? "hour" : "hours"}
                              </td>
                              <td style={{ padding: "10px 14px", fontFamily: "monospace", color: "#5d6b7c", fontSize: "12px" }}>
                                {item.dateStr} @ {item.appointmentTime}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>

                  {/* Supabase SQL Migration block */}
                  <div style={{ background: "#101b26", border: "0.5px solid #2b3949", borderRadius: "10px", padding: "20px", marginTop: "20px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "14px", paddingBottom: "14px", borderBottom: "0.5px solid #1c2836" }}>
                      <div>
                        <div style={{ fontSize: "11px", color: "#6e9cc9", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "4px", display: "flex", alignItems: "center", gap: "6px" }}>
                          <Code size={12} /> Supabase SQL Room Migration Query
                        </div>
                        <p style={{ fontSize: "12px", color: "#5d6b7c", margin: 0 }}>Execute this query inside your Supabase dashboard SQL editor to append Room classifications to the DB.</p>
                      </div>
                      <button 
                        onClick={() => {
                          const query = `-- Run in Supabase SQL editor to modify schema with room columns 
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS room text DEFAULT 'Room A' NOT NULL;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS duration_hours integer DEFAULT 1 NOT NULL;`;
                          navigator.clipboard.writeText(query);
                          setCopiedText("sql_migration");
                          setTimeout(() => setCopiedText(null), 2000);
                        }} 
                        style={{ padding: "6px 12px", background: "#1c2836", border: "0.5px solid #2b3949", borderRadius: "6px", color: "#6e9cc9", fontSize: "11px", fontFamily: "monospace", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px" }}
                      >
                        {copiedText === "sql_migration" ? <><Check size={11} style={{ color: "#438a6a" }} /> Copied</> : <><Copy size={11} /> Copy SQL</>}
                      </button>
                    </div>
                    <pre style={{ background: "#0d141c", border: "0.5px solid #1c2836", borderRadius: "8px", padding: "16px", fontFamily: "monospace", fontSize: "11px", color: "#8a96a5", overflowX: "auto", margin: 0, lineHeight: 1.6 }}>
{`-- SQL Alteration Query
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS room text DEFAULT 'Room A' NOT NULL;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS duration_hours integer DEFAULT 1 NOT NULL;`}
                    </pre>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* TAB: SCHEDULE MANAGER */}
        {activeTab === "schedule" && (
          <div style={{ background: "#fcfdfe", borderRadius: "10px", padding: "24px", border: "0.5px solid #dee4eb", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
            <ScheduleManagerView isAdmin={currentUser?.role === "admin"} />
          </div>
        )}
      </div>
    </div>
  );
}