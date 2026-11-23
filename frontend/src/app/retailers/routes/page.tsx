"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import { cn } from "@/lib/utils";
import { toast } from "react-hot-toast";
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Hash,
  Loader2,
  Pencil,
  Plus,
  Route as RouteIcon,
  Search,
  SlidersHorizontal,
  Trash2,
  Upload,
  UserCheck,
  UserX,
  X,
} from "lucide-react";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";
import PageGuideModal from "@/components/PageGuideModal";
import EntitySelector from "@/app/zoom-in/_components/EntitySelector";
import { houseHeaders, type PaginationMeta } from "../retailer-marking/types";

interface RsoOwner {
  employee_id: number;
  name: string;
  dms_code: string | null;
  itop_number: string | null;
}

interface RouteRow {
  id: number;
  house_id: number;
  code: string;
  name: string | null;
  description: string | null;
  route_length: number | null;
  visit_days: string[];
  is_active: boolean;
  rso: RsoOwner | null;
  retailer_count: number;
}

interface RsoOption {
  id: number;
  name: string;
  sublabel?: string;
}

interface AccessibleHouse {
  id: number;
  name: string;
  code: string;
}

interface RouteFilters {
  status: "" | "active" | "inactive";
  owner: "" | "assigned" | "unassigned";
}

const defaultFilters: RouteFilters = { status: "", owner: "assigned" };

const DAY_KEYS = ["sat", "sun", "mon", "tue", "wed", "thu", "fri"] as const;
const DAY_VALUES = [
  "saturday",
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
] as const;

interface ImportResult {
  total_rows: number;
  created: number;
  updated: number;
  unchanged: number;
  rso_assigned: number;
  rso_unmatched: number;
  skipped: number;
  house_ids: number[];
  house_codes: string[];
  errors: string[];
}

const inputClass =
  "w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm dark:text-gray-100 focus:ring-2 focus:ring-primary-500 outline-none";

