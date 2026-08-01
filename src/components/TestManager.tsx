import React, { useState, useEffect } from "react";
import { 
  Plus, Edit2, Trash2, Save, X, Search, Check, AlertCircle, Sparkles, Database, Copy, UserCheck, FlaskConical, Clipboard, RefreshCw, BarChart2
} from "lucide-react";
import { supabase } from "../supabaseClient";

export interface ClinicalTest {
  id: string | number;
  name: string;
  code: string;
  category: string;
  normal_range: string;
  unit: string;
  sample_type: string;
  description: string;
  created_by?: string;
  isStatic?: boolean;
  htmlTemplate?: string;
}

export const staticTests: ClinicalTest[] = [
  {
    id: "system-walking-speed",
    name: "Walking Speed Test",
    code: "G01-WALK",
    category: "Physical Performance",
    normal_range: "> 1.0",
    unit: "m/s",
    sample_type: "Physical Assessment",
    description: "Evaluates functional mobility. Measures walking speed normally and with cognitive loading (counting backward from 100 by 7s).",
    isStatic: true,
    htmlTemplate: `
<div style="border-left: 3px solid var(--theme-accent); padding: 12px 16px; margin: 10px 0; background: #f4f6f9; border: 1px solid #dee4eb; border-radius: 6px; border-left: 4px solid var(--theme-accent); font-family: sans-serif;">
  <strong style="font-size: 13px; color: #2b3949; display: block; margin-bottom: 4px;">🚶 WALKING SPEED TEST ASSESSMENT</strong>
  <span style="font-size: 10px; color: #5d6b7c; font-family: monospace; display: block; margin-bottom: 8px;">Category: Physical Performance | Functional Mobility</span>
  <div style="font-size: 11.5px; color: #3c4b5c; line-height: 1.6;">
    <div style="margin-bottom: 6px;">
      <strong>a; Determine average walking speed:</strong> ________________ m/s (Normal: &gt; 1.0 m/s)
    </div>
    <div style="margin-bottom: 6px;">
      <strong>b; Determine average walking speed while counting backwards from 100 by 7s:</strong> ________________ m/s (Cognitive Loading dual-task)
    </div>
  </div>
</div>
`
  },
  {
    id: "system-get-up-and-go",
    name: "Get-Up-And-Go Test",
    code: "G02-GUG",
    category: "Fall Risk Assessment",
    normal_range: "< 10",
    unit: "seconds",
    sample_type: "Physical Assessment",
    description: "Measures transition time and fall risk, with an additional dual-task option (holding a full glass of water).",
    isStatic: true,
    htmlTemplate: `
<div style="border-left: 3px solid var(--theme-accent); padding: 12px 16px; margin: 10px 0; background: #f4f6f9; border: 1px solid #dee4eb; border-radius: 6px; border-left: 4px solid var(--theme-accent); font-family: sans-serif;">
  <strong style="font-size: 13px; color: #2b3949; display: block; margin-bottom: 4px;">⏱️ GET-UP-AND-GO (TUG) TEST</strong>
  <span style="font-size: 10px; color: #5d6b7c; font-family: monospace; display: block; margin-bottom: 8px;">Category: Physical Performance | Fall Risk Screen</span>
  <div style="font-size: 11.5px; color: #3c4b5c; line-height: 1.6;">
    <div style="margin-bottom: 6px;">
      <strong>a; Determine the time required to perform the Get-Up-And-Go test:</strong> ________________ seconds (Normal: &lt; 10 seconds)
    </div>
    <div style="margin-bottom: 6px;">
      <strong>b; Determine the time required to perform the Get-Up-And-Go test while holding a full glass of water:</strong> ________________ seconds (Manual dual-task)
    </div>
  </div>
</div>
`
  },
  {
    id: "system-one-leg-stand",
    name: "One-Leg Stand Test",
    code: "G03-OLS",
    category: "Balance Assessment",
    normal_range: "> 10",
    unit: "seconds",
    sample_type: "Physical Assessment",
    description: "Measures static balance and postural stability with eyes open and eyes closed.",
    isStatic: true,
    htmlTemplate: `
<div style="border-left: 3px solid var(--theme-accent); padding: 12px 16px; margin: 10px 0; background: #f4f6f9; border: 1px solid #dee4eb; border-radius: 6px; border-left: 4px solid var(--theme-accent); font-family: sans-serif;">
  <strong style="font-size: 13px; color: #2b3949; display: block; margin-bottom: 4px;">🧍 ONE-LEG STAND TEST</strong>
  <span style="font-size: 10px; color: #5d6b7c; font-family: monospace; display: block; margin-bottom: 8px;">Category: Physical Performance | Static Balance Screening</span>
  <div style="font-size: 11.5px; color: #3c4b5c; line-height: 1.6;">
    <div style="margin-bottom: 6px;">
      <strong>d; Determine how long a patient can stand on one leg without falling:</strong><br>
      Time: ________________ seconds
    </div>
    <div style="margin-bottom: 6px;">
      <strong>e; Determine how long a patient can stand on one leg with eyes closed without falling:</strong><br>
      Time: ________________ seconds
    </div>
  </div>
</div>
`
  },
  {
    id: "system-5-chair-stands",
    name: "The 5 Chair-Stands Test",
    code: "G04-5CS",
    category: "Strength & Power",
    normal_range: "< 12",
    unit: "seconds",
    sample_type: "Physical Assessment",
    description: "Assesses functional lower limb strength and balance. Patient sits in a chair with arms crossed and rises 5 times as fast as possible.",
    isStatic: true,
    htmlTemplate: `
<div style="border-left: 3px solid var(--theme-accent); padding: 12px 16px; margin: 10px 0; background: #f4f6f9; border: 1px solid #dee4eb; border-radius: 6px; border-left: 4px solid var(--theme-accent); font-family: sans-serif;">
  <strong style="font-size: 13px; color: #2b3949; display: block; margin-bottom: 4px;">🪑 THE 5 CHAIR - STANDS TEST</strong>
  <span style="font-size: 10px; color: #5d6b7c; font-family: monospace; display: block; margin-bottom: 8px;">Category: Physical Performance | Lower Extremity Strength</span>
  <div style="font-size: 11.5px; color: #3c4b5c; line-height: 1.6;">
    <div style="margin-bottom: 6px;">
      Patient sits in the chair with arms crossed across chest, and has to sit and stand 5 times sequentially:
    </div>
    <div style="margin-top: 4px; font-weight: bold;">
      f; Amount of time completed: ________ seconds / 5 stands
    </div>
  </div>
</div>
`
  },
  {
    id: "system-gds-short",
    name: "Geriatric Depression Scale (GDS-15)",
    code: "G05-GDS",
    category: "Mental Health",
    normal_range: "0 - 4",
    unit: "points",
    sample_type: "Cognitive/Depression Screening",
    description: "15-item short-form screening scale for depression in older adults. Starred answers count for 1 point each.",
    isStatic: true,
    htmlTemplate: `
<div style="border-left: 3px solid var(--theme-accent); padding: 14px 18px; margin: 12px 0; background: #f4f6f9; border: 1px solid #dee4eb; border-radius: 6px; border-left: 4px solid var(--theme-accent); font-family: sans-serif; line-height: 1.5;">
  <strong style="font-size: 13px; color: #2b3949; display: block; margin-bottom: 4px;">📋 GERIATRIC DEPRESSION SCALE (GDS) - SHORT FORM</strong>
  <span style="font-size: 10px; color: #5d6b7c; font-family: monospace; display: block; margin-bottom: 10px;">Category: Mental Health | Geriatric Depression Screening</span>
  
  <table style="width: 100%; border-collapse: collapse; font-size: 11px; text-align: left; margin-bottom: 10px;">
    <thead>
      <tr style="border-bottom: 2px solid #c9d2dc; color: #4a5a6d;">
        <th style="padding: 4px 0;">Question</th>
        <th style="padding: 4px 0; width: 100px;">Response Options</th>
      </tr>
    </thead>
    <tbody>
      <tr style="border-bottom: 1px solid #edf1f5;">
        <td style="padding: 5px 0;">1. Are you basically satisfied with your life?</td>
        <td style="padding: 5px 0;">[  ] Yes | [  ] No*</td>
      </tr>
      <tr style="border-bottom: 1px solid #edf1f5;">
        <td style="padding: 5px 0;">2. Have you dropped many of your activities and interests?</td>
        <td style="padding: 5px 0;">[  ] Yes* | [  ] No</td>
      </tr>
      <tr style="border-bottom: 1px solid #edf1f5;">
        <td style="padding: 5px 0;">3. Do you feel that your life is empty?</td>
        <td style="padding: 5px 0;">[  ] Yes* | [  ] No</td>
      </tr>
      <tr style="border-bottom: 1px solid #edf1f5;">
        <td style="padding: 5px 0;">4. Do you often get bored?</td>
        <td style="padding: 5px 0;">[  ] Yes* | [  ] No</td>
      </tr>
      <tr style="border-bottom: 1px solid #edf1f5;">
        <td style="padding: 5px 0;">5. Are you in good spirits most of the time?</td>
        <td style="padding: 5px 0;">[  ] Yes | [  ] No*</td>
      </tr>
      <tr style="border-bottom: 1px solid #edf1f5;">
        <td style="padding: 5px 0;">6. Are you afraid that something bad is going to happen to you?</td>
        <td style="padding: 5px 0;">[  ] Yes* | [  ] No</td>
      </tr>
      <tr style="border-bottom: 1px solid #edf1f5;">
        <td style="padding: 5px 0;">7. Do you feel happy most of the time?</td>
        <td style="padding: 5px 0;">[  ] Yes | [  ] No*</td>
      </tr>
      <tr style="border-bottom: 1px solid #edf1f5;">
        <td style="padding: 5px 0;">8. Do you often feel helpless?</td>
        <td style="padding: 5px 0;">[  ] Yes* | [  ] No</td>
      </tr>
      <tr style="border-bottom: 1px solid #edf1f5;">
        <td style="padding: 5px 0;">9. Do you prefer to stay at home, rather than going out and doing new things?</td>
        <td style="padding: 5px 0;">[  ] Yes* | [  ] No</td>
      </tr>
      <tr style="border-bottom: 1px solid #edf1f5;">
        <td style="padding: 5px 0;">10. Do you feel you have more problems with memory than most people?</td>
        <td style="padding: 5px 0;">[  ] Yes* | [  ] No</td>
      </tr>
      <tr style="border-bottom: 1px solid #edf1f5;">
        <td style="padding: 5px 0;">11. Do you think it is wonderful to be alive now?</td>
        <td style="padding: 5px 0;">[  ] Yes | [  ] No*</td>
      </tr>
      <tr style="border-bottom: 1px solid #edf1f5;">
        <td style="padding: 5px 0;">12. Do you feel pretty worthless the way you are now?</td>
        <td style="padding: 5px 0;">[  ] Yes* | [  ] No</td>
      </tr>
      <tr style="border-bottom: 1px solid #edf1f5;">
        <td style="padding: 5px 0;">13. Do you feel full of energy?</td>
        <td style="padding: 5px 0;">[  ] Yes | [  ] No*</td>
      </tr>
      <tr style="border-bottom: 1px solid #edf1f5;">
        <td style="padding: 5px 0;">14. Do you feel that your situation is hopeless?</td>
        <td style="padding: 5px 0;">[  ] Yes* | [  ] No</td>
      </tr>
      <tr style="border-bottom: 1px solid #edf1f5;">
        <td style="padding: 5px 0;">15. Do you think that most people are better off than you are?</td>
        <td style="padding: 5px 0;">[  ] Yes* | [  ] No</td>
      </tr>
    </tbody>
  </table>

  <div style="font-size: 10px; color: #5d6b7c; border-top: 1px solid #c9d2dc; padding-top: 6px; margin-top: 6px;">
    <strong>Scoring Guide:</strong> Score 1 point for each answer that has a star (*) next to it.<br>
    <strong>Interpretation:</strong> 0-4: Normal; 5-8: Mild; 9-11: Moderate; 12-15: Severe Depression indicators.<br>
    <strong style="color: #2b3949; font-size: 11px;">Total GDS-15 Score: _________ / 15 points</strong>
  </div>
</div>
`
  }
];

