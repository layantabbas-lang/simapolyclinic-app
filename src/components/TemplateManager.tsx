import React, { useState, useEffect } from "react";
import { 
  Plus, Edit2, Trash2, Save, X, Search, FileText, Check, AlertCircle, Sparkles, Folder, HelpCircle, Copy, UserCheck, Database
} from "lucide-react";
import { supabase } from "../supabaseClient";
import { UserSession } from "../types";
import { noteTemplates as staticTemplates, ClinicalTemplate } from "./PatientsDirectory";

interface TemplateManagerProps {
  isOpen: boolean;
  onClose: () => void;
  onTemplatesUpdated?: () => void;
  currentUser?: UserSession | null;
}

export default function TemplateManager({ isOpen, onClose, onTemplatesUpdated, currentUser }: TemplateManagerProps) {
  const [customTemplates, setCustomTemplates] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [filterByUser, setFilterByUser] = useState(false);
  const [sqlErrorState, setSqlErrorState] = useState(false);
  
  // Form states
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formTitle, setFormTitle] = useState("");
  const [formCategory, setFormCategory] = useState("General Practice");
  const [formIcon, setFormIcon] = useState("📋");
  const [formContent, setFormContent] = useState("");
  
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: "success" | "error" | "info" } | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetchTemplates();
    }
  }, [isOpen]);

  const fetchTemplates = async () => {
    setIsLoading(true);
    setSqlErrorState(false);
    try {
      const { data, error } = await supabase
        .from("note_templates")
        .select("*")
        .order("title");
      
      if (error) throw error;
      setCustomTemplates(data || []);
    } catch (err: any) {
      console.error("Error fetching note templates:", err);
      setSqlErrorState(true);
      showStatus("Database columns mismatch or table missing. Check the SQL setup block below!", "error");
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
    setFormTitle("");
    setFormCategory("General Practice");
    setFormIcon("📋");
    setFormContent("");
  };

  const handleEditClick = (template: any) => {
    setIsEditing(true);
    setEditingId(template.id);
    setFormTitle(template.title);
    setFormContent(template.content);
    
    // Parse category and icon if stored as "Custom|Category|Icon"
    if (template.category && template.category.startsWith("Custom|")) {
      const parts = template.category.split("|");
      setFormCategory(parts[1] || "Custom");
      setFormIcon(parts[2] || "📝");
    } else {
      setFormCategory(template.category || "General");
      // Derive icon based on static template categories
      if (template.category === "General Practice") setFormIcon("📋");
      else if (template.category === "Specialist") setFormIcon("🩺");
      else if (template.category === "Lab Review") setFormIcon("📊");
      else if (template.category === "Pediatrics") setFormIcon("🫁");
      else if (template.category === "Cardiology") setFormIcon("❤️");
      else setFormIcon("📝");
    }
  };

  const handleSaveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim() || !formContent.trim()) {
      showStatus("Please complete the Template Title and Template Content.", "error");
      return;
    }

    setIsLoading(true);
    // Encode category as Custom|Category_Name|Icon
    const encodedCategory = `Custom|${formCategory}|${formIcon}`;

    // No client-side id: note_templates.id is a uuid the database mints.
    // The old `custom-temp-<timestamp>` text couldn't be a uuid, which is
    // why visit_notes.template_id could never reference a real template.
    const payload = {
      title: formTitle.trim(),
      category: encodedCategory,
      content: formContent.trim(),
      // created_by is a FK to staff(id) -- staffId, not the auth user id.
      created_by: currentUser?.staffId || null
    };

    try {
      if (editingId) {
        // Update
        const { error } = await supabase
          .from("note_templates")
          .update({
            title: payload.title,
            category: payload.category,
            content: payload.content,
            created_by: payload.created_by
          })
          .eq("id", editingId);
        
        if (error) throw error;
        showStatus(`Template "${payload.title}" updated successfully!`, "success");
      } else {
        // Insert
        const { error } = await supabase
          .from("note_templates")
          .insert([payload]);
        
        if (error) throw error;
        showStatus(`Template "${payload.title}" created successfully!`, "success");
      }

      // Notify other components (like PatientDirectory)
      window.dispatchEvent(new CustomEvent("note-templates-updated"));
      if (onTemplatesUpdated) onTemplatesUpdated();

      resetForm();
      fetchTemplates();
    } catch (err: any) {
      console.error("Error saving template:", err);
      showStatus(`Error saving template: ${err.message}. Ensure you have executed the schema update SQL query below!`, "error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteTemplate = async (id: string, title: string) => {
    if (!window.confirm(`Are you sure you want to permanently delete the custom template "${title}"?`)) {
      return;
    }

    setIsLoading(true);
    try {
      const { error } = await supabase
        .from("note_templates")
        .delete()
        .eq("id", id);
      
      if (error) throw error;
      showStatus(`Deleted template "${title}"`, "success");
      
      // Notify other components
      window.dispatchEvent(new CustomEvent("note-templates-updated"));
      if (onTemplatesUpdated) onTemplatesUpdated();

      if (editingId === id) {
        resetForm();
      }
      fetchTemplates();
    } catch (err: any) {
      console.error("Error deleting template:", err);
      showStatus(`Could not delete template: ${err.message}`, "error");
    } finally {
      setIsLoading(false);
    }
  };

  // Process custom templates to standard view model
  const processedCustomTemplates = customTemplates.map(temp => {
    let description = temp.category;
    let icon = "📝";
    
    if (temp.category && temp.category.startsWith("Custom|")) {
      const parts = temp.category.split("|");
      description = parts[1] || "Custom Template";
      icon = parts[2] || "📝";
    } else {
      if (temp.category === "General Practice") icon = "📋";
      else if (temp.category === "Specialist") icon = "🩺";
      else if (temp.category === "Lab Review") icon = "📊";
      else if (temp.category === "Pediatrics") icon = "🫁";
      else if (temp.category === "Cardiology") icon = "❤️";
    }

    return {
      id: temp.id,
      title: temp.title,
      description: description,
      icon: icon,
      content: temp.content,
      created_by: temp.created_by
    };
  });

  // Filter custom templates by user if requested
  const userFilteredCustoms = processedCustomTemplates.filter(t => {
    if (filterByUser && currentUser) {
      return t.created_by === currentUser.id;
    }
    return true;
  });

  // Combine standard and custom templates for visual listing
  const allTemplatesList = [
    ...staticTemplates.map(t => ({ ...t, isStatic: true, created_by: "system" })),
    ...userFilteredCustoms.map(t => ({ ...t, isStatic: false }))
  ];

  // Filter templates
  const filteredTemplates = allTemplatesList.filter(t => {
    const matchesSearch = 
      t.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
      t.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.content.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesCategory = selectedCategory === "All" || 
      t.description === selectedCategory || 
      (selectedCategory === "Standard" && t.isStatic) ||
      (selectedCategory === "Custom" && !t.isStatic);

    return matchesSearch && matchesCategory;
  });

  // Extract unique categories for filter
  const categories = ["All", "Standard", "Custom", ...Array.from(new Set(allTemplatesList.map(t => t.description)))];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
        
        {/* Header bar */}
        <div className="bg-[var(--theme-accent-dark)] text-white px-6 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="p-1.5 bg-white/10 rounded-lg text-white">
              <FileText size={20} />
            </span>
            <div>
              <h2 className="text-base font-bold">Clinical EHR Template Manager</h2>
              <p className="text-[11px] text-[var(--theme-accent-bg)] font-medium">Create, edit, and orchestrate templates with persistent cloud synchronization</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="text-white hover:bg-white/10 p-1.5 rounded-lg transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Status messages indicator */}
        {statusMessage && (
          <div className={`px-6 py-2.5 flex items-center gap-2 text-xs font-bold transition-all ${
            statusMessage.type === "success" 
              ? "bg-emerald-50 border-b border-emerald-100 text-emerald-800" 
              : statusMessage.type === "error"
              ? "bg-rose-50 border-b border-rose-100 text-rose-800"
              : "bg-amber-50 border-b border-amber-100 text-amber-800"
          }`}>
            {statusMessage.type === "error" ? <AlertCircle size={14} /> : <Check size={14} />}
            <span>{statusMessage.text}</span>
          </div>
        )}

        {/* Content body split layout */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          
          {/* Left panel: list of templates */}
          <div className="w-1/2 border-r border-slate-200 flex flex-col bg-slate-50 min-h-0">
            {/* Search and filters */}
            <div className="p-4 border-b border-slate-200 space-y-2.5 bg-white shrink-0">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search clinic templates..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)] transition-all"
                />
              </div>

              {currentUser && (
                <div className="flex items-center gap-2 pt-1 border-t border-slate-150 mt-1">
                  <label className="relative inline-flex items-center cursor-pointer select-none">
                    <input 
                      type="checkbox" 
                      checked={filterByUser} 
                      onChange={(e) => setFilterByUser(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-7 h-4 bg-slate-200 rounded-full peer peer-focus:ring-1 peer-focus:ring-[var(--theme-accent)] peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-[var(--theme-accent)]"></div>
                    <span className="ml-2 text-[10px] font-bold text-slate-600 flex items-center gap-1">
                      <UserCheck size={11} className="text-[var(--theme-accent)]" /> Show only my custom templates ({currentUser.username})
                    </span>
                  </label>
                </div>
              )}

              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                <span className="text-[10px] text-slate-400 font-bold uppercase shrink-0 mr-1">Filter:</span>
                {categories.map(cat => (
                  <button
                    key={cat}
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
            </div>

            {/* List container */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
              {sqlErrorState && (
                <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-xs flex flex-col gap-2">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-extrabold text-[11px] uppercase tracking-wider text-amber-800">Database Schema Missing Column</p>
                      <p className="text-[10px] text-amber-700 font-semibold mt-0.5">
                        Could not fetch note templates because the <strong>category</strong> or <strong>created_by</strong> column is missing from Supabase's schema cache. Re-run schema.sql in the Supabase SQL Editor, then refresh.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {isLoading && customTemplates.length === 0 ? (
                <div className="h-40 flex flex-col items-center justify-center text-slate-400 gap-1.5">
                  <div className="w-5 h-5 border-2 border-[var(--theme-accent)] border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs font-semibold">Loading clinical templates...</span>
                </div>
              ) : filteredTemplates.length === 0 ? (
                <div className="h-40 flex flex-col items-center justify-center text-center p-6 bg-white border border-slate-200 rounded-xl">
                  <HelpCircle className="h-8 w-8 text-slate-300 mb-2" />
                  <p className="text-xs font-bold text-slate-500">No templates found</p>
                  <p className="text-[10px] text-slate-400 max-w-xs mt-1">Try resetting search filters, toggling creator filter, or build a custom template on the right side.</p>
                </div>
              ) : (
                filteredTemplates.map((template) => (
                  <div 
                    key={template.id}
                    className={`p-3.5 bg-white border rounded-xl hover:shadow-md transition-all flex flex-col justify-between relative ${
                      editingId === template.id 
                        ? "border-[var(--theme-accent)] bg-[var(--theme-accent-bg)]/20 ring-1 ring-[var(--theme-accent)]" 
                        : "border-slate-200"
                    }`}
                  >
                    {/* Top Row: Title, Icon, Badge */}
                    <div className="flex items-start gap-2.5">
                      <span className="text-xl select-none leading-none pt-0.5">{template.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h4 className="text-[12px] font-extrabold text-slate-800 leading-snug truncate max-w-[210px]">{template.title}</h4>
                          <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider ${
                            template.isStatic 
                              ? "bg-slate-100 text-slate-500 border border-slate-200" 
                              : "bg-indigo-50 text-indigo-600 border border-indigo-100"
                          }`}>
                            {template.isStatic ? "Default" : "Custom"}
                          </span>
                          {!template.isStatic && template.created_by && (
                            <span className="bg-emerald-50 text-emerald-800 border border-emerald-100 text-[8px] font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5" title={`Creator: ${template.created_by}`}>
                              👤 {template.created_by === currentUser?.id ? "My User" : "Colleague"}
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-400 font-semibold mt-0.5">{template.description}</p>
                      </div>
                    </div>

                    {/* Content Preview */}
                    <div className="my-2.5 bg-slate-50 p-2 rounded-lg border border-slate-100">
                      <div
                        className="text-[10px] text-slate-500 font-mono leading-relaxed max-h-16 overflow-y-auto select-none whitespace-pre-wrap"
                      >
                        {template.content}
                      </div>
                    </div>

                    {/* Bottom Action Row */}
                    <div className="flex items-center justify-between border-t border-slate-100 pt-2.5 mt-1 shrink-0">
                      <span className="text-[9px] text-slate-400 font-medium">ID: <code className="font-mono bg-slate-50 px-1 py-0.5 rounded">{template.id}</code></span>
                      <div className="flex items-center gap-1.5">
                        {template.isStatic ? (
                          <span className="text-[10px] text-slate-400 font-bold italic bg-slate-50 border border-slate-150 px-2 py-0.5 rounded">
                            Standard Preset
                          </span>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => handleEditClick(template)}
                              className="hover:bg-slate-100 p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:text-slate-800 cursor-pointer transition-colors"
                              title="Edit Template Properties"
                            >
                              <Edit2 size={11} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteTemplate(template.id, template.title)}
                              className="hover:bg-rose-50 p-1.5 rounded-lg border border-rose-150 text-rose-500 hover:text-rose-700 cursor-pointer transition-colors"
                              title="Delete Template"
                            >
                              <Trash2 size={11} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Right panel: creation/editing form */}
          <div className="w-1/2 p-6 overflow-y-auto flex flex-col justify-between bg-white min-h-0">
            <form onSubmit={handleSaveTemplate} className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles size={14} className="text-[var(--theme-accent)]" />
                  <span>{isEditing ? "Modify EHR Template" : "Compose New Template"}</span>
                </h3>
                {isEditing && (
                  <button
                    type="button"
                    onClick={resetForm}
                    className="text-xs text-rose-500 hover:bg-rose-50 border border-rose-200 px-2.5 py-1 rounded-lg font-bold cursor-pointer transition-colors"
                  >
                    Cancel Editing
                  </button>
                )}
              </div>

              {/* Title Input */}
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Template Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Ophthalmology Intake Sheet"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)] transition-all font-medium"
                />
              </div>

              {/* Category Input */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Category Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Pediatrics, Cardiology"
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)] transition-all font-medium"
                  />
                </div>

                {/* Selected Icon Display */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Selected Icon</label>
                  <div className="flex items-center gap-2 border border-slate-200 rounded-lg px-3 py-1.5 bg-slate-50">
                    <span className="text-lg select-none">{formIcon}</span>
                    <span className="text-[10px] text-slate-500 font-bold font-mono">Preset Icon</span>
                  </div>
                </div>
              </div>

              {/* Icon Selector list */}
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Change Icon Emoji</label>
                <div className="flex gap-1.5 flex-wrap">
                  {["📋", "🩺", "🧠", "❤️", "🫁", "📊", "📅", "👶", "🤰", "🧬", "🧪", "🦴", "👁️", "🩹", "📝", "🏥"].map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => setFormIcon(emoji)}
                      className={`w-7 h-7 flex items-center justify-center rounded border transition-all text-sm ${
                        formIcon === emoji
                          ? "border-[var(--theme-accent)] bg-[var(--theme-accent)]/10 font-bold scale-110 shadow-sm"
                          : "border-slate-200 bg-white hover:bg-slate-50"
                      }`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>

              {/* Clinical Template content body */}
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Template HTML/Body Content</label>
                  <span className="text-[9px] text-[var(--theme-accent)] font-bold bg-[var(--theme-accent)]/5 px-2 py-0.5 rounded">Supports Rich HTML</span>
                </div>
                <textarea
                  rows={8}
                  required
                  placeholder="<strong>[SYMPTOMATOLOGY]</strong><br>Write standard complaints...<br><br><strong>[LABS]</strong><br>Review typical criteria..."
                  value={formContent}
                  onChange={(e) => setFormContent(e.target.value)}
                  className="w-full px-3 py-2.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-[var(--theme-accent)] transition-all font-mono leading-relaxed"
                />
                <p className="text-[9px] text-slate-400 mt-1 leading-relaxed">
                  Use standard HTML tags like <code>&lt;strong&gt;</code>, <code>&lt;br&gt;</code>, <code>&lt;u&gt;</code>, or <code>&lt;li&gt;</code> to create clean formatted tables or clinical checklists.
                </p>
              </div>

              {/* Action Buttons */}
              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full bg-[var(--theme-accent)] hover:bg-[var(--theme-accent-dark)] text-white font-extrabold text-xs py-2.5 rounded-lg flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-md"
                >
                  <Save size={14} />
                  <span>{isLoading ? "Saving to Cloud database..." : isEditing ? "Save Template Updates" : "Save and Deploy Custom Template"}</span>
                </button>
              </div>
            </form>
          </div>

        </div>

      </div>
    </div>
  );
}
