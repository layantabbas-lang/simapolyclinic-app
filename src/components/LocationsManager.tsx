import React, { useState, useEffect } from "react";
import { MapPin, Plus, Trash2, Edit2, Save, X, Check, AlertCircle, EyeOff, Eye } from "lucide-react";
import { supabase } from "../supabaseClient";
import { UserSession } from "../types";

interface LocationsManagerProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser?: UserSession | null;
}

export interface DoctorLocation {
  id: string;
  doctor_id: string;
  name: string;
  is_active: boolean;
  sort_order: number;
}

// Lets a doctor maintain his own list of places he sees patients -- e.g.
// "Main Clinic", "Downtown Clinic", "Home Visit" -- so appointments and
// visit notes can be tagged with where the encounter actually happened.
// Built for a doctor who works across more than one location rather than
// a single fixed clinic.
export default function LocationsManager({ isOpen, onClose, currentUser }: LocationsManagerProps) {
  const [locations, setLocations] = useState<DoctorLocation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  useEffect(() => {
    if (isOpen) fetchLocations();
  }, [isOpen]);

  const showStatus = (text: string, type: "success" | "error") => {
    setStatusMessage({ text, type });
    setTimeout(() => setStatusMessage(null), 4000);
  };

  const fetchLocations = async () => {
    if (!currentUser?.staffId) return;
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("doctor_locations")
        .select("*")
        .eq("doctor_id", currentUser.staffId)
        .order("sort_order")
        .order("created_at");
      if (error) throw error;
      setLocations(data || []);
    } catch (err: any) {
      console.error("Could not fetch doctor_locations:", err);
      showStatus("Could not load your locations. Has add_doctor_locations.sql been run in Supabase yet?", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !currentUser?.staffId) return;
    try {
      const { data, error } = await supabase
        .from("doctor_locations")
        .insert([{ doctor_id: currentUser.staffId, name: newName.trim(), sort_order: locations.length }])
        .select()
        .single();
      if (error) throw error;
      setLocations(prev => [...prev, data]);
      setNewName("");
      showStatus(`Added "${data.name}"`, "success");
    } catch (err: any) {
      showStatus(err.message || "Could not add this location.", "error");
    }
  };

  const startEdit = (loc: DoctorLocation) => {
    setEditingId(loc.id);
    setEditingName(loc.name);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingName("");
  };

  const handleSaveEdit = async (loc: DoctorLocation) => {
    if (!editingName.trim()) return;
    try {
      const { error } = await supabase
        .from("doctor_locations")
        .update({ name: editingName.trim() })
        .eq("id", loc.id);
      if (error) throw error;
      setLocations(prev => prev.map(l => l.id === loc.id ? { ...l, name: editingName.trim() } : l));
      cancelEdit();
      showStatus("Location renamed.", "success");
    } catch (err: any) {
      showStatus(err.message || "Could not rename this location.", "error");
    }
  };

  const handleToggleActive = async (loc: DoctorLocation) => {
    try {
      const { error } = await supabase
        .from("doctor_locations")
        .update({ is_active: !loc.is_active })
        .eq("id", loc.id);
      if (error) throw error;
      setLocations(prev => prev.map(l => l.id === loc.id ? { ...l, is_active: !l.is_active } : l));
    } catch (err: any) {
      showStatus(err.message || "Could not update this location.", "error");
    }
  };

  const handleDelete = async (loc: DoctorLocation) => {
    if (!confirm(`Remove "${loc.name}"? Past appointments/notes tagged with it will keep their history, just without this label.`)) return;
    try {
      const { error } = await supabase.from("doctor_locations").delete().eq("id", loc.id);
      if (error) throw error;
      setLocations(prev => prev.filter(l => l.id !== loc.id));
      showStatus(`Removed "${loc.name}".`, "success");
    } catch (err: any) {
      showStatus(err.message || "Could not remove this location.", "error");
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden border border-slate-200">

        <div className="bg-[var(--theme-accent-dark)] text-white px-6 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="p-1.5 bg-white/10 rounded-lg text-white">
              <MapPin size={20} />
            </span>
            <div>
              <h2 className="text-base font-bold">My Locations</h2>
              <p className="text-[11px] text-[var(--theme-accent-bg)] font-medium">Places you see patients -- clinics, home visits, etc.</p>
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
              <span className="text-xs font-semibold">Loading your locations...</span>
            </div>
          ) : locations.length === 0 ? (
            <div className="h-32 flex flex-col items-center justify-center text-center p-4 bg-slate-50 border border-slate-200 rounded-xl">
              <MapPin className="h-7 w-7 text-slate-300 mb-1.5" />
              <p className="text-xs font-bold text-slate-500">No locations yet</p>
              <p className="text-[10px] text-slate-400 max-w-xs mt-1">Add the places you see patients below -- e.g. "Main Clinic", "Home Visit".</p>
            </div>
          ) : (
            locations.map(loc => (
              <div key={loc.id} className={`flex items-center gap-2 p-2.5 rounded-lg border ${loc.is_active ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50"}`}>
                {editingId === loc.id ? (
                  <>
                    <input
                      autoFocus
                      value={editingName}
                      onChange={e => setEditingName(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") handleSaveEdit(loc); if (e.key === "Escape") cancelEdit(); }}
                      className="flex-1 text-xs border border-slate-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)]"
                    />
                    <button onClick={() => handleSaveEdit(loc)} className="text-emerald-600 hover:bg-emerald-50 p-1.5 rounded-md cursor-pointer">
                      <Save size={14} />
                    </button>
                    <button onClick={cancelEdit} className="text-slate-400 hover:bg-slate-100 p-1.5 rounded-md cursor-pointer">
                      <X size={14} />
                    </button>
                  </>
                ) : (
                  <>
                    <span className={`flex-1 text-xs font-semibold ${loc.is_active ? "text-slate-800" : "text-slate-400 line-through"}`}>
                      {loc.name}
                    </span>
                    <button
                      onClick={() => handleToggleActive(loc)}
                      title={loc.is_active ? "Hide from pickers" : "Show in pickers"}
                      className="text-slate-400 hover:bg-slate-100 p-1.5 rounded-md cursor-pointer"
                    >
                      {loc.is_active ? <Eye size={14} /> : <EyeOff size={14} />}
                    </button>
                    <button onClick={() => startEdit(loc)} className="text-slate-400 hover:bg-slate-100 p-1.5 rounded-md cursor-pointer">
                      <Edit2 size={14} />
                    </button>
                    <button onClick={() => handleDelete(loc)} className="text-rose-400 hover:bg-rose-50 p-1.5 rounded-md cursor-pointer">
                      <Trash2 size={14} />
                    </button>
                  </>
                )}
              </div>
            ))
          )}
        </div>

        <form onSubmit={handleAdd} className="p-4 border-t border-slate-200 flex items-center gap-2 shrink-0 bg-slate-50">
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="e.g. Home Visit"
            className="flex-1 text-xs border border-slate-300 rounded-md px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)] bg-white"
          />
          <button
            type="submit"
            disabled={!newName.trim()}
            className="flex items-center gap-1 text-xs font-bold text-white bg-[var(--theme-accent)] disabled:opacity-40 px-3 py-2 rounded-md cursor-pointer"
          >
            <Plus size={14} /> Add
          </button>
        </form>
      </div>
    </div>
  );
}
