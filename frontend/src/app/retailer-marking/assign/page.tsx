"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import {
  Search,
  Loader2,
  Check,
  Store,
  Tag,
  Plus,
  X,
  UserCheck,
  MapPin,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "react-hot-toast";
import { AccessDenied } from "@/components/ui/AccessDenied";
import PageGuideModal from "@/components/PageGuideModal";
import { useLanguage } from "@/i18n/useLanguage";
import { houseHeaders, type DropdownMarking, type RetailerRow } from "../types";

export default function AssignPage() {
  const { selectedHouse, hasPermission, loading: authLoading } = useAuth();
  const router = useRouter();
  const { t } = useLanguage();

  const [markings, setMarkings] = useState<DropdownMarking[]>([]);
  const [selectedMarkingId, setSelectedMarkingId] = useState<number | "">("");
  const [markedRetailers, setMarkedRetailers] = useState<RetailerRow[]>([]);
  const [markedLoading, setMarkedLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<RetailerRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [remarks, setRemarks] = useState("");
  const [applying, setApplying] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canAssign = hasPermission("retailer_markings.assign");

  useEffect(() => {
    if (!authLoading && !hasPermission("retailer_markings.assign")) {
      const timer = setTimeout(() => router.push("/"), 5000);
      return () => clearTimeout(timer);
    }
  }, [authLoading, hasPermission, router]);

  const fetchMarkings = useCallback(async () => {
    try {
      const res = await apiClient.get("retailer-markings/options");
      setMarkings(res.data || []);
    } catch {
      setMarkings([]);
    }
  }, []);

  useEffect(() => {
    if (!authLoading && hasPermission("retailer_markings.assign")) {
      fetchMarkings();
    }
  }, [authLoading, hasPermission, fetchMarkings]);

  const selectedMarking = markings.find((m) => m.id === selectedMarkingId);

  const fetchMarkedRetailers = useCallback(
    async (markingName: string) => {
      if (!markingName) {
        setMarkedRetailers([]);
        return;
      }
      setMarkedLoading(true);
      try {
        const res = await apiClient.get("retailer-markings/retailers", {
          params: { marking: markingName, per_page: 100, sort_by: "name", sort_order: "asc" },
          headers: houseHeaders(selectedHouse),
        });
        setMarkedRetailers(res.data.data || []);
      } catch {
        setMarkedRetailers([]);
      } finally {
        setMarkedLoading(false);
      }
    },
    [selectedHouse]
  );

  useEffect(() => {
    if (selectedMarking) {
      fetchMarkedRetailers(selectedMarking.name);
      setSearch("");
      setSearchResults([]);
      setSelectedIds(new Set());
    } else {
      setMarkedRetailers([]);
    }
  }, [selectedMarkingId]); // eslint-disable-line react-hooks/exhaustive-deps

  const searchRetailers = useCallback(
    async (query: string) => {
      if (!query.trim()) {
        setSearchResults([]);
        setSearching(false);
        return;
      }
      setSearching(true);
      try {
        const res = await apiClient.get("retailer-markings/retailers", {
          params: { search: query.trim(), per_page: 100, sort_by: "name", sort_order: "asc" },
          headers: houseHeaders(selectedHouse),
        });
        setSearchResults(res.data.data || []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    },
    [selectedHouse]
  );

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!search.trim()) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    searchTimer.current = setTimeout(() => searchRetailers(search), 250);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [search, searchRetailers]);

  const markedIds = new Set(markedRetailers.map((r) => r.id));
  const unmarkedResults = searchResults.filter((r) => !markedIds.has(r.id));

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === unmarkedResults.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(unmarkedResults.map((r) => r.id)));
  };

  const handleAssign = async () => {
    if (!selectedMarking || selectedIds.size === 0) return;
    setApplying(true);
    try {
      const res = await apiClient.post(`retailer-markings/${selectedMarking.id}/assign`, {
        marking_id: selectedMarking.id,
        retailer_ids: Array.from(selectedIds),
        remarks: remarks.trim() || null,
      });
      toast.success(t("retailer_marking.toast_assigned", { count: res.data.assigned }));
      if (res.data.errors && res.data.errors.length > 0) {
        res.data.errors.slice(0, 3).forEach((e: string) => toast.error(e));
      }
      setSelectedIds(new Set());
      await fetchMarkedRetailers(selectedMarking.name);
    } catch (err: any) {
      toast.error(err.response?.data?.detail || t("retailer_marking.toast_save_failed"));
    } finally {
      setApplying(false);
    }
  };

  const handleUnassign = async (retailerId: number) => {
    if (!selectedMarking) return;
    setApplying(true);
    try {
      const res = await apiClient.post(`retailer-markings/${selectedMarking.id}/unassign`, {
        retailer_ids: [retailerId],
        remarks: remarks.trim() || "Removed from marking",
      });
      toast.success(t("retailer_marking.toast_unassigned", { count: res.data.removed }));
      await fetchMarkedRetailers(selectedMarking.name);
    } catch (err: any) {
      toast.error(err.response?.data?.detail || t("retailer_marking.toast_save_failed"));
    } finally {
      setApplying(false);
    }
  };

  if (authLoading)
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    );
  if (!canAssign) return <AccessDenied />;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
            {t("retailer_marking.assign_title")}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {t("retailer_marking.assign_description")}
          </p>
        </div>
        <PageGuideModal pageKey="retailer_marking" />
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm p-5">
        <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">
          {t("retailer_marking.select_marking")}
        </label>
        <select
          value={selectedMarkingId}
          onChange={(e) => setSelectedMarkingId(e.target.value ? Number(e.target.value) : "")}
          className="w-full sm:w-80 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm dark:text-gray-100 focus:ring-2 focus:ring-primary-500 outline-none"
        >
          <option value="">{t("retailer_marking.select_marking")}</option>
          {markings.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.code})
            </option>
          ))}
        </select>
        <div className="mt-4">
          <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">
            {t("retailer_marking.remarks_label")}
          </label>
          <input
            type="text"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder={t("retailer_marking.remarks_placeholder")}
            className="w-full sm:w-96 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm dark:text-gray-100 focus:ring-2 focus:ring-primary-500 outline-none"
          />
        </div>
      </div>

      {!selectedMarking ? (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm p-12 text-center">
          <Tag className="w-12 h-12 text-gray-200 dark:text-gray-700 mx-auto mb-4" />
          <p className="text-gray-500 dark:text-gray-400 font-medium">{t("retailer_marking.select_marking_first")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Marked retailers */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
            <div className="p-5 border-b border-gray-50 dark:border-slate-800 flex items-center justify-between gap-3">
              <h2 className="font-bold flex items-center gap-2 dark:text-gray-100">
                <Tag className="w-5 h-5 text-primary-600" />
                {t("retailer_marking.marked_retailers")}
                <span className="text-xs font-bold bg-primary-50 dark:bg-primary-500/10 text-primary-600 px-2 py-0.5 rounded-full">
                  {markedRetailers.length}
                </span>
              </h2>
            </div>
            <div className="divide-y divide-gray-50 dark:divide-slate-800 max-h-[520px] overflow-y-auto">
              {markedLoading ? (
                <div className="p-6 space-y-3 animate-pulse">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-gray-200 dark:bg-slate-700 shrink-0" />
                      <div className="flex-1 space-y-2">
                        <div className="h-3 w-32 bg-gray-200 dark:bg-slate-700 rounded-md" />
                        <div className="h-2.5 w-20 bg-gray-100 dark:bg-slate-800 rounded-md" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : markedRetailers.length === 0 ? (
                <div className="p-8 text-center">
                  <p className="text-sm text-gray-400 dark:text-gray-500">{t("retailer_marking.no_marked")}</p>
                </div>
              ) : (
                markedRetailers.map((r) => (
                  <div key={r.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50/50 dark:hover:bg-slate-800/50 transition-colors">
                    <div className="w-10 h-10 rounded-xl bg-primary-50 dark:bg-primary-500/10 flex items-center justify-center shrink-0">
                      <Store className="w-5 h-5 text-primary-600 dark:text-primary-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">{r.name}</p>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                        <span className="font-mono">{r.retailer_code}</span>
                        {r.itop_number && <span className="flex items-center gap-1"><UserCheck className="w-3 h-3" />{r.itop_number}</span>}
                        {r.thana && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{r.thana}</span>}
                      </div>
                    </div>
                    <button
                      onClick={() => handleUnassign(r.id)}
                      disabled={applying}
                      className="p-2 rounded-xl text-gray-300 dark:text-gray-600 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all disabled:opacity-50"
                      title={t("retailer_marking.unassign_btn")}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Right: Search & assign */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
            <div className="p-5 border-b border-gray-50 dark:border-slate-800">
              <h2 className="font-bold flex items-center gap-2 dark:text-gray-100 mb-3">
                <Plus className="w-5 h-5 text-primary-600" /> {t("retailer_marking.select_retailer")}
              </h2>
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("retailer_marking.search_retailers")}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm dark:text-gray-100 focus:ring-2 focus:ring-primary-500 outline-none"
                />
              </div>
            </div>
            <div className="divide-y divide-gray-50 dark:divide-slate-800 max-h-[520px] overflow-y-auto">
              {!search.trim() ? (
                <div className="p-8 text-center">
                  <p className="text-sm text-gray-400 dark:text-gray-500">{t("retailer_marking.search_retailers")}</p>
                </div>
              ) : searching ? (
                <div className="p-8 text-center">
                  <Loader2 className="w-5 h-5 animate-spin text-primary-500 mx-auto" />
                </div>
              ) : unmarkedResults.length === 0 ? (
                <div className="p-8 text-center">
                  <p className="text-sm text-gray-400 dark:text-gray-500">{t("retailer_marking.no_search_results")}</p>
                </div>
              ) : (
                unmarkedResults.map((r) => (
                  <div
                    key={r.id}
                    onClick={() => toggleSelect(r.id)}
                    className={cn(
                      "flex items-center gap-3 px-5 py-3.5 cursor-pointer transition-colors",
                      selectedIds.has(r.id) ? "bg-primary-50/50 dark:bg-primary-500/5" : "hover:bg-gray-50/50 dark:hover:bg-slate-800/50"
                    )}
                  >
                    <div
                      className={cn(
                        "w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all shrink-0",
                        selectedIds.has(r.id) ? "bg-primary-600 border-primary-600" : "border-gray-300 dark:border-gray-600"
                      )}
                    >
                      {selectedIds.has(r.id) && <Check className="w-3.5 h-3.5 text-white" />}
                    </div>
                    <div className="w-10 h-10 rounded-xl bg-gray-50 dark:bg-slate-800 flex items-center justify-center shrink-0">
                      <Store className="w-5 h-5 text-gray-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">{r.name}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 truncate">
                        {r.retailer_code} · {r.itop_number || "—"}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
            {searchResults.length > 0 && (
              <div className="p-4 border-t border-gray-50 dark:border-slate-800 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <button onClick={toggleSelectAll} className="text-primary-600 dark:text-primary-400 font-semibold hover:underline">
                    {selectedIds.size === unmarkedResults.length
                      ? t("retailer_marking.deselect_all")
                      : t("retailer_marking.select_all")}
                  </button>
                  <span className="text-gray-400">{t("retailer_marking.selected_count", { count: selectedIds.size })}</span>
                </div>
                <button
                  onClick={handleAssign}
                  disabled={selectedIds.size === 0 || applying}
                  className="w-full py-3 bg-primary-600 text-white rounded-xl text-sm font-semibold hover:bg-primary-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                >
                  {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Tag className="w-4 h-4" />}
                  {t("retailer_marking.assign_btn")}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}