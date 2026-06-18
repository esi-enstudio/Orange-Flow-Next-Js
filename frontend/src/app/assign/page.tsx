"use client";

import { useEffect, useState } from "react";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Users, Search, Check, X, Loader2, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "react-hot-toast";
import { useLanguage } from "@/i18n/useLanguage";

export default function AssignPage() {
  const [unassigned, setUnassigned] = useState<any[]>([]);
  const [supervisors, setSupervisors] = useState<any[]>([]);
  const [selectedRsos, setSelectedRsos] = useState<Set<number>>(new Set());
  const [selectedSup, setSelectedSup] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState("");
  const { loading: authLoading, hasPermission } = useAuth();
  const { t } = useLanguage();

  const fetchData = async () => {
    setLoading(true);
    try {
      const [unassignedRes, supRes] = await Promise.all([
        apiClient.get("employees/unassigned-rsos"),
        apiClient.get("employees/supervisors-list"),
      ]);
      setUnassigned(unassignedRes.data?.data || []);
      setSupervisors(supRes.data?.data || []);
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    if (!authLoading) fetchData();
  }, [authLoading]);

  const toggleRso = (id: number) => {
    setSelectedRsos(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleAssign = async () => {
    if (selectedRsos.size === 0 || !selectedSup) return;
    setSubmitting(true);
    try {
      const res = await apiClient.post("employees/assign-supervisor/batch", {
        rso_user_ids: Array.from(selectedRsos),
        supervisor_user_id: selectedSup,
      });
      toast.success(res.data?.message || "Assigned successfully!");
      setSelectedRsos(new Set());
      setSelectedSup(null);
      fetchData();
    } catch {
      toast.error("Failed to assign");
    }
    setSubmitting(false);
  };

  const filteredUnassigned = unassigned.filter((r) =>
    (r.name || "").toLowerCase().includes(search.toLowerCase()) ||
    (r.dms_code || "").toLowerCase().includes(search.toLowerCase())
  );

  if (!authLoading && !hasPermission("employees.assign")) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">{t('common.access_denied')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">Assign RSO to Supervisor</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Select multiple RSOs and assign them to a supervisor</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary-500" /></div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Unassigned RSOs */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm">
            <div className="p-4 border-b border-gray-50 dark:border-slate-800">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-sm text-gray-700 dark:text-gray-300">Unassigned RSOs</h2>
                {selectedRsos.size > 0 && (
                  <span className="text-xs font-semibold text-primary-500">{selectedRsos.size} selected</span>
                )}
              </div>
              <div className="relative mt-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search RSO..." className="w-full pl-9 pr-3 py-2 bg-gray-50 dark:bg-slate-800 border-none rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary-500" />
              </div>
            </div>
            <div className="divide-y divide-gray-50 dark:divide-slate-800 max-h-96 overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gray-300 dark:[&::-webkit-scrollbar-thumb]:bg-slate-600 [&::-webkit-scrollbar-thumb]:rounded-full">
              {filteredUnassigned.length === 0 ? (
                <div className="p-8 text-center text-sm text-gray-400">No unassigned RSOs</div>
              ) : filteredUnassigned.map((rso) => {
                const isSelected = selectedRsos.has(rso.user_id);
                return (
                  <button
                    key={rso.user_id}
                    onClick={() => toggleRso(rso.user_id)}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors",
                      isSelected && "bg-primary-50 dark:bg-primary-500/10"
                    )}
                  >
                    <div className={cn(
                      "w-5 h-5 rounded border-2 flex items-center justify-center shrink-0",
                      isSelected ? "border-primary-500 bg-primary-500" : "border-gray-300 dark:border-slate-600"
                    )}>
                      {isSelected && <Check className="w-3 h-3 text-white" />}
                    </div>
                    <div className="w-8 h-8 rounded-full bg-primary-100 dark:bg-primary-500/20 flex items-center justify-center text-primary-600 text-xs font-bold shrink-0">
                      {rso.name?.charAt(0) || "R"}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{rso.name || rso.username}</p>
                      <p className="text-xs text-gray-500 truncate">{rso.dms_code || ""}{rso.itop_number ? ` - ${rso.itop_number}` : ""}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Supervisors */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm">
            <div className="p-4 border-b border-gray-50 dark:border-slate-800">
              <h2 className="font-semibold text-sm text-gray-700 dark:text-gray-300">Select Supervisor</h2>
            </div>
            <div className="divide-y divide-gray-50 dark:divide-slate-800 max-h-96 overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gray-300 dark:[&::-webkit-scrollbar-thumb]:bg-slate-600 [&::-webkit-scrollbar-thumb]:rounded-full">
              {supervisors.length === 0 ? (
                <div className="p-8 text-center text-sm text-gray-400">No supervisors found</div>
              ) : supervisors.map((sup) => (
                <button
                  key={sup.user_id}
                  onClick={() => setSelectedSup(sup.user_id)}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors",
                    selectedSup === sup.user_id && "bg-primary-50 dark:bg-primary-500/10"
                  )}
                >
                  <div className={cn(
                    "w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0",
                    selectedSup === sup.user_id ? "border-primary-500 bg-primary-500" : "border-gray-300 dark:border-slate-600"
                  )}>
                    {selectedSup === sup.user_id && <Check className="w-3 h-3 text-white" />}
                  </div>
                  <div className="w-8 h-8 rounded-full bg-purple-100 dark:bg-purple-500/20 flex items-center justify-center text-purple-600 text-xs font-bold shrink-0">
                    {sup.name?.charAt(0) || "S"}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{sup.name || sup.username}</p>
                    <p className="text-xs text-gray-500 truncate">{sup.dms_code || ""}{sup.itop_number ? ` - ${sup.itop_number}` : ""}</p>
                  </div>
                  <div className="ml-auto text-right shrink-0">
                    <span className="text-xs font-semibold text-gray-400 dark:text-gray-500">{sup.assigned_rso_count ?? 0} RSO</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Action Bar */}
      <div className="flex justify-end">
        <button
          onClick={handleAssign}
          disabled={selectedRsos.size === 0 || !selectedSup || submitting}
          className={cn(
            "px-6 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2 transition-all",
            selectedRsos.size > 0 && selectedSup
              ? "bg-primary-500 text-white hover:bg-primary-600 shadow-md"
              : "bg-gray-100 dark:bg-slate-800 text-gray-400 cursor-not-allowed"
          )}
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
          {submitting ? "Assigning..." : `Assign ${selectedRsos.size} RSO(s) to Supervisor`}
        </button>
      </div>
    </div>
  );
}