export default function RoutesPage() {
  const router = useRouter();
  const { selectedHouse, updateUser, hasPermission, loading: authLoading } = useAuth();
  const { t } = useLanguage();

  const [rows, setRows] = useState<RouteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const perPage = 20;
  const [houses, setHouses] = useState<AccessibleHouse[]>([]);
  const [scopeHouseId, setScopeHouseId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draftFilters, setDraftFilters] = useState<RouteFilters>({ ...defaultFilters });
  const [filters, setFilters] = useState<RouteFilters>({ ...defaultFilters });
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<RouteRow | null>(null);
  const [formCode, setFormCode] = useState("");
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formRouteLength, setFormRouteLength] = useState("");
  const [formVisitDays, setFormVisitDays] = useState<string[]>([]);
  const [formActive, setFormActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [assignTarget, setAssignTarget] = useState<RouteRow | null>(null);
  const [rsoOptions, setRsoOptions] = useState<RsoOption[]>([]);
  const [rsoLoading, setRsoLoading] = useState(false);
  const [assignedRso, setAssignedRso] = useState<string[]>([]);
  const [assigning, setAssigning] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<RouteRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showSelectedDelete, setShowSelectedDelete] = useState(false);
  const [permanentDeleting, setPermanentDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [showImport, setShowImport] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const canCreate = hasPermission("routes.create");
  const canEdit = hasPermission("routes.edit");
  const canDelete = hasPermission("routes.delete");
  const canPermanentDelete = hasPermission("routes.delete.permanent");
  const canAssign = hasPermission("routes.assign");
  const canImport = hasPermission("routes.import");
  const canExport = hasPermission("routes.export");
  const activeFilterCount = (filters.status ? 1 : 0) + (filters.owner ? 1 : 0);

  useEffect(() => {
    if (!authLoading && !hasPermission("routes.view")) {
      const timer = setTimeout(() => router.push("/"), 5000);
      return () => clearTimeout(timer);
    }
  }, [authLoading, hasPermission, router]);

  useEffect(() => {
    apiClient
      .get("houses/accessible")
      .then((res) => setHouses(Array.isArray(res.data) ? res.data : []))
      .catch((err) => {
        console.error(err);
        setHouses([]);
      });
  }, []);

  const fetchRoutes = useCallback(async (houseOverride: { id: number } | null = null) => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = {
        page,
        per_page: perPage,
        sort_by: "code",
        sort_order: "asc",
      };
      if (search.trim()) params.search = search.trim();
      if (filters.status) params.is_active = filters.status === "active";
      if (filters.owner) params.has_rso = filters.owner === "assigned";
      const res = await apiClient.get("routes", {
        params,
        headers: houseHeaders(houseOverride ?? (scopeHouseId ? { id: scopeHouseId } : null)),
      });
      setRows(
        (res.data.data || []).map((row: RouteRow) => ({
          ...row,
          visit_days: row.visit_days ?? [],
        }))
      );
      setPagination(res.data.pagination || null);
    } catch (err) {
      console.error(err);
      toast.error(t("routes.toast_load_failed"));
    } finally {
      setLoading(false);
    }
  }, [page, search, filters, scopeHouseId, t]);

  useEffect(() => {
    if (!authLoading && hasPermission("routes.view")) fetchRoutes();
  }, [fetchRoutes, authLoading, hasPermission]);

  const openCreate = () => {
    setEditing(null);
    setFormCode("");
    setFormName("");
    setFormDescription("");
    setFormRouteLength("");
    setFormVisitDays([]);
    setFormActive(true);
    setFormError(null);
    setShowForm(true);
  };

  const openEdit = (row: RouteRow) => {
    setEditing(row);
    setFormCode(row.code);
    setFormName(row.name || "");
    setFormDescription(row.description || "");
    setFormRouteLength(row.route_length == null ? "" : String(row.route_length));
    setFormVisitDays(row.visit_days ?? []);
    setFormActive(row.is_active);
    setFormError(null);
    setShowForm(true);
  };

  const handleSave = async () => {
    const routeLength = formRouteLength.trim() ? Number(formRouteLength) : null;
    if (
      routeLength !== null &&
      (!Number.isFinite(routeLength) || routeLength < 0)
    ) {
      setFormError(t("routes.validation_length"));
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const headers = houseHeaders(selectedHouse);
      if (editing) {
        await apiClient.patch(
          `routes/${editing.id}`,
          {
            name: formName,
            description: formDescription,
            route_length: routeLength,
            visit_days: formVisitDays,
            is_active: formActive,
          },
          { headers }
        );
        toast.success(t("routes.toast_update_success"));
      } else {
        await apiClient.post(
          "routes",
          { code: formCode.trim().toUpperCase(), name: formName },
          { headers }
        );
        toast.success(t("routes.toast_create_success"));
      }
      setShowForm(false);
      setPage(1);
      fetchRoutes();
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      setFormError(
        typeof detail === "string" ? detail : t("routes.toast_save_failed")
      );
    } finally {
      setSaving(false);
    }
  };

  const openAssign = async (row: RouteRow) => {
    setAssignTarget(row);
    setAssignedRso(row.rso ? [String(row.rso.employee_id)] : []);
    await loadRso("");
  };

  const loadRso = async (query: string) => {
    setRsoLoading(true);
    try {
      const params: Record<string, unknown> = {
        per_page: 50,
        employee_type: "rso",
        status: "Active",
      };
      if (query.trim()) params.search = query.trim();
      const res = await apiClient.get("employees", {
        params,
        headers: houseHeaders(selectedHouse),
      });
      const list = (res.data?.data || res.data || []) as any[];
      setRsoOptions(
        list.map((emp) => ({
          id: emp.id,
          name: emp.employee_name || emp.dms_code || emp.employee_id,
          sublabel: [emp.dms_code, emp.itop_number].filter(Boolean).join(" · "),
        }))
      );
    } catch (err) {
      console.error(err);
      setRsoOptions([]);
    } finally {
      setRsoLoading(false);
    }
  };

  const handleAssign = async () => {
    if (!assignTarget || assignedRso.length === 0) return;
    setAssigning(true);
    try {
      await apiClient.post(
        `routes/${assignTarget.id}/assign-rso`,
        { employee_id: Number(assignedRso[0]) },
        { headers: houseHeaders(selectedHouse) }
      );
      toast.success(t("routes.toast_assign_success"));
      setAssignTarget(null);
      fetchRoutes();
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : t("routes.toast_save_failed"));
    } finally {
      setAssigning(false);
    }
  };

  const handleUnassign = async (row: RouteRow) => {
    try {
      await apiClient.post(
        `routes/${row.id}/unassign-rso`,
        {},
        { headers: houseHeaders(selectedHouse) }
      );
      toast.success(t("routes.toast_unassign_success"));
      fetchRoutes();
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : t("routes.toast_save_failed"));
    }
  };

  const toggleActive = async (row: RouteRow) => {
    try {
      await apiClient.patch(
        `routes/${row.id}`,
        { is_active: !row.is_active },
        { headers: houseHeaders(selectedHouse) }
      );
      toast.success(t("routes.toast_update_success"));
      fetchRoutes();
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : t("routes.toast_save_failed"));
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiClient.delete(`routes/${deleteTarget.id}`, {
        headers: houseHeaders(selectedHouse),
      });
      toast.success(t("routes.toast_delete_success"));
      setDeleteTarget(null);
      fetchRoutes();
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : t("routes.toast_save_failed"));
    } finally {
      setDeleting(false);
    }
  };


  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await apiClient.get("routes/export", {
        responseType: "blob",
        headers: houseHeaders(selectedHouse),
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement("a");
      link.href = url;
      link.download = "routes_export.xlsx";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      toast.error(t("routes.toast_export_failed"));
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async () => {
    if (!importFile) return;
    setImporting(true);
    setImportResult(null);
    try {
      const formData = new FormData();
      formData.append("file", importFile);
      const res = await apiClient.post("routes/import", formData, {
        headers: houseHeaders(selectedHouse),
      });
      const result = res.data?.data as ImportResult | null;
      setImportResult(result);
      toast.success(t("routes.import_success"));
      setPage(1);
      if (result?.house_ids?.length) {
        const importedHouseId = result.house_ids[0];
        setScopeHouseId(importedHouseId);
        updateUser({ selected_house_id: importedHouseId });
        fetchRoutes({ id: importedHouseId });
      } else {
        fetchRoutes();
      }
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : t("routes.import_failed"));
    } finally {
      setImporting(false);
    }
  };

  const toggleSelected = (routeId: number) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(routeId)) next.delete(routeId);
      else next.add(routeId);
      return next;
    });
  };

  const handlePermanentDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    setPermanentDeleting(true);
    try {
      await Promise.all(
        Array.from(selectedIds).map((routeId) =>
          apiClient.delete(`routes/permanent/${routeId}`, {
            headers: houseHeaders(scopeHouseId ? { id: scopeHouseId } : null),
          })
        )
      );
      toast.success(t("routes.permanent_delete_selected_success"));
      setSelectedIds(new Set());
      setShowSelectedDelete(false);
      setPage(1);
      fetchRoutes();
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      toast.error(
        typeof detail === "string"
          ? detail
          : t("routes.permanent_delete_failed")
      );
    } finally {
      setPermanentDeleting(false);
    }
  };

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(
      (row) =>
        row.code.toLowerCase().includes(term) ||
        (row.name || "").toLowerCase().includes(term)
    );
  }, [rows, search]);

  if (authLoading) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-8 w-48 rounded-lg bg-gray-200 dark:bg-slate-700 animate-pulse" />
        <div className="h-64 rounded-2xl bg-gray-100 dark:bg-slate-800 animate-pulse" />
      </div>
    );
  }

  if (!hasPermission("routes.view")) return <AccessDenied />;

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {t("routes.title")}
            </h1>
            <PageGuideModal pageKey="routes" />
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {t("routes.description")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canImport && (
            <button
              onClick={() => {
                setImportFile(null);
                setImportResult(null);
                setShowImport(true);
              }}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <Upload className="w-4 h-4" />
              {t("routes.import")}
            </button>
          )}
          {canExport && (
            <button
              onClick={handleExport}
              disabled={exporting}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
            >
              {exporting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              {t("routes.export")}
            </button>
          )}
          {canPermanentDelete && selectedIds.size > 0 && (
            <button
              onClick={() => setShowSelectedDelete(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-red-200 dark:border-red-500/30 text-sm font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
              {t("routes.permanent_delete_selected")} ({selectedIds.size})
            </button>
          )}
          {canCreate && (
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary-600 text-white text-sm font-bold hover:bg-primary-700 transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              {t("routes.add_route")}
            </button>
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-50 dark:border-slate-800 flex items-center gap-3">
          <div className="w-full sm:w-64 shrink-0">
            <EntitySelector
              label={t("routes.house_select")}
              hideLabel
              items={houses.map((house) => ({
                id: house.id,
                label: house.name,
                sublabel: house.code,
              }))}
              selectedIds={scopeHouseId ? [scopeHouseId] : []}
              onChange={(ids) => {
                const value = ids.length ? Number(ids[0]) : null;
                setScopeHouseId(value);
                setSelectedIds(new Set());
                setPage(1);
                fetchRoutes(value ? { id: value } : null);
              }}
              placeholder={t("routes.house_all")}
              searchPlaceholder={t("routes.house_select")}
              emptyMessage={t("routes.house_all")}
              noResultsMessage={t("routes.house_all")}
              single
              closeOnSelect
              portal
              showSelectAll={false}
              clearLabel={t("common.clear")}
              selectedLabel={t("routes.selected")}
            />
          </div>
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("routes.search_placeholder")}
              className="w-full pl-10 pr-4 py-2.5 bg-gray-50 dark:bg-slate-800 border-none rounded-xl text-sm focus:ring-2 focus:ring-primary-500 outline-none dark:text-gray-100"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setDraftFilters({ ...filters });
              setFiltersOpen(true);
            }}
            title={t("routes.filter_title")}
            aria-label={t("routes.filter_title")}
            className="relative p-2.5 rounded-xl border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <SlidersHorizontal className="w-4 h-4" />
            {activeFilterCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-primary-600 text-white text-[10px] font-bold flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        {loading ? (
          <div className="divide-y divide-gray-50 dark:divide-slate-800">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-6 py-5 animate-pulse">
                <div className="w-10 h-10 rounded-xl bg-gray-200 dark:bg-slate-700 shrink-0" />
                <div className="space-y-2 flex-1">
                  <div className="h-3 w-40 bg-gray-200 dark:bg-slate-700 rounded-md" />
                  <div className="h-2.5 w-24 bg-gray-100 dark:bg-slate-800 rounded-md" />
                </div>
                <div className="hidden sm:block w-32 h-3 bg-gray-200 dark:bg-slate-700 rounded-md" />
                <div className="w-16 h-6 bg-gray-200 dark:bg-slate-700 rounded-full" />
              </div>
            ))}
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="py-20 text-center">
            <RouteIcon className="w-12 h-12 text-gray-200 dark:text-gray-700 mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400 font-medium">
              {t("routes.no_data")}
            </p>
          </div>
        ) : (
          <>
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-left min-w-[980px]">
                <thead>
                  <tr className="bg-gray-50/50 dark:bg-slate-800/50 text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest border-b border-gray-50 dark:border-slate-800">
                    {canPermanentDelete && <th className="px-2 py-4 w-10"></th>}
                    <th className="px-6 py-4">{t("routes.table_code")}</th>
                    <th className="px-6 py-4">{t("routes.table_name")}</th>
                    <th className="px-6 py-4">{t("routes.table_visit_plan")}</th>
                    <th className="px-6 py-4">{t("routes.table_rso")}</th>
                    <th className="px-6 py-4">{t("routes.table_retailers")}</th>
                    <th className="px-6 py-4">{t("routes.table_status")}</th>
                    <th className="px-6 py-4 text-right">{t("routes.table_actions")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                  {filteredRows.map((row) => (
                    <tr key={row.id} className="hover:bg-gray-50/30 dark:hover:bg-slate-800/30 transition-colors">
                      {canPermanentDelete && (
                        <td className="px-2 py-1">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(row.id)}
                            onChange={() => toggleSelected(row.id)}
                            className="h-4 w-4 rounded border-gray-300 text-primary-600 cursor-pointer"
                            aria-label={`${t("routes.select_route")} ${row.code}`}
                          />
                        </td>
                      )}
                      <td className="px-2 py-1">
                        <div className="flex items-center gap-3 py-2">
                          <div className="w-10 h-10 rounded-xl bg-primary-100 dark:bg-primary-500/20 flex items-center justify-center text-primary-700 dark:text-primary-400 shrink-0">
                            <Hash className="w-5 h-5" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-mono text-sm font-bold text-gray-900 dark:text-gray-100">
                              {row.code}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-1">
                        <p className="text-sm font-medium text-gray-800 dark:text-gray-100">
                          {row.name || "—"}
                        </p>
                        {row.description && (
                          <p
                            title={row.description}
                            className="text-[11px] text-gray-500 dark:text-gray-400 line-clamp-1 max-w-[240px]"
                          >
                            {row.description}
                          </p>
                        )}
                      </td>
                      <td className="px-2 py-1">
                        {row.route_length == null && row.visit_days.length === 0 ? (
                          <span className="text-xs text-gray-400 dark:text-gray-500">—</span>
                        ) : (
                          <div>
                            {row.route_length != null && (
                              <p className="text-xs font-bold text-gray-700 dark:text-gray-200">
                                {row.route_length} {t("routes.length_unit")}
                              </p>
                            )}
                            <div className="flex flex-wrap gap-1 mt-1">
                              {DAY_KEYS.map((key, index) => {
                                const active = row.visit_days.includes(DAY_VALUES[index]);
                                return (
                                  <span
                                    key={key}
                                    title={t(`routes.day_${key}`)}
                                    className={cn(
                                      "px-1.5 py-0.5 rounded-md text-[10px] font-bold uppercase",
                                      active
                                        ? "bg-primary-50 dark:bg-primary-500/20 text-primary-700 dark:text-primary-400"
                                        : "bg-gray-100 dark:bg-slate-800 text-gray-300 dark:text-slate-600"
                                    )}
                                  >
                                    {t(`routes.day_${key}`)}
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-1">
                        {row.rso ? (
                          <div>
                            <p className="text-sm text-gray-800 dark:text-gray-100">{row.rso.name}</p>
                            {(row.rso.dms_code || row.rso.itop_number) && (
                              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                                {[row.rso.dms_code, row.rso.itop_number]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400">
                            {t("routes.unassigned")}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1">
                        <span className="text-xs font-bold text-gray-700 dark:text-gray-200 bg-gray-50 dark:bg-slate-800 px-2.5 py-1 rounded-lg">
                          {row.retailer_count}
                        </span>
                      </td>
                      <td className="px-2 py-1">
                        <span
                          className={cn(
                            "inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider",
                            row.is_active
                              ? "bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400"
                              : "bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-gray-400"
                          )}
                        >
                          {row.is_active ? t("routes.status_active") : t("routes.status_inactive")}
                        </span>
                      </td>
                      <td className="px-2 py-1">
                        <div className="flex items-center justify-end gap-1">
                          {canAssign && (
                            row.rso && row.rso.employee_id ? (
                              <button
                                onClick={() => handleUnassign(row)}
                                title={t("routes.unassign")}
                                aria-label={t("routes.unassign")}
                                className="p-2 rounded-lg text-gray-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-500/10 transition-colors cursor-pointer"
                              >
                                <UserX className="w-4 h-4" />
                              </button>
                            ) : (
                              <button
                                onClick={() => openAssign(row)}
                                title={t("routes.assign_rso")}
                                aria-label={t("routes.assign_rso")}
                                className="p-2 rounded-lg text-gray-400 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-500/10 transition-colors cursor-pointer"
                              >
                                <UserCheck className="w-4 h-4" />
                              </button>
                            )
                          )}
                          {canEdit && (
                            <button
                              onClick={() => toggleActive(row)}
                              title={t("routes.toggle_active")}
                              aria-label={t("routes.toggle_active")}
                              className="p-2 rounded-lg text-gray-400 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-500/10 transition-colors cursor-pointer"
                            >
                              <ChevronDown className="w-4 h-4" />
                            </button>
                          )}
                          {canEdit && (
                            <button
                              onClick={() => openEdit(row)}
                              title={t("routes.edit")}
                              aria-label={t("routes.edit")}
                              className="p-2 rounded-lg text-gray-400 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-500/10 transition-colors cursor-pointer"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                          )}
                          {canDelete && (
                            <button
                              onClick={() => setDeleteTarget(row)}
                              title={t("routes.delete")}
                              aria-label={t("routes.delete")}
                              className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="lg:hidden divide-y divide-gray-50 dark:divide-slate-800">
              {filteredRows.map((row) => (
                <div key={row.id}>
                  <div className="w-full flex items-center gap-3 px-5 py-4 text-left">
                    {canPermanentDelete && (
                      <input
                        type="checkbox"
                        checked={selectedIds.has(row.id)}
                        onChange={() => toggleSelected(row.id)}
                        className="h-4 w-4 rounded border-gray-300 text-primary-600 cursor-pointer shrink-0"
                        aria-label={`${t("routes.select_route")} ${row.code}`}
                      />
                    )}
                    <button
                      onClick={() => setExpandedId((prev) => (prev === row.id ? null : row.id))}
                      className="flex-1 min-w-0 flex items-center gap-3 text-left cursor-pointer"
                    >
                    <div className="w-10 h-10 rounded-xl bg-primary-100 dark:bg-primary-500/20 flex items-center justify-center text-primary-700 dark:text-primary-400 shrink-0">
                      <Hash className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-mono text-sm font-bold text-gray-900 dark:text-gray-100 truncate">
                        {row.code}
                      </p>
                      {row.name && (
                        <p className="text-[11px] font-medium text-gray-700 dark:text-gray-300 truncate">
                          {row.name}
                        </p>
                      )}
                      <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                        {row.rso ? row.rso.name : t("routes.unassigned")} · {row.retailer_count}
                      </p>
                    </div>
                    <ChevronDown
                      className={cn(
                        "w-4 h-4 text-gray-400 transition-transform",
                        expandedId === row.id && "rotate-180"
                      )}
                    />
                  </button>
                  </div>
                  {expandedId === row.id && (
                    <div className="px-5 pb-4 pt-1 space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-500 dark:text-gray-400">
                          {t("routes.table_rso")}
                        </span>
                        <span className="font-medium text-gray-800 dark:text-gray-100">
                          {row.rso ? row.rso.name : t("routes.unassigned")}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-500 dark:text-gray-400">
                          {t("routes.table_retailers")}
                        </span>
                        <span className="font-medium text-gray-800 dark:text-gray-100">
                          {row.retailer_count}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-500 dark:text-gray-400">
                          {t("routes.table_status")}
                        </span>
                        <span className="font-medium text-gray-800 dark:text-gray-100">
                          {row.is_active ? t("routes.status_active") : t("routes.status_inactive")}
                        </span>
                      </div>
                      {row.route_length != null && (
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-gray-500 dark:text-gray-400">
                            {t("routes.table_length")}
                          </span>
                          <span className="font-medium text-gray-800 dark:text-gray-100">
                            {row.route_length} {t("routes.length_unit")}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-500 dark:text-gray-400">
                          {t("routes.table_visit_plan")}
                        </span>
                        <span className="font-medium text-gray-800 dark:text-gray-100">
                          {row.visit_days.length
                            ? DAY_KEYS.filter((_, index) =>
                                row.visit_days.includes(DAY_VALUES[index])
                              )
                                .map((key) => t(`routes.day_${key}`))
                                .join(", ")
                            : "—"}
                        </span>
                      </div>
                      {row.description && (
                        <p className="text-[11px] text-gray-500 dark:text-gray-400">
                          {row.description}
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        {canAssign && (
                          <button
                            onClick={() => (row.rso ? handleUnassign(row) : openAssign(row))}
                            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 text-sm font-semibold text-gray-700 dark:text-gray-200 cursor-pointer"
                          >
                            {row.rso ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                            {row.rso ? t("routes.unassign") : t("routes.assign_rso")}
                          </button>
                        )}
                        {canEdit && (
                          <button
                            onClick={() => openEdit(row)}
                            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 text-sm font-semibold text-gray-700 dark:text-gray-200 cursor-pointer"
                          >
                            <Pencil className="w-4 h-4" />
                            {t("routes.edit")}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="p-4 border-t border-gray-50 dark:border-slate-800 flex items-center justify-between">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t("routes.showing_results", {
                  start:
                    pagination && pagination.total > 0
                      ? (pagination.page - 1) * pagination.per_page + 1
                      : 0,
                  end: pagination
                    ? Math.min(pagination.page * pagination.per_page, pagination.total)
                    : 0,
                  total: pagination?.total ?? 0,
                })}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => p - 1)}
                  disabled={!pagination?.has_prev}
                  className="p-2 border rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                  {pagination?.page ?? 1} / {pagination?.total_pages ?? 1}
                </span>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={!pagination?.has_next}
                  className="p-2 border rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Filter drawer */}
      <AnimatePresence>
        {filtersOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setFiltersOpen(false)}
              className="fixed inset-0 z-[100] bg-black/30 backdrop-blur-sm"
            />
            <motion.aside
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              role="dialog"
              aria-modal="true"
              aria-label={t("routes.filter_title")}
              className="fixed inset-y-0 right-0 z-[101] w-full sm:max-w-md bg-white dark:bg-slate-900 shadow-2xl flex flex-col"
            >
              <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-gray-100 dark:border-slate-800">
                <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">
                  {t("routes.filter_title")}
                </h2>
                <button
                  type="button"
                  onClick={() => setFiltersOpen(false)}
                  aria-label={t("common.close")}
                  className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                <div className="space-y-1.5">
                  <label className="block text-sm font-bold text-gray-700 dark:text-gray-300">
                    {t("routes.filter_status")}
                  </label>
                  <select
                    value={draftFilters.status}
                    onChange={(e) =>
                      setDraftFilters((f) => ({
                        ...f,
                        status: e.target.value as RouteFilters["status"],
                      }))
                    }
                    className={cn(inputClass, "cursor-pointer")}
                  >
                    <option value="">{t("routes.filter_all_status")}</option>
                    <option value="active">{t("routes.filter_active")}</option>
                    <option value="inactive">{t("routes.filter_inactive")}</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="block text-sm font-bold text-gray-700 dark:text-gray-300">
                    {t("routes.filter_owner")}
                  </label>
                  <select
                    value={draftFilters.owner}
                    onChange={(e) =>
                      setDraftFilters((f) => ({
                        ...f,
                        owner: e.target.value as RouteFilters["owner"],
                      }))
                    }
                    className={cn(inputClass, "cursor-pointer")}
                  >
                    <option value="">{t("routes.filter_any_owner")}</option>
                    <option value="assigned">{t("routes.filter_with_rso")}</option>
                  </select>
                </div>
              </div>
              <div className="px-5 py-4 border-t border-gray-100 dark:border-slate-800 space-y-2">
                <button
                  onClick={() => {
                    setFilters({ ...defaultFilters });
                    setDraftFilters({ ...defaultFilters });
                    setPage(1);
                    setFiltersOpen(false);
                  }}
                  className="w-full px-4 py-2.5 rounded-xl text-sm font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  {t("routes.filter_clear_all")}
                </button>
                <button
                  onClick={() => {
                    setFilters({ ...draftFilters });
                    setPage(1);
                    setFiltersOpen(false);
                  }}
                  className="w-full px-4 py-2.5 rounded-xl bg-primary-600 text-white text-sm font-bold hover:bg-primary-700 cursor-pointer"
                >
                  {t("routes.filter_apply")}
                </button>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* DMS route-list import */}
      {showImport && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-2xl shadow-2xl border border-gray-100 dark:border-slate-800 overflow-hidden">
            <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100 dark:border-slate-800">
              <div className="w-10 h-10 rounded-xl bg-primary-100 dark:bg-primary-500/20 flex items-center justify-center">
                <Upload className="w-5 h-5 text-primary-600 dark:text-primary-400" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                  {t("routes.import_title")}
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t("routes.import_subtitle")}
                </p>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <label
                htmlFor="route-import-file"
                className="block text-xs font-semibold text-gray-500 dark:text-gray-400"
              >
                {t("routes.import_file")}
              </label>
              <input
                id="route-import-file"
                type="file"
                accept=".xls,.xlsx"
                onChange={(e) => {
                  setImportFile(e.target.files?.[0] ?? null);
                  setImportResult(null);
                }}
                className="block w-full text-sm text-gray-600 dark:text-gray-300 file:mr-3 file:px-4 file:py-2.5 file:rounded-xl file:border-0 file:bg-primary-50 dark:file:bg-primary-500/20 file:text-primary-700 dark:file:text-primary-300 file:text-sm file:font-bold file:cursor-pointer cursor-pointer"
              />
              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                {t("routes.import_hint")}
              </p>
              {importResult && (
                <div className="rounded-xl bg-gray-50 dark:bg-slate-800/60 p-4 space-y-2 text-sm">
                  <div className="grid grid-cols-2 gap-2">
                    <p className="text-gray-600 dark:text-gray-300">
                      {t("routes.import_created")}:{" "}
                      <span className="font-bold text-gray-900 dark:text-gray-100">
                        {importResult.created}
                      </span>
                    </p>
                    <p className="text-gray-600 dark:text-gray-300">
                      {t("routes.import_updated")}:{" "}
                      <span className="font-bold text-gray-900 dark:text-gray-100">
                        {importResult.updated}
                      </span>
                    </p>
                    <p className="text-gray-600 dark:text-gray-300">
                      {t("routes.import_rso")}:{" "}
                      <span className="font-bold text-gray-900 dark:text-gray-100">
                        {importResult.rso_assigned}
                      </span>
                    </p>
                    <p className="text-gray-600 dark:text-gray-300">
                      {t("routes.import_unmatched")}:{" "}
                      <span className="font-bold text-gray-900 dark:text-gray-100">
                        {importResult.rso_unmatched}
                      </span>
                    </p>
                    <p className="text-gray-600 dark:text-gray-300">
                      {t("routes.import_unchanged")}:{" "}
                      <span className="font-bold text-gray-900 dark:text-gray-100">
                        {importResult.unchanged}
                      </span>
                    </p>
                    <p className="text-gray-600 dark:text-gray-300">
                      {t("routes.import_skipped")}:{" "}
                      <span className="font-bold text-gray-900 dark:text-gray-100">
                        {importResult.skipped}
                      </span>
                    </p>
                  </div>
                  {importResult.errors.length > 0 && (
                    <div className="space-y-1 pt-1">
                      <p className="text-xs font-bold text-amber-600 dark:text-amber-400">
                        {t("routes.import_errors")}
                      </p>
                      <ul className="max-h-32 overflow-y-auto space-y-0.5 text-[11px] text-gray-600 dark:text-gray-400">
                        {importResult.errors.map((error, index) => (
                          <li key={index}>{error}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="p-6 pt-0 flex gap-3">
              <button
                onClick={() => setShowImport(false)}
                disabled={importing}
                className="flex-1 py-3 rounded-xl text-gray-600 dark:text-gray-300 font-bold hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                {t("routes.cancel")}
              </button>
              <button
                onClick={handleImport}
                disabled={importing || !importFile}
                className="flex-1 py-3 rounded-xl bg-primary-600 text-white font-bold hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                {importing && <Loader2 className="w-4 h-4 animate-spin" />}
                {t("routes.import")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create / edit */}
      {showForm && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 w-full max-w-lg max-h-[90vh] rounded-2xl shadow-2xl border border-gray-100 dark:border-slate-800 overflow-hidden flex flex-col">
            <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100 dark:border-slate-800">
              <div className="w-10 h-10 rounded-xl bg-primary-100 dark:bg-primary-500/20 flex items-center justify-center">
                <RouteIcon className="w-5 h-5 text-primary-600 dark:text-primary-400" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                  {editing ? t("routes.modal_edit_title") : t("routes.modal_create_title")}
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t("routes.modal_subtitle")}
                </p>
              </div>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto">
              {formError && (
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 text-sm">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  {formError}
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                  {t("routes.field_code")} *
                </label>
                <input
                  type="text"
                  value={formCode}
                  disabled={!!editing}
                  onChange={(e) => setFormCode(e.target.value.toUpperCase())}
                  placeholder={t("routes.field_code_placeholder")}
                  maxLength={50}
                  className={cn(
                    inputClass,
                    "font-mono disabled:opacity-60 disabled:cursor-not-allowed"
                  )}
                />
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1.5">
                  {t("routes.field_code_hint")}
                </p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                  {t("routes.field_name")}
                </label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder={
                    editing
                      ? t("routes.field_name_placeholder_edit")
                      : t("routes.field_name_placeholder")
                  }
                  maxLength={120}
                  className={inputClass}
                />
              </div>
              {editing && (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                      {t("routes.field_description")}
                    </label>
                    <textarea
                      value={formDescription}
                      onChange={(e) => setFormDescription(e.target.value)}
                      rows={3}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                      {t("routes.field_length")}
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={formRouteLength}
                      onChange={(e) => setFormRouteLength(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                  <fieldset>
                    <legend className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">
                      {t("routes.field_visit_days")}
                    </legend>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {DAY_VALUES.map((day, index) => (
                        <label
                          key={day}
                          className="flex items-center gap-2 rounded-lg border border-gray-200 dark:border-slate-700 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={formVisitDays.includes(day)}
                            onChange={(event) =>
                              setFormVisitDays((days) =>
                                event.target.checked
                                  ? [...days, day]
                                  : days.filter((value) => value !== day)
                              )
                            }
                            className="cursor-pointer"
                          />
                          {t(`routes.day_${DAY_KEYS[index]}`)}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                      {t("routes.filter_status")}
                    </label>
                    <select
                      value={formActive ? "active" : "inactive"}
                      onChange={(event) =>
                        setFormActive(event.target.value === "active")
                      }
                      className={cn(inputClass, "cursor-pointer")}
                    >
                      <option value="active">{t("routes.status_active")}</option>
                      <option value="inactive">{t("routes.status_inactive")}</option>
                    </select>
                  </div>
                </>
              )}
            </div>
            <div className="p-6 pt-0 flex gap-3">
              <button
                onClick={() => setShowForm(false)}
                disabled={saving}
                className="flex-1 py-3 rounded-xl text-gray-600 dark:text-gray-300 font-bold hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                {t("routes.cancel")}
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !formCode.trim()}
                className="flex-1 py-3 rounded-xl bg-primary-600 text-white font-bold hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {editing ? t("routes.save") : t("routes.add_route")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Assign RSO */}
      {assignTarget && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-2xl shadow-2xl border border-gray-100 dark:border-slate-800 overflow-hidden">
            <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-100 dark:border-slate-800">
              <div className="w-10 h-10 rounded-xl bg-primary-100 dark:bg-primary-500/20 flex items-center justify-center">
                <UserCheck className="w-5 h-5 text-primary-600 dark:text-primary-400" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                  {t("routes.assign_title")}
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t("routes.assign_subtitle")}
                </p>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm font-mono text-gray-700 dark:text-gray-200">
                {assignTarget.code}
              </p>
              <EntitySelector
                label={t("routes.assign_select")}
                items={rsoOptions.map((option) => ({
                  id: String(option.id),
                  label: option.name,
                  sublabel: option.sublabel,
                }))}
                selectedIds={assignedRso}
                onChange={(ids) => setAssignedRso(ids.map(String))}
                placeholder={t("routes.assign_placeholder")}
                searchPlaceholder={t("routes.assign_search")}
                emptyMessage={
                  rsoLoading ? t("routes.loading") : t("routes.assign_empty")
                }
                noResultsMessage={t("routes.assign_empty")}
                onSearchChange={(q) => loadRso(q)}
                single
                closeOnSelect
                portal
                selectAllLabel={t("common.select_all")}
                clearLabel={t("common.clear")}
                selectedLabel={t("routes.selected")}
              />
            </div>
            <div className="p-6 pt-0 flex gap-3">
              <button
                onClick={() => setAssignTarget(null)}
                disabled={assigning}
                className="flex-1 py-3 rounded-xl text-gray-600 dark:text-gray-300 font-bold hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                {t("routes.cancel")}
              </button>
              <button
                onClick={handleAssign}
                disabled={assigning || assignedRso.length === 0}
                className="flex-1 py-3 rounded-xl bg-primary-600 text-white font-bold hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                {assigning && <Loader2 className="w-4 h-4 animate-spin" />}
                {t("routes.assign_confirm")}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmationModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title={t("routes.delete_confirm_title")}
        message={t("routes.delete_confirm_message")}
        confirmText={t("routes.delete_confirm")}
        type="danger"
        loading={deleting}
      />
      <ConfirmationModal
        isOpen={showSelectedDelete}
        onClose={() => setShowSelectedDelete(false)}
        onConfirm={handlePermanentDeleteSelected}
        title={t("routes.permanent_delete_selected_confirm_title")}
        message={t("routes.permanent_delete_selected_confirm_message")}
        confirmText={t("routes.permanent_delete_selected_confirm")}
        type="danger"
        loading={permanentDeleting}
      />
    </div>
  );
}
