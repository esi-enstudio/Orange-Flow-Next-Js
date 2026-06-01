"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import {
  ScrollText,
  Plus,
  X,
  Loader2,
  ToggleLeft,
  ToggleRight,
  Pencil,
} from "lucide-react";
import { toast } from "react-hot-toast";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";
import { useLanguage } from "@/i18n/useLanguage";

interface Rule {
  id: number;
  house_id: number;
  name: string;
  description: string | null;
  rule_type: string;
  config: any;
  report_types: string[] | null;
  is_active: boolean;
  valid_from: string;
  valid_to: string | null;
  created_at: string | null;
}

interface House {
  id: number;
  name: string;
  code: string;
  display_name: string;
}

interface FilterTag {
  id: number;
  house_id: number;
  name: string;
}

const RULE_TYPES: Record<string, string> = {
  retailer_tag_exclusion: "Retailer Tag Exclusion",
  product_exclusion: "Product Exclusion",
  house_exclusion: "House Exclusion",
};

const REPORT_TYPE_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  ga_live: "GA Live Report",
  activations: "Activations Report",
  itopup: "iTopUp Details",
  live_activations: "Live Activations",
  scratch_card: "Scratch Card Issues",
  sim_issues: "SIM Issues",
};

export default function ReportRulesPage() {
  const { hasPermission, loading: authLoading, user } = useAuth();
  const { t } = useLanguage();

  const [rules, setRules] = useState<Rule[]>([]);
  const [houses, setHouses] = useState<House[]>([]);
  const [availableTags, setAvailableTags] = useState<FilterTag[]>([]);
  const [availableProductCodes, setAvailableProductCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Rule | null>(null);
  const [filterHouse, setFilterHouse] = useState<string>("");
  const fetchedRef = useRef(false);
  const fetchCountRef = useRef(0);

  const [form, setForm] = useState({
    name: "",
    rule_type: "retailer_tag_exclusion",
    config: "",
    is_active: true,
    valid_from: new Date().toISOString().split("T")[0],
    valid_to: "",
    house_id: "",
  });
  const [selectedTagNames, setSelectedTagNames] = useState<string[]>([]);
  const [selectedProductCodes, setSelectedProductCodes] = useState<string[]>([]);
  const [selectedExcludedHouseIds, setSelectedExcludedHouseIds] = useState<number[]>([]);
  const [selectedReportTypes, setSelectedReportTypes] = useState<string[]>([]);

  const fetchData = async () => {
    const id = ++fetchCountRef.current;
    setLoading(true);
    try {
      const [rulesRes, housesRes] = await Promise.all([
        apiClient.get("report-rules", { params: filterHouse ? { house_id: filterHouse } : {} }),
        apiClient.get("houses/accessible"),
      ]);
      if (id !== fetchCountRef.current) return;
      setRules(rulesRes.data || []);
      setHouses(housesRes.data || []);
    } catch {
      if (id !== fetchCountRef.current) return;
      // Individual fallback: try each endpoint separately
      try {
        const rulesRes = await apiClient.get("report-rules", { params: filterHouse ? { house_id: filterHouse } : {} });
        if (id !== fetchCountRef.current) return;
        setRules(rulesRes.data || []);
      } catch (e: any) {
        console.warn("report-rules fetch failed:", e?.response?.status, e?.response?.data);
      }
      try {
        const housesRes = await apiClient.get("houses/accessible");
        if (id !== fetchCountRef.current) return;
        setHouses(housesRes.data || []);
      } catch (e: any) {
        console.warn("houses/accessible fetch failed:", e?.response?.status, e?.response?.data);
      }
    } finally {
      if (id === fetchCountRef.current) setLoading(false);
    }
  };

  const tagFetchRef = useRef(0);
  const fetchTags = useCallback(async (houseId?: number | string) => {
    const id = ++tagFetchRef.current;
    try {
      const params: Record<string, any> = {};
      if (houseId) params.house_id = houseId;
      const res = await apiClient.get("filter-tags", { params });
      if (id === tagFetchRef.current) setAvailableTags(res.data);
    } catch {}
  }, []);

  const pcFetchRef = useRef(0);
  const fetchProductCodes = useCallback(async () => {
    const id = ++pcFetchRef.current;
    try {
      const res = await apiClient.get("product-exclusions");
      if (id === pcFetchRef.current) setAvailableProductCodes(res.data.map((c: any) => c.product_code));
    } catch {}
  }, []);

  useEffect(() => {
    if (!authLoading && hasPermission("view_reports")) fetchData();
  }, [authLoading, hasPermission, filterHouse]);

  useEffect(() => {
    if (showForm && form.house_id) fetchTags(form.house_id);
  }, [showForm, form.house_id, fetchTags]);

  useEffect(() => {
    if (showForm && form.rule_type === "product_exclusion") fetchProductCodes();
  }, [showForm, form.rule_type, fetchProductCodes]);

  useEffect(() => {
    if (form.rule_type !== "retailer_tag_exclusion") setSelectedTagNames([]);
    if (form.rule_type !== "product_exclusion") setSelectedProductCodes([]);
    if (form.rule_type !== "house_exclusion") setSelectedExcludedHouseIds([]);
  }, [form.rule_type]);

  const reportTypesPayload = (): string[] =>
    selectedReportTypes.length > 0 ? selectedReportTypes : [];

  const buildConfigFromUI = (): string => {
    if (form.rule_type === "retailer_tag_exclusion") {
      return JSON.stringify({ tag_names: selectedTagNames });
    }
    if (form.rule_type === "product_exclusion") {
      return JSON.stringify({ product_codes: selectedProductCodes });
    }
    if (form.rule_type === "house_exclusion") {
      return JSON.stringify({ house_ids: selectedExcludedHouseIds });
    }
    return form.config;
  };

  const autoGenerateName = (): string => {
    const house = houses.find((h) => String(h.id) === form.house_id);
    const houseLabel = house?.display_name || `House #${form.house_id}`;
    if (form.rule_type === "retailer_tag_exclusion" && selectedTagNames.length > 0) {
      return `Exclude ${selectedTagNames.join(", ")} - ${houseLabel}`;
    }
    if (form.rule_type === "product_exclusion" && selectedProductCodes.length > 0) {
      return `Exclude Products (${selectedProductCodes.length}) - ${houseLabel}`;
    }
    if (form.rule_type === "house_exclusion" && selectedExcludedHouseIds.length > 0) {
      const excludedNames = selectedExcludedHouseIds
        .map((id) => houses.find((h) => h.id === id)?.display_name || `#${id}`)
        .join(", ");
      return `Exclude ${excludedNames} from ${houseLabel}`;
    }
    return "";
  };

  const resetForm = () => {
    setForm({
      name: "",
      rule_type: "retailer_tag_exclusion",
      config: "",
      is_active: true,
      valid_from: new Date().toISOString().split("T")[0],
      valid_to: "",
      house_id: houses.length > 0 ? String(houses[0].id) : "",
    });
    setSelectedTagNames([]);
    setSelectedProductCodes([]);
    setSelectedExcludedHouseIds([]);
    setSelectedReportTypes([]);
    setEditingId(null);
  };

  const parseConfig = (config: any): any => {
    if (typeof config === "string") {
      try { return JSON.parse(config); } catch { return config; }
    }
    return config;
  };

  const openEdit = (rule: Rule) => {
    const cfg = parseConfig(rule.config);
    setForm({
      name: rule.name,
      rule_type: rule.rule_type,
      config: "",
      is_active: rule.is_active,
      valid_from: rule.valid_from.split("T")[0],
      valid_to: rule.valid_to ? rule.valid_to.split("T")[0] : "",
      house_id: String(rule.house_id),
    });
    setSelectedTagNames(
      rule.rule_type === "retailer_tag_exclusion" ? (cfg?.tag_names || []) : []
    );
    setSelectedProductCodes(
      rule.rule_type === "product_exclusion" ? (cfg?.product_codes || []) : []
    );
    setSelectedExcludedHouseIds(
      rule.rule_type === "house_exclusion" ? (cfg?.house_ids || []) : []
    );
    setSelectedReportTypes(rule.report_types || []);
    setEditingId(rule.id);
    setShowForm(true);
  };

  const handleSave = async () => {
    const finalName = form.name.trim() || autoGenerateName();
    if (!finalName || !form.valid_from) {
      toast.error("Please fill in all required fields");
      return;
    }
    if (selectedReportTypes.length === 0) {
      toast.error("Please select at least one report for this rule");
      return;
    }
    const configStr = buildConfigFromUI();
    let configParsed: any;
    try {
      configParsed = JSON.parse(configStr);
    } catch {
      toast.error("Invalid configuration");
      setSaving(false);
      return;
    }
    setSaving(true);
    try {
      const payload: any = {
        name: finalName,
        description: null,
        rule_type: form.rule_type,
        config: configParsed,
        report_types: reportTypesPayload(),
        is_active: form.is_active,
        valid_from: new Date(form.valid_from).toISOString(),
        valid_to: form.valid_to ? new Date(form.valid_to).toISOString() : null,
      };
      if (form.house_id) payload.house_id = parseInt(form.house_id);

      if (editingId) {
        await apiClient.put(`report-rules/${editingId}`, payload);
        toast.success("Rule updated");
      } else {
        await apiClient.post("report-rules", payload);
        toast.success("Rule created");
      }
      setShowForm(false);
      resetForm();
      fetchData();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || "Failed to save rule");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    const target = deleteTarget;
    if (!target) return;
    apiClient.delete(`report-rules/${target.id}`)
      .then(() => {
        toast.success("Rule deleted");
        setDeleteTarget(null);
        fetchData();
      })
      .catch(() => toast.error("Failed to delete rule"));
  };

  const toggleActive = async (rule: Rule) => {
    try {
      await apiClient.put(`report-rules/${rule.id}`, { is_active: !rule.is_active });
      toast.success(rule.is_active ? "Rule deactivated" : "Rule activated");
      fetchData();
    } catch {
      toast.error("Failed to toggle rule");
    }
  };

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    );
  }

  if (!hasPermission("view_reports")) {
    return <AccessDenied />;
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100 flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-indigo-500 text-white shadow-lg shadow-indigo-200 dark:shadow-none">
            <ScrollText className="w-5 h-5" />
          </div>
          Report Rules
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 ml-12">
          Configure per-house, monthly report calculation rules
        </p>
      </div>

      {/* Filters & Add */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex gap-3 items-center">
          <select
            value={filterHouse}
            onChange={(e) => setFilterHouse(e.target.value)}
            className="px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500 outline-none"
          >
            <option value="">All Houses</option>
            {houses.map((h) => (
              <option key={h.id} value={h.id}>{h.display_name}</option>
            ))}
          </select>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-semibold hover:bg-primary-700 transition-colors flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> New Rule
        </button>
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-gray-100 dark:border-slate-800 w-full max-w-lg mx-4 max-h-[95vh] overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-gray-300 dark:[&::-webkit-scrollbar-thumb]:bg-slate-600 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent">
            <div className="px-5 py-4 border-b border-gray-50 dark:border-slate-800 flex items-center justify-between">
              <h2 className="text-lg font-bold dark:text-gray-100">
                {editingId ? "Edit Rule" : "New Rule"}
              </h2>
              <button onClick={() => setShowForm(false)} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800">
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            <div className="p-5 space-y-4">

              {/* House — top */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">House</label>
                <select value={form.house_id} onChange={(e) => setForm({ ...form, house_id: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500 outline-none text-sm transition-shadow">
                  <option value="">Select House</option>
                  {houses.map((h) => (
                    <option key={h.id} value={h.id}>{h.display_name}</option>
                  ))}
                </select>
              </div>

              {/* Rule Type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Rule Type</label>
                <select value={form.rule_type} onChange={(e) => setForm({ ...form, rule_type: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500 outline-none text-sm transition-shadow">
                  {Object.entries(RULE_TYPES).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>

              {/* Config — pill-style multi-select */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Configuration
                </label>
                {form.rule_type === "retailer_tag_exclusion" && (
                  <div className="flex flex-wrap gap-2">
                    {!form.house_id ? (
                      <p className="text-xs text-gray-400 w-full">Select a house first</p>
                    ) : availableTags.length === 0 ? (
                      <p className="text-xs text-gray-400 w-full">No tags found for this house. Create tags in Retailer Marking first.</p>
                    ) : (
                      availableTags.map((tag) => (
                        <button
                          key={tag.id}
                          type="button"
                          onClick={() =>
                            setSelectedTagNames((prev) =>
                              prev.includes(tag.name)
                                ? prev.filter((n) => n !== tag.name)
                                : [...prev, tag.name]
                            )
                          }
                          className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-all duration-200 border ${
                            selectedTagNames.includes(tag.name)
                              ? "bg-indigo-600 text-white border-indigo-600 shadow-sm shadow-indigo-200 dark:shadow-indigo-900/40"
                              : "bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-slate-600 hover:border-indigo-300 dark:hover:border-indigo-500 hover:text-indigo-600 dark:hover:text-indigo-400"
                          }`}
                        >
                          {tag.name}
                        </button>
                      ))
                    )}
                  </div>
                )}
                {form.rule_type === "product_exclusion" && (
                  <div className="flex flex-wrap gap-2">
                    {availableProductCodes.length === 0 ? (
                      <p className="text-xs text-gray-400 w-full">No excluded product codes found. Add them in Product Exclusions first.</p>
                    ) : (
                      availableProductCodes.map((code) => (
                        <button
                          key={code}
                          type="button"
                          onClick={() =>
                            setSelectedProductCodes((prev) =>
                              prev.includes(code)
                                ? prev.filter((c) => c !== code)
                                : [...prev, code]
                            )
                          }
                          className={`px-3.5 py-1.5 rounded-full text-sm font-mono font-medium transition-all duration-200 border ${
                            selectedProductCodes.includes(code)
                              ? "bg-red-500 text-white border-red-500 shadow-sm shadow-red-200 dark:shadow-red-900/40"
                              : "bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-slate-600 hover:border-red-300 dark:hover:border-red-500 hover:text-red-600 dark:hover:text-red-400"
                          }`}
                        >
                          {code}
                        </button>
                      ))
                    )}
                  </div>
                )}
                {form.rule_type === "house_exclusion" && (
                  <div className="flex flex-wrap gap-2">
                    {houses.filter((h) => String(h.id) !== form.house_id).length === 0 ? (
                      <p className="text-xs text-gray-400 w-full">No other houses available</p>
                    ) : (
                      houses
                        .filter((h) => String(h.id) !== form.house_id)
                        .map((h) => (
                          <button
                            key={h.id}
                            type="button"
                            onClick={() =>
                              setSelectedExcludedHouseIds((prev) =>
                                prev.includes(h.id)
                                  ? prev.filter((id) => id !== h.id)
                                  : [...prev, h.id]
                              )
                            }
                            className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-all duration-200 border ${
                              selectedExcludedHouseIds.includes(h.id)
                                ? "bg-amber-600 text-white border-amber-600 shadow-sm shadow-amber-200 dark:shadow-amber-900/40"
                                : "bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-slate-600 hover:border-amber-300 dark:hover:border-amber-500 hover:text-amber-600 dark:hover:text-amber-400"
                            }`}
                          >
                            {h.display_name}
                          </button>
                        ))
                    )}
                  </div>
                )}
              </div>

              {/* Reports */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Applies to Reports
                </label>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(REPORT_TYPE_LABELS).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() =>
                        setSelectedReportTypes((prev) =>
                          prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
                        )
                      }
                      className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-all duration-200 border ${
                        selectedReportTypes.includes(key)
                          ? "bg-teal-600 text-white border-teal-600 shadow-sm shadow-teal-200 dark:shadow-teal-900/40"
                          : "bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-slate-600 hover:border-teal-300 dark:hover:border-teal-500 hover:text-teal-600 dark:hover:text-teal-400"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="text-xs mt-1.5">
                  {selectedReportTypes.length === 0 ? (
                    <span className="text-amber-500 font-medium">Select at least one report</span>
                  ) : (
                    <span className="text-gray-400 dark:text-gray-500">
                      Applies to {selectedReportTypes.length} report{selectedReportTypes.length > 1 ? "s" : ""}
                    </span>
                  )}
                </p>
              </div>

              {/* Auto-generated name preview */}
              {autoGenerateName() && (
                <div className="bg-gradient-to-r from-gray-50 to-indigo-50/50 dark:from-slate-800/50 dark:to-indigo-900/10 rounded-xl px-4 py-2.5 border border-gray-100 dark:border-slate-700/50">
                  <span className="text-xs text-gray-400 dark:text-gray-500 block mb-0.5 font-medium">Rule name</span>
                  <span className="text-sm text-gray-700 dark:text-gray-200 font-medium">{autoGenerateName()}</span>
                </div>
              )}

              {/* Dates */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Valid From *</label>
                  <input type="date" value={form.valid_from} onChange={(e) => setForm({ ...form, valid_from: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500 outline-none text-sm transition-shadow" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Valid To</label>
                  <input type="date" value={form.valid_to} onChange={(e) => setForm({ ...form, valid_to: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500 outline-none text-sm transition-shadow" />
                </div>
              </div>

              {/* Active toggle */}
              <div className="flex items-center justify-between bg-gray-50 dark:bg-slate-800/50 rounded-xl px-4 py-3">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Active</span>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, is_active: !form.is_active })}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-all duration-300 ${
                    form.is_active ? "bg-green-500" : "bg-gray-300 dark:bg-slate-600"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-all duration-300 ${
                      form.is_active ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
            </div>
            <div className="px-5 py-4 border-t border-gray-50 dark:border-slate-800 flex justify-end gap-3">
              <button onClick={() => setShowForm(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg transition-colors">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving || !form.valid_from || selectedReportTypes.length === 0}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-semibold hover:bg-primary-700 disabled:opacity-50 transition-colors flex items-center gap-2">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {editingId ? "Update" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rules List */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm">
        <div className="px-6 py-4 border-b border-gray-50 dark:border-slate-800 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <ScrollText className="w-4 h-4 text-gray-400" />
            Rules
            {rules.length > 0 && (
              <span className="text-xs font-bold bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 px-2 py-0.5 rounded-full">
                {rules.length}
              </span>
            )}
          </h2>
        </div>
        {loading ? (
          <div className="p-8 text-center">
            <Loader2 className="w-6 h-6 animate-spin text-primary-500 mx-auto" />
          </div>
        ) : rules.length === 0 ? (
          <div className="p-8 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-50 dark:bg-slate-800 mb-3">
              <ScrollText className="w-6 h-6 text-gray-300 dark:text-gray-600" />
            </div>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">No rules configured</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Create a rule to control report calculations</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50 dark:divide-slate-800">
            {rules.map((rule) => (
              <div key={rule.id} className="px-6 py-4 hover:bg-gray-50/50 dark:hover:bg-slate-800/50 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{rule.name}</h3>
                      <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full ${
                        rule.is_active
                          ? "bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-400"
                          : "bg-gray-100 dark:bg-gray-500/10 text-gray-500 dark:text-gray-400"
                      }`}>
                        {rule.is_active ? "Active" : "Inactive"}
                      </span>
                    </div>
                    {rule.description && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{rule.description}</p>
                    )}
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-400 dark:text-gray-500">
                      <span>{RULE_TYPES[rule.rule_type] || rule.rule_type}</span>
                      <span>House #{rule.house_id}</span>
                      <span>From {rule.valid_from.split("T")[0]}</span>
                      {rule.valid_to && <span>To {rule.valid_to.split("T")[0]}</span>}
                    </div>
                    {rule.report_types && rule.report_types.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {rule.report_types.map((rt: string) => (
                          <span key={rt} className="text-[10px] font-medium bg-teal-50 dark:bg-teal-500/10 text-teal-600 dark:text-teal-400 px-1.5 py-0.5 rounded-full">
                            {REPORT_TYPE_LABELS[rt] || rt}
                          </span>
                        ))}
                      </div>
                    )}
                    {(!rule.report_types || rule.report_types.length === 0) && (
                      <span className="text-[10px] text-amber-500 mt-1 block">No reports assigned</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => toggleActive(rule)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-green-500 hover:bg-green-50 dark:hover:bg-green-500/10 transition-all"
                      title="Toggle active">
                      {rule.is_active ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                    </button>
                    <button onClick={() => openEdit(rule)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-500/10 transition-all"
                      title="Edit">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => setDeleteTarget(rule)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all"
                      title="Delete">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmationModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Rule"
        message={`Are you sure you want to delete "${deleteTarget?.name}"?`}
        confirmText="Delete"
        type="danger"
      />
    </div>
  );
}