interface TestManagerProps {
  isOpen: boolean;
  onClose: () => void;
  onTestsUpdated?: () => void;
  currentUser?: { username: string; name: string; role: string } | null;
}

export default function TestManager({ isOpen, onClose, onTestsUpdated, currentUser }: TestManagerProps) {
  const [customTests, setCustomTests] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [filterByUser, setFilterByUser] = useState(false);
  const [sqlErrorState, setSqlErrorState] = useState(false);
  
  // Form states
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | number | null>(null);
  const [formName, setFormName] = useState("");
  const [formCode, setFormCode] = useState("");
  const [formCategory, setFormCategory] = useState("Physical Performance");
  const [formNormalRange, setFormNormalRange] = useState("");
  const [formUnit, setFormUnit] = useState("");
  const [formSampleType, setFormSampleType] = useState("Physical Assessment");
  const [formDescription, setFormDescription] = useState("");
  
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: "success" | "error" | "info" } | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetchTests();
    }
  }, [isOpen]);

  const fetchTests = async () => {
    setIsLoading(true);
    setSqlErrorState(false);
    try {
      const { data, error } = await supabase
        .from("clinical_tests")
        .select("*")
        .order("name");
      
      if (error) throw error;
      setCustomTests(data || []);
    } catch (err: any) {
      console.error("Error fetching clinical tests:", err);
      setSqlErrorState(true);
      // fallback to local storage
      const saved = localStorage.getItem("aura_custom_tests");
      if (saved) {
        try {
          setCustomTests(JSON.parse(saved));
        } catch {
          setCustomTests([]);
        }
      }
    } finally {
      setIsLoading(false);
    }
  };

  const showStatus = (text: string, type: "success" | "error" | "info") => {
    setStatusMessage({ text, type });
    setTimeout(() => {
      setStatusMessage(null);
    }, 5000);
  };

  const resetForm = () => {
    setIsEditing(false);
    setEditingId(null);
    setFormName("");
    setFormCode("");
    setFormCategory("Physical Performance");
    setFormNormalRange("");
    setFormUnit("");
    setFormSampleType("Physical Assessment");
    setFormDescription("");
  };

  const handleEditClick = (test: any) => {
    setIsEditing(true);
    setEditingId(test.id);
    setFormName(test.name);
    setFormCode(test.code || "");
    setFormCategory(test.category || "Biochemistry");
    setFormNormalRange(test.normal_range || "");
    setFormUnit(test.unit || "");
    setFormSampleType(test.sample_type || "Serum");
    setFormDescription(test.description || "");
  };

  const handleSaveTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      showStatus("Please complete the Clinical Test Name.", "error");
      return;
    }

    setIsLoading(true);
    const testId = editingId || `custom-test-${Date.now()}`;

    const payload = {
      name: formName.trim(),
      code: formCode.trim() || null,
      category: formCategory.trim(),
      normal_range: formNormalRange.trim() || null,
      unit: formUnit.trim() || null,
      sample_type: formSampleType.trim() || null,
      description: formDescription.trim() || null,
      created_by: currentUser?.username || "anonymous"
    };

    try {
      if (editingId && typeof editingId === "number") {
        // DB ID is number (real database)
        const { error } = await supabase
          .from("clinical_tests")
          .update(payload)
          .eq("id", editingId);
        
        if (error) throw error;
        showStatus(`Test "${payload.name}" updated in cloud successfully!`, "success");
      } else if (editingId && typeof editingId === "string" && !sqlErrorState) {
        // String ID (or mock client)
        const { error } = await supabase
          .from("clinical_tests")
          .update(payload)
          .eq("id", editingId);
        
        if (error) throw error;
        showStatus(`Test "${payload.name}" updated in cloud successfully!`, "success");
      } else {
        // Insert
        if (!sqlErrorState) {
          const { error } = await supabase
            .from("clinical_tests")
            .insert([payload]);
          
          if (error) throw error;
          showStatus(`Test "${payload.name}" created in cloud successfully!`, "success");
        } else {
          // If SQL missing, save to local storage
          throw new Error("Supabase table missing");
        }
      }

      window.dispatchEvent(new CustomEvent("clinical-tests-updated"));
      if (onTestsUpdated) onTestsUpdated();
      resetForm();
      fetchTests();
    } catch (err: any) {
      console.warn("Saving to cloud database failed. Falling back to LocalStorage simulation.", err.message);
      
      // Fallback local storage
      const saved = localStorage.getItem("aura_custom_tests");
      let currentLocal: any[] = [];
      if (saved) {
        try { currentLocal = JSON.parse(saved); } catch {}
      }

      if (editingId) {
        currentLocal = currentLocal.map(t => t.id === editingId ? { ...t, ...payload } : t);
        showStatus(`Test "${payload.name}" updated (saved locally)!`, "success");
      } else {
        const newLocalTest = { id: `local-test-${Date.now()}`, ...payload };
        currentLocal.push(newLocalTest);
        showStatus(`Test "${payload.name}" added (saved locally)!`, "success");
      }

      localStorage.setItem("aura_custom_tests", JSON.stringify(currentLocal));
      setCustomTests(currentLocal);

      window.dispatchEvent(new CustomEvent("clinical-tests-updated"));
      if (onTestsUpdated) onTestsUpdated();
      resetForm();
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteTest = async (id: string | number, name: string) => {
    if (!window.confirm(`Are you sure you want to permanently delete "${name}"?`)) {
      return;
    }

    setIsLoading(true);
    try {
      if (typeof id === "number" || (!sqlErrorState && typeof id === "string" && !id.startsWith("local-test"))) {
        const { error } = await supabase
          .from("clinical_tests")
          .delete()
          .eq("id", id);
        
        if (error) throw error;
        showStatus(`Deleted test "${name}" from cloud`, "success");
      } else {
        throw new Error("Local test or database offline");
      }
      
      window.dispatchEvent(new CustomEvent("clinical-tests-updated"));
      if (onTestsUpdated) onTestsUpdated();
      if (editingId === id) resetForm();
      fetchTests();
    } catch (err: any) {
      console.warn("Could not delete from cloud. Deleting from LocalStorage...", err.message);
      const saved = localStorage.getItem("aura_custom_tests");
      if (saved) {
        try {
          let currentLocal = JSON.parse(saved);
          currentLocal = currentLocal.filter((t: any) => t.id !== id);
          localStorage.setItem("aura_custom_tests", JSON.stringify(currentLocal));
          setCustomTests(currentLocal);
          showStatus(`Deleted test "${name}" (local cache)`, "success");
        } catch {}
      }
      window.dispatchEvent(new CustomEvent("clinical-tests-updated"));
      if (onTestsUpdated) onTestsUpdated();
      if (editingId === id) resetForm();
    } finally {
      setIsLoading(false);
    }
  };

  const processedCustomTests = customTests.map(t => ({
    ...t,
    isStatic: false,
  }));

  const combinedTests = [
    ...staticTests.map(t => ({ ...t, isStatic: true, created_by: "system" })),
    ...processedCustomTests
  ];

  const filteredTests = combinedTests.filter(t => {
    const matchesSearch = 
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
      (t.code && t.code.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (t.description && t.description.toLowerCase().includes(searchQuery.toLowerCase())) ||
      t.category.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesCategory = selectedCategory === "All" || 
      t.category === selectedCategory || 
      (selectedCategory === "Standard" && t.isStatic) ||
      (selectedCategory === "Custom" && !t.isStatic);

    const matchesUserFilter = !filterByUser || t.created_by === currentUser?.username;

    return matchesSearch && matchesCategory && matchesUserFilter;
  });

  const categories = ["All", "Standard", "Custom", ...Array.from(new Set(combinedTests.map(t => t.category)))];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="bg-[var(--theme-accent-dark)] text-white px-6 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="p-1.5 bg-white/10 rounded-lg text-white">
              <FlaskConical size={20} />
            </span>
            <div>
              <h2 className="text-base font-bold text-white">Clinical Assessment & Functional Test Manager</h2>
              <p className="text-[11px] text-teal-100 font-medium">Orchestrate physical mobility scales, cognitive screenings, and geriatric depression metrics</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 hover:bg-white/15 rounded-lg text-white transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Workspace body */}
        <div className="flex-1 flex overflow-hidden min-h-0">
          
          {/* Left panel: Catalog explorer */}
          <div className="w-7/12 border-r border-slate-100 flex flex-col h-full bg-slate-50/50">
            
            {/* Search & filters bar */}
            <div className="p-4 border-b border-slate-100 space-y-3 shrink-0 bg-white">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={13} />
                <input
                  type="text"
                  placeholder="Search assessment tests, criteria, standard scores..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)] transition-all font-medium"
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 no-scrollbar max-w-[70%]">
                  {categories.map(cat => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setSelectedCategory(cat)}
                      className={`px-2.5 py-1 rounded-full text-[10px] font-bold shrink-0 transition-all cursor-pointer ${
                        selectedCategory === cat
                          ? "bg-[var(--theme-accent)] text-white"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                {currentUser && (
                  <label className="flex items-center cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={filterByUser}
                      onChange={(e) => setFilterByUser(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-7 h-4 bg-slate-200 rounded-full peer peer-focus:ring-1 peer-focus:ring-[var(--theme-accent)] peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-[var(--theme-accent)]"></div>
                    <span className="ml-2 text-[10px] font-bold text-slate-600 flex items-center gap-1">
                      <UserCheck size={11} className="text-[var(--theme-accent)]" /> Custom tests only
                    </span>
                  </label>
                )}
              </div>
            </div>

            {/* Test lists area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
              {statusMessage && (
                <div className={`p-3 rounded-lg flex items-start gap-2.5 text-xs font-medium animate-in fade-in duration-150 ${
                  statusMessage.type === "success" 
                    ? "bg-emerald-50 border border-emerald-100 text-emerald-800" 
                    : statusMessage.type === "error"
                    ? "bg-rose-50 border border-rose-100 text-rose-800"
                    : "bg-amber-50 border border-amber-100 text-amber-800"
                }`}>
                  <AlertCircle size={15} className="shrink-0 mt-0.5" />
                  <span className="leading-relaxed">{statusMessage.text}</span>
                </div>
              )}

              {isLoading && customTests.length === 0 ? (
                <div className="h-40 flex flex-col items-center justify-center text-slate-400 gap-1.5 animate-pulse">
                  <RefreshCw className="h-5 w-5 animate-spin text-[var(--theme-accent)]" />
                  <span className="text-xs font-semibold">Syncing clinical test database...</span>
                </div>
              ) : filteredTests.length === 0 ? (
                <div className="h-40 border-2 border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center text-slate-400 gap-1.5">
                  <FlaskConical size={24} className="text-slate-300" />
                  <p className="text-xs font-bold text-slate-500">No matching clinical tests found</p>
                  <p className="text-[10px] text-slate-400">Add a new parameters form on the right dashboard.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2.5">
                  {filteredTests.map((test) => (
                    <div
                       key={test.id}
                      className={`p-3.5 bg-white border rounded-xl hover:shadow-sm transition-all flex flex-col justify-between relative ${
                        editingId === test.id 
                          ? "border-[var(--theme-accent)] bg-[var(--theme-accent-bg)]/20 ring-1 ring-[var(--theme-accent)]" 
                          : "border-slate-200"
                      }`}
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2.5 mb-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-slate-800 leading-tight">{test.name}</span>
                            {test.isStatic ? (
                              <span className="text-[8px] font-black text-slate-400 border border-slate-200 bg-slate-50 px-1.5 py-0.2 rounded-full uppercase tracking-wider">System</span>
                            ) : (
                              <span className="text-[8px] font-black text-indigo-500 border border-indigo-100 bg-indigo-50 px-1.5 py-0.2 rounded-full uppercase tracking-wider">Custom</span>
                            )}
                          </div>
                          
                          <div className="flex items-center gap-1">
                            {!test.isStatic && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleEditClick(test)}
                                  className="p-1 text-slate-400 hover:text-[var(--theme-accent)] hover:bg-slate-50 rounded cursor-pointer transition-colors"
                                  title="Edit parameters"
                                >
                                  <Edit2 size={11} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteTest(test.id, test.name)}
                                  className="p-1 text-slate-400 hover:text-rose-600 hover:bg-slate-50 rounded cursor-pointer transition-colors"
                                  title="Delete test"
                                >
                                  <Trash2 size={11} />
                                </button>
                              </>
                            )}
                          </div>
                        </div>

                        {test.description && (
                          <p className="text-[10px] text-slate-500 line-clamp-2 leading-relaxed mb-2.5 font-medium">
                            {test.description}
                          </p>
                        )}

                        <div className="flex flex-wrap items-center gap-1.5 text-[9px] font-bold">
                          <span className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                            {test.category}
                          </span>
                          {test.code && (
                            <span className="bg-blue-50 text-blue-700 border border-blue-100 px-1.5 py-0.5 rounded font-mono">
                              Code: {test.code}
                            </span>
                          )}
                          <span className="bg-emerald-50 text-emerald-700 border border-emerald-100 px-1.5 py-0.5 rounded">
                            Normal Range: {test.normal_range || "N/A"} {test.unit || ""}
                          </span>
                          {test.sample_type && (
                            <span className="bg-purple-50 text-purple-700 border border-purple-100 px-1.5 py-0.5 rounded">
                              Type: {test.sample_type}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right panel: Editor / SQL schema manual */}
          <div className="w-5/12 flex flex-col h-full overflow-y-auto p-5 space-y-4">
            
            {/* Form */}
            <div className="border border-slate-100 bg-white rounded-xl shadow-xs p-4">
              <form onSubmit={handleSaveTest} className="space-y-3.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                    <Sparkles size={14} className="text-[var(--theme-accent)] animate-pulse" />
                    <span>{isEditing ? "Modify Assessment Test" : "Add Assessment Test / Scale"}</span>
                  </h3>
                  {isEditing && (
                    <button
                      type="button"
                      onClick={resetForm}
                      className="text-[9px] font-black text-rose-500 hover:underline flex items-center gap-0.5 cursor-pointer"
                    >
                      <X size={10} /> Cancel Modify
                    </button>
                  )}
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Test/Assessment Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Short Physical Performance Battery (SPPB)"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)] transition-all font-semibold text-slate-800"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Custom / CPT Code</label>
                    <input
                      type="text"
                      placeholder="e.g. G06-SPPB"
                      value={formCode}
                      onChange={(e) => setFormCode(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)] transition-all font-mono font-bold text-slate-700"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Category</label>
                    <input
                      type="text"
                      placeholder="e.g. Physical Performance, Fall Risk"
                      value={formCategory}
                      onChange={(e) => setFormCategory(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)] transition-all font-semibold text-slate-700"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="col-span-1.5">
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Normal Score/Boundary</label>
                    <input
                      type="text"
                      placeholder="e.g. > 10"
                      value={formNormalRange}
                      onChange={(e) => setFormNormalRange(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)] transition-all text-slate-700 font-semibold"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Unit</label>
                    <input
                      type="text"
                      placeholder="e.g. points, seconds"
                      value={formUnit}
                      onChange={(e) => setFormUnit(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)] transition-all text-slate-700 font-semibold"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Assessment Type</label>
                    <input
                      type="text"
                      placeholder="e.g. Physical Assessment"
                      value={formSampleType}
                      onChange={(e) => setFormSampleType(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)] transition-all text-slate-700 font-semibold"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Assessment Protocol & Description</label>
                  <textarea
                    rows={3}
                    placeholder="Provide diagnostic criteria, scoring system guidelines, or instructions for patients..."
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)] transition-all text-slate-600 font-medium leading-relaxed"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-dark)] text-white font-extrabold text-xs py-2 rounded-lg flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-sm"
                >
                  <Save size={14} />
                  <span>{isLoading ? "Saving Parameters..." : isEditing ? "Save Assessment Updates" : "Create Clinical Assessment"}</span>
                </button>
              </form>
            </div>

          </div>

        </div>

      </div>
    </div>
  );
}
