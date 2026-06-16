"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import apiClient from "@/lib/api";
import { cn } from "@/lib/utils";
import { Plus, Trash2, Building2, Shield, RefreshCw, Hash, Search, X, AlertTriangle } from "lucide-react";

interface BpCodeRecord {
  id: number;
  bp_employee_id: number;
  retailer_code: string;
  house_id: number;
  bp_name: string;
  bp_dms_code: string;
}

interface EmployeeOption {
  id: number;
  name: string;
  dms_code: string;
  employee_id: string;
}

export default function BpRetailerCodesPage() {
  const { user, hasPermission } = useAuth();

  const [records, setRecords] = useState<BpCodeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* add form */
  const [showForm, setShowForm] = useState(false);
  const [bpEmployees, setBpEmployees] = useState<EmployeeOption[]>([]);
  const [selectedBpId, setSelectedBpId] = useState<number | null>(null);
  const [bpSearch, setBpSearch] = useState("");
  const [retailerCode, setRetailerCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [bpDropdownOpen, setBpDropdownOpen] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<BpCodeRecord | null>(null);

  const isAdmin = hasPermission("bp_retailer_codes.edit");

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get("/bp-retailer-codes");
      setRecords(res.data);
    } catch {
      setError("Failed to load BP retailer codes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  /* load BP employees for dropdown */
  useEffect(() => {
    if (!showForm) return;
    let cancelled = false;
    apiClient.get("/bp-retailer-codes/bp-employees")
      .then((res) => {
        if (cancelled) return;
        const bpList: EmployeeOption[] = (res.data || []).map((emp: any) => ({
          id: emp.id,
          name: emp.name || emp.dms_code || `BP #${emp.id}`,
          dms_code: emp.dms_code || "",
          employee_id: emp.employee_id || "",
        }));
        setBpEmployees(bpList);
      })
      .catch((e) => {
        console.error("Failed to load BP employees", e);
        if (!cancelled) setBpEmployees([]);
      });
    return () => { cancelled = true; };
  }, [showForm, user]);

  const handleAdd = async () => {
    if (!selectedBpId || !retailerCode.trim()) return;
    setSubmitting(true);
    try {
      await apiClient.post("/bp-retailer-codes", {
        bp_employee_id: selectedBpId,
        retailer_code: retailerCode.trim().toUpperCase(),
      });
      setSelectedBpId(null);
      setRetailerCode("");
      setShowForm(false);
      setBpSearch("");
      fetchRecords();
    } catch (err: any) {
      alert(err.response?.data?.detail || "Failed to assign");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await apiClient.delete(`/bp-retailer-codes/${id}`);
      setDeleteTarget(null);
      fetchRecords();
    } catch {
      alert("Failed to remove");
    }
  };

  const filteredBpEmployees = bpEmployees.filter(
    (e) =>
      e.name.toLowerCase().includes(bpSearch.toLowerCase()) ||
      e.dms_code.toLowerCase().includes(bpSearch.toLowerCase()) ||
      e.employee_id.toLowerCase().includes(bpSearch.toLowerCase())
  );

  const selectedBp = bpEmployees.find((e) => e.id === selectedBpId);

  if (!hasPermission("reports.view")) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <Shield className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-gray-400">Access Denied</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6 pb-32">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-gray-100 tracking-tight flex items-center gap-3">
            <Hash className="w-7 h-7 text-emerald-500" />
            BP Retailer Codes
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Assign retailer codes to BP employees. Activations under these codes will count as BP own activation.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              onClick={() => setShowForm(!showForm)}
              className="px-4 py-2 rounded-xl bg-primary-500 text-white text-sm font-medium hover:bg-primary-600 transition-colors flex items-center gap-2"
            >
              {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              {showForm ? "Cancel" : "Add Assignment"}
            </button>
          )}
          <button
            onClick={fetchRecords}
            className="p-2.5 rounded-xl border border-gray-200 dark:border-slate-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
            title="Refresh"
          >
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* Add Form */}
      {showForm && isAdmin && (
        <div className="bg-white dark:bg-slate-800/80 rounded-2xl border border-gray-100 dark:border-slate-700/50 p-5">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">New Assignment</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* BP Employee Selector */}
            <div className="relative">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">BP Employee</label>
              <div
                className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm cursor-pointer flex items-center justify-between"
                onClick={() => setBpDropdownOpen(!bpDropdownOpen)}
              >
                <span className={selectedBp ? "text-gray-900 dark:text-gray-100" : "text-gray-400"}>
                  {selectedBp ? `${selectedBp.name} (${selectedBp.dms_code || selectedBp.employee_id})` : "Select BP..."}
                </span>
                <Search className="w-3.5 h-3.5 text-gray-400" />
              </div>
              {bpDropdownOpen && (
                <div className="absolute z-20 mt-1 w-full bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 rounded-xl shadow-lg max-h-56 overflow-y-auto">
                  <div className="p-2 sticky top-0 bg-white dark:bg-slate-800 border-b border-gray-100 dark:border-slate-700">
                    <input
                      value={bpSearch}
                      onChange={(e) => setBpSearch(e.target.value)}
                      placeholder="Search BP..."
                      className="w-full px-2 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-slate-600 bg-gray-50 dark:bg-slate-700 outline-none"
                      autoFocus
                    />
                  </div>
                  {filteredBpEmployees.length === 0 ? (
                    <p className="p-3 text-xs text-gray-400 text-center">No BPs found</p>
                  ) : (
                    filteredBpEmployees.map((emp) => (
                      <button
                        key={emp.id}
                        onClick={() => {
                          setSelectedBpId(emp.id);
                          setBpDropdownOpen(false);
                          setBpSearch("");
                        }}
                        className={cn(
                          "w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors",
                          selectedBpId === emp.id ? "bg-primary-50 dark:bg-primary-500/10 text-primary-600 dark:text-primary-400" : "text-gray-700 dark:text-gray-300"
                        )}
                      >
                        <span className="font-medium">{emp.name}</span>
                        <span className="text-xs text-gray-400 ml-2">{emp.dms_code || emp.employee_id}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Retailer Code */}
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Retailer Code</label>
              <input
                value={retailerCode}
                onChange={(e) => setRetailerCode(e.target.value.toUpperCase())}
                placeholder="e.g. R026588"
                className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
              />
            </div>

            {/* Submit */}
            <div className="flex items-end">
              <button
                onClick={handleAdd}
                disabled={!selectedBpId || !retailerCode.trim() || submitting}
                className="w-full px-4 py-2 rounded-xl bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" />
                {submitting ? "Assigning..." : "Assign"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Records Table */}
      {loading ? (
        <div className="flex items-center justify-center h-48 text-gray-400 text-sm">Loading...</div>
      ) : error ? (
        <div className="flex items-center justify-center h-48 text-red-400 text-sm">{error}</div>
      ) : records.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-gray-400">
          <Building2 className="w-12 h-12 mb-3 text-gray-300 dark:text-gray-600" />
          <p className="text-sm">No BP retailer codes assigned yet.</p>
          {isAdmin && (
            <button
              onClick={() => setShowForm(true)}
              className="mt-3 text-sm text-primary-500 hover:text-primary-600 font-medium"
            >
              + Add your first assignment
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-800/80 rounded-2xl border border-gray-100 dark:border-slate-700/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-slate-700/50">
                  <th className="text-left px-5 py-3 font-semibold text-gray-600 dark:text-gray-400">BP Name</th>
                  <th className="text-left px-5 py-3 font-semibold text-gray-600 dark:text-gray-400">DMS Code</th>
                  <th className="text-left px-5 py-3 font-semibold text-gray-600 dark:text-gray-400">Retailer Code</th>
                  {isAdmin && <th className="text-right px-5 py-3 font-semibold text-gray-600 dark:text-gray-400">Action</th>}
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-gray-50 dark:border-slate-700/30 hover:bg-gray-50 dark:hover:bg-slate-700/20 transition-colors"
                  >
                    <td className="px-5 py-3 font-medium text-gray-900 dark:text-gray-100">{r.bp_name || `BP #${r.bp_employee_id}`}</td>
                    <td className="px-5 py-3 text-gray-500 dark:text-gray-400">{r.bp_dms_code || "—"}</td>
                    <td className="px-5 py-3">
                      <span className="font-mono text-xs font-medium px-2 py-1 rounded-full bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                        {r.retailer_code}
                      </span>
                    </td>
                    {isAdmin && (
                      <td className="px-5 py-3 text-right">
                        <button
                          onClick={() => setDeleteTarget(r)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                          title="Remove"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-3 text-xs text-gray-400 border-t border-gray-50 dark:border-slate-700/30">
            {records.length} assignment{records.length !== 1 ? "s" : ""}
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDeleteTarget(null)} />
          <div className="relative bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-gray-100 dark:border-slate-700/50 p-6 w-full max-w-sm animate-in fade-in zoom-in-95">
            <div className="flex flex-col items-center text-center">
              <div className="w-12 h-12 rounded-full bg-red-50 dark:bg-red-500/10 flex items-center justify-center mb-4">
                <AlertTriangle className="w-6 h-6 text-red-500" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Remove Assignment</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">
                Are you sure you want to remove this assignment?
              </p>
              <p className="text-sm font-mono font-medium text-gray-700 dark:text-gray-300 mb-6">
                {deleteTarget.bp_name || `BP #${deleteTarget.bp_employee_id}`} — {deleteTarget.retailer_code}
              </p>
              <div className="flex gap-3 w-full">
                <button
                  onClick={() => setDeleteTarget(null)}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-600 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleDelete(deleteTarget.id)}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-red-500 text-sm font-medium text-white hover:bg-red-600 transition-colors"
                >
                  Remove
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
