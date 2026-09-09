"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "react-hot-toast";
import {
  Building2,
  Check,
  ChevronDown,
  Loader2,
  Network,
  Search,
  ShieldCheck,
  UserRoundPlus,
  Users,
  X,
} from "lucide-react";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";
import PageGuideModal from "@/components/PageGuideModal";
import { useLanguage } from "@/i18n/useLanguage";

interface AssignedMember {
  rso_employee_id: number;
  rso_user_id: number | null;
  name: string;
  employee_id: string | null;
  employee_type: string | null;
  dms_code: string | null;
  itop_number: string | null;
  pool_number: string | null;
  status: string | null;
  assigned_at: string | null;
}

interface Supervisor {
  id: number;
  user_id: number | null;
  name: string;
  employee_id: string | null;
  dms_code: string | null;
  itop_number: string | null;
  pool_number: string | null;
  status: string | null;
  rso_count: number;
  bp_count: number;
  assigned_rsos: AssignedMember[];
  assigned_bps: AssignedMember[];
}

interface UnassignedMember {
  rso_employee_id: number;
  rso_user_id: number | null;
  name: string;
  employee_id: string | null;
  employee_type: string | null;
  dms_code: string | null;
  itop_number: string | null;
  pool_number: string | null;
  status: string | null;
}

interface House {
  id: number;
  name: string;
  code: string;
}

function HouseSelector({
  houses,
  selected,
  onSelect,
  t,
}: {
  houses: House[];
  selected: number | null;
  onSelect: (id: number) => void;
  t: (path: string, params?: Record<string, string | number | undefined>) => string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = houses.find((h) => h.id === selected) ?? null;

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (houses.length <= 1) return null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-2xl text-sm font-medium hover:border-gray-300 dark:hover:border-slate-600 transition-colors cursor-pointer"
      >
        <span className="flex items-center gap-2 min-w-0">
          <Building2 className="w-4 h-4 text-gray-400 shrink-0" />
          <span className="truncate">
            {current ? `${current.name} · ${current.code}` : t("supervisors.select_house")}
          </span>
        </span>
        <ChevronDown
          className={cn("w-4 h-4 text-gray-400 shrink-0 transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <div className="absolute z-40 mt-2 w-full rounded-2xl border border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl p-1.5">
          {houses.map((h) => (
            <button
              key={h.id}
              onClick={() => {
                onSelect(h.id);
                setOpen(false);
              }}
              className="w-full flex items-center justify-between gap-3 px-3.5 py-3 rounded-xl text-sm hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <span className="font-medium text-gray-800 dark:text-gray-200 truncate">{h.name}</span>
              <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 shrink-0">{h.code}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof Users;
  label: string;
  value: number | string;
  accent: string;
}) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm p-4 flex items-center gap-4">
      <div className={cn("w-11 h-11 rounded-xl flex items-center justify-center shrink-0", accent)}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 truncate">
          {label}
        </p>
        <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 leading-tight">{value}</p>
      </div>
    </div>
  );
}

function SupervisorSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-20 rounded-2xl bg-gray-100 dark:bg-slate-800" />
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="rounded-2xl border border-gray-100 dark:border-slate-800 p-5 space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-gray-200 dark:bg-slate-700" />
              <div className="space-y-2 flex-1">
                <div className="h-3.5 w-28 bg-gray-200 dark:bg-slate-700 rounded-md" />
                <div className="h-2.5 w-20 bg-gray-100 dark:bg-slate-800 rounded-md" />
              </div>
            </div>
            <div className="h-3 w-full bg-gray-100 dark:bg-slate-800 rounded-md" />
            <div className="h-3 w-3/4 bg-gray-100 dark:bg-slate-800 rounded-md" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SupervisorsPage() {
  const { user, hasPermission, loading: authLoading } = useAuth();
  const { t } = useLanguage();

  const [allHouses, setAllHouses] = useState<House[] | null>(null);
  const [selectedHouseId, setSelectedHouseId] = useState<number | null>(null);
  const [supervisors, setSupervisors] = useState<Supervisor[]>([]);
  const [unassigned, setUnassigned] = useState<UnassignedMember[]>([]);
  const [unassignedBps, setUnassignedBps] = useState<UnassignedMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [assignTarget, setAssignTarget] = useState<Supervisor | null>(null);
  const [assignTab, setAssignTab] = useState<"rso" | "bp">("rso");
  const [selectedRsoIds, setSelectedRsoIds] = useState<Set<number>>(new Set());
  const [selectedBpIds, setSelectedBpIds] = useState<Set<number>>(new Set());
  const [assignSearch, setAssignSearch] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [removing, setRemoving] = useState<number | null>(null);

  const canAssign = hasPermission("employees.assign");
  const canView = hasPermission("employees.view");

  const assignedHouses = useMemo(() => user?.houses ?? [], [user]);
  const houses = useMemo(() => allHouses ?? assignedHouses, [allHouses, assignedHouses]);

  useEffect(() => {
    if (assignedHouses.length === 0 && !allHouses) {
      apiClient
        .get("/houses/accessible")
        .then((res) => setAllHouses(res.data))
        .catch(() => {});
    }
  }, [assignedHouses, allHouses]);

  const effectiveHouseId = useMemo(
    () => selectedHouseId ?? (houses.length === 1 ? houses[0].id : null),
    [selectedHouseId, houses]
  );

  const fetchData = useCallback(async () => {
    if (!effectiveHouseId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const headers = { "X-House-ID": String(effectiveHouseId) };
      const [supRes, unRes, bpRes] = await Promise.all([
        apiClient.get("/employees/supervisors", { headers }),
        apiClient.get("/employees/supervisors/unassigned-rsos", { headers }),
        apiClient.get("/employees/supervisors/unassigned-bps", { headers }),
      ]);
      setSupervisors(supRes.data?.data ?? []);
      setUnassigned(unRes.data?.data ?? []);
      setUnassignedBps(bpRes.data?.data ?? []);
    } catch {
      setError(t("supervisors.error_loading"));
    } finally {
      setLoading(false);
    }
  }, [effectiveHouseId, t]);

  useEffect(() => {
    if (authLoading || !canView) return;
    const id = setTimeout(fetchData, 0);
    return () => clearTimeout(id);
  }, [authLoading, canView, fetchData]);

  const stats = useMemo(() => {
    const assignedCount = supervisors.reduce((acc, s) => acc + s.rso_count + s.bp_count, 0);
    return {
      supervisors: supervisors.length,
      assigned: assignedCount,
      unassigned: unassigned.length + unassignedBps.length,
    };
  }, [supervisors, unassigned, unassignedBps]);

  const openAssign = (sup: Supervisor) => {
    setAssignTarget(sup);
    setAssignTab("rso");
    setSelectedRsoIds(new Set());
    setSelectedBpIds(new Set());
    setAssignSearch("");
  };

  const toggleMember = (id: number, type: "rso" | "bp") => {
    if (type === "rso") {
      setSelectedRsoIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    } else {
      setSelectedBpIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    }
  };

  const activeUnassigned = assignTab === "rso" ? unassigned : unassignedBps;
  const filteredUnassigned = activeUnassigned.filter((r) => {
    const q = assignSearch.toLowerCase();
    return (
      (r.name || "").toLowerCase().includes(q) ||
      (r.dms_code || "").toLowerCase().includes(q) ||
      (r.employee_id || "").toLowerCase().includes(q) ||
      (r.itop_number || "").toLowerCase().includes(q) ||
      (r.pool_number || "").toLowerCase().includes(q)
    );
  });

  const selectedCount = selectedRsoIds.size + selectedBpIds.size;

  const submitAssign = async () => {
    if (!assignTarget || selectedCount === 0 || assigning) return;
    setAssigning(true);
    try {
      await apiClient.post(`/employees/supervisors/${assignTarget.id}/assign`, {
        rso_employee_ids: Array.from(selectedRsoIds),
        bp_employee_ids: Array.from(selectedBpIds),
      });
      toast.success(t("supervisors.toast_assign_success"));
      setAssignTarget(null);
      setSelectedRsoIds(new Set());
      setSelectedBpIds(new Set());
      await fetchData();
    } catch {
      toast.error(t("supervisors.messages_assign_failed"));
    } finally {
      setAssigning(false);
    }
  };

  const handleRemove = async (member: AssignedMember) => {
    if (!canAssign || removing !== null) return;
    const sup = supervisors.find((s) =>
      s.assigned_rsos.some((r) => r.rso_employee_id === member.rso_employee_id) ||
      s.assigned_bps.some((r) => r.rso_employee_id === member.rso_employee_id)
    );
    const memberLabel = member.employee_type === "bp" ? t("supervisors.tab_bps") : t("supervisors.tab_rsos");
    if (!window.confirm(t("supervisors.remove_confirm", { name: sup?.name ?? "Supervisor", label: memberLabel }))) return;
    setRemoving(member.rso_employee_id);
    try {
      await apiClient.delete(`/employees/supervisors/assignments/${member.rso_employee_id}`);
      toast.success(t("supervisors.toast_remove_success"));
      await fetchData();
    } catch {
      toast.error(t("supervisors.messages_remove_failed"));
    } finally {
      setRemoving(null);
    }
  };

  if (!authLoading && !canView) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center max-w-sm px-4">
          <ShieldCheck className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-gray-400">{t("supervisors.access_denied")}</p>
        </div>
      </div>
    );
  }

  if (!effectiveHouseId) {
    return (
      <div className="p-4 md:p-6 max-w-7xl mx-auto">
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 py-16 text-center">
          <div className="flex flex-col items-center gap-4">
            <Building2 className="w-16 h-16 text-gray-200 dark:text-gray-700" />
            <p className="text-gray-500 dark:text-gray-400">{t("supervisors.no_house")}</p>
            <div className="w-full max-w-sm px-4">
              <HouseSelector houses={houses} selected={selectedHouseId} onSelect={setSelectedHouseId} t={t} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto pb-32">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-gray-100 tracking-tight flex items-center gap-3">
            <Users className="w-7 h-7 text-purple-500" />
            {t("supervisors.title")}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t("supervisors.subtitle")}</p>
        </div>
        <PageGuideModal pageKey="supervisors" />
      </div>

      {houses.length > 1 && (
        <div className="max-w-md">
          <HouseSelector houses={houses} selected={selectedHouseId} onSelect={setSelectedHouseId} t={t} />
        </div>
      )}

      {loading && supervisors.length === 0 ? (
        <SupervisorSkeleton />
      ) : error ? (
        <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-2xl p-6 text-center">
          <p className="text-red-600 dark:text-red-400 text-sm font-medium">{error}</p>
          <button
            onClick={fetchData}
            className="mt-4 px-4 py-2.5 rounded-xl text-sm font-semibold bg-red-600 text-white hover:bg-red-700 transition-colors cursor-pointer"
          >
            {t("common.ok")}
          </button>
        </div>
      ) : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard
              icon={Users}
              label={t("supervisors.stats_supervisors")}
              value={stats.supervisors}
              accent="bg-purple-100 dark:bg-purple-500/15 text-purple-600 dark:text-purple-400"
            />
            <StatCard
              icon={Network}
              label={t("supervisors.stats_assigned")}
              value={stats.assigned}
              accent="bg-blue-100 dark:bg-blue-500/15 text-blue-600 dark:text-blue-400"
            />
            <StatCard
              icon={UserRoundPlus}
              label={t("supervisors.stats_unassigned")}
              value={stats.unassigned}
              accent="bg-amber-100 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400"
            />
          </div>

          {supervisors.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 py-16 text-center text-sm text-gray-400">
              {t("supervisors.no_rsos")}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {supervisors.map((sup) => (
                <div
                  key={sup.id}
                  className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm flex flex-col overflow-hidden"
                >
                  <div className="p-5">
                    <div className="flex items-start gap-3">
                      <div className="w-11 h-11 rounded-xl bg-purple-100 dark:bg-purple-500/20 flex items-center justify-center text-purple-600 dark:text-purple-400 font-bold shrink-0">
                        {sup.name?.charAt(0)?.toUpperCase() || "S"}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">{sup.name}</p>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                          {sup.employee_id || "—"}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <span
                          className={cn(
                            "text-[11px] font-bold px-2.5 py-1 rounded-full",
                            sup.rso_count > 0
                              ? "bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400"
                              : "bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-gray-400"
                          )}
                        >
                          {sup.rso_count} RSO
                        </span>
                        <span
                          className={cn(
                            "text-[11px] font-bold px-2.5 py-1 rounded-full",
                            sup.bp_count > 0
                              ? "bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400"
                              : "bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-gray-400"
                          )}
                        >
                          {sup.bp_count} BP
                        </span>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-2 text-[11px]">
                      <div className="bg-gray-50 dark:bg-slate-800/60 rounded-lg px-2.5 py-2 min-w-0">
                        <p className="text-gray-400 dark:text-gray-500">{t("supervisors.dms_code")}</p>
                        <p className="font-semibold text-gray-800 dark:text-gray-200 truncate mt-0.5">
                          {sup.dms_code || "—"}
                        </p>
                      </div>
                      <div className="bg-gray-50 dark:bg-slate-800/60 rounded-lg px-2.5 py-2 min-w-0">
                        <p className="text-gray-400 dark:text-gray-500">{t("supervisors.itop")}</p>
                        <p className="font-semibold text-gray-800 dark:text-gray-200 truncate mt-0.5">
                          {sup.itop_number || "—"}
                        </p>
                      </div>
                      <div className="bg-gray-50 dark:bg-slate-800/60 rounded-lg px-2.5 py-2 min-w-0">
                        <p className="text-gray-400 dark:text-gray-500">{t("supervisors.pool")}</p>
                        <p className="font-semibold text-gray-800 dark:text-gray-200 truncate mt-0.5">
                          {sup.pool_number || "—"}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="px-5 border-t border-gray-50 dark:border-slate-800 flex-1">
                    <div className="pt-3 pb-2 flex items-center justify-between">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                        {t("supervisors.assigned_members")}
                      </p>
                      <span className="text-[11px] font-bold text-gray-400 dark:text-gray-500">
                        {sup.assigned_rsos.length + sup.assigned_bps.length}
                      </span>
                    </div>
                    {sup.assigned_rsos.length + sup.assigned_bps.length === 0 ? (
                      <p className="text-sm text-gray-400 dark:text-gray-500 pb-4">{t("supervisors.no_members")}</p>
                    ) : (
                      <div className="pb-4 space-y-1.5">
                        {[...sup.assigned_rsos, ...sup.assigned_bps].map((member) => {
                          const isBp = member.employee_type === "bp";
                          return (
                            <div
                              key={member.rso_employee_id}
                              className="flex items-center gap-2.5 rounded-xl bg-gray-50 dark:bg-slate-800/60 px-3 py-2 min-w-0"
                            >
                              <div
                                className={cn(
                                  "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0",
                                  isBp
                                    ? "bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400"
                                    : "bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400"
                                )}
                              >
                                {member.name?.charAt(0)?.toUpperCase() || (isBp ? "B" : "R")}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-[12px] font-medium text-gray-800 dark:text-gray-200 truncate">
                                  {member.name}
                                </p>
                                <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate">
                                  {isBp
                                    ? `${member.dms_code ? member.dms_code + " • " : ""}${member.pool_number || member.employee_id || "—"}`
                                    : `${member.dms_code || "—"}${member.itop_number ? ` • ${member.itop_number}` : ""}`}
                                </p>
                              </div>
                              {canAssign && (
                                <button
                                  onClick={() => handleRemove(member)}
                                  disabled={removing === member.rso_employee_id}
                                  title={t("supervisors.remove_btn")}
                                  aria-label={t("supervisors.remove_btn")}
                                  className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors shrink-0 cursor-pointer"
                              >
                                {removing === member.rso_employee_id ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <X className="w-4 h-4" />
                                )}
                              </button>
                            )}
                          </div>
                        );})}
                      </div>
                    )}
                  </div>

                  <div className="p-4 border-t border-gray-50 dark:border-slate-800">
                    <button
                      onClick={() => openAssign(sup)}
                      disabled={!canAssign}
                      className={cn(
                        "w-full flex items-center justify-center gap-2 min-h-[44px] rounded-xl text-sm font-semibold transition-all cursor-pointer",
                        canAssign
                          ? "bg-purple-500 text-white hover:bg-purple-600 shadow-md shadow-purple-500/20"
                          : "bg-gray-100 dark:bg-slate-800 text-gray-400 dark:text-gray-500 cursor-not-allowed"
                      )}
                    >
                      {canAssign ? <UserRoundPlus className="w-4 h-4" /> : <Users className="w-4 h-4" />}
                      {t("supervisors.assign_btn")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Assign Modal */}
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {assignTarget && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                onClick={() => setAssignTarget(null)}
                className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-0 sm:p-6 bg-black/60 backdrop-blur-sm"
              >
                <motion.div
                  onClick={(e) => e.stopPropagation()}
                  initial={{ scale: 0.96, opacity: 0, y: 12 }}
                  animate={{ scale: 1, opacity: 1, y: 0 }}
                  exit={{ scale: 0.96, opacity: 0, y: 12 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  className="w-full sm:max-w-lg bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl shadow-2xl border border-gray-100 dark:border-slate-800 flex flex-col overflow-hidden max-h-[92vh]"
                >
                  <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-gray-100 dark:border-slate-800 shrink-0">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-purple-100 dark:bg-purple-500/20 flex items-center justify-center text-purple-600 dark:text-purple-400 shrink-0">
                        <UserRoundPlus className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <h2 className="text-[15px] font-bold text-gray-900 dark:text-gray-100 truncate">
                          {t("supervisors.assign_modal_title", { name: assignTarget.name })}
                        </h2>
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                          {t("supervisors.assign_modal_subtitle")}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => setAssignTarget(null)}
                      className="w-11 h-11 rounded-xl flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800 transition-all cursor-pointer shrink-0"
                      aria-label={t("common.close")}
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  <div className="px-5 pt-4 pb-3">
                    <div className="grid grid-cols-2 gap-2 mb-3">
                      <button
                        onClick={() => setAssignTab("rso")}
                        className={cn(
                          "py-2.5 rounded-xl text-sm font-semibold transition-colors cursor-pointer",
                          assignTab === "rso"
                            ? "bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400 ring-1 ring-blue-200 dark:ring-blue-500/30"
                            : "bg-gray-50 dark:bg-slate-800 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700/60"
                        )}
                      >
                        {t("supervisors.tab_rsos")} ({unassigned.length})
                      </button>
                      <button
                        onClick={() => setAssignTab("bp")}
                        className={cn(
                          "py-2.5 rounded-xl text-sm font-semibold transition-colors cursor-pointer",
                          assignTab === "bp"
                            ? "bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400 ring-1 ring-amber-200 dark:ring-amber-500/30"
                            : "bg-gray-50 dark:bg-slate-800 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700/60"
                        )}
                      >
                        {t("supervisors.tab_bps")} ({unassignedBps.length})
                      </button>
                    </div>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        value={assignSearch}
                        onChange={(e) => setAssignSearch(e.target.value)}
                        placeholder={t("supervisors.assign_modal_search")}
                        className="w-full pl-9 pr-3 py-2.5 bg-gray-50 dark:bg-slate-800 border-none rounded-xl text-sm outline-none focus:ring-2 focus:ring-purple-500"
                      />
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto px-2.5 pb-2 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gray-300 dark:[&::-webkit-scrollbar-thumb]:bg-slate-600 [&::-webkit-scrollbar-thumb]:rounded-full">
                    {filteredUnassigned.length === 0 ? (
                      <div className="py-12 text-center">
                        <UserRoundPlus className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                        <p className="text-sm text-gray-400">
                          {assignTab === "bp"
                            ? t("supervisors.assign_modal_no_unassigned_bp")
                            : t("supervisors.assign_modal_no_unassigned")}
                        </p>
                      </div>
                    ) : (
                      filteredUnassigned.map((member) => {
                        const isBp = assignTab === "bp";
                        const isSelected = isBp
                          ? selectedBpIds.has(member.rso_employee_id)
                          : selectedRsoIds.has(member.rso_employee_id);
                        return (
                          <button
                            key={member.rso_employee_id}
                            onClick={() => toggleMember(member.rso_employee_id, assignTab)}
                            className={cn(
                              "w-full flex items-center gap-3 px-3 py-3 rounded-xl text-left hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer",
                              isSelected && "bg-purple-50 dark:bg-purple-500/10"
                            )}
                          >
                            <div
                              className={cn(
                                "w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0",
                                isSelected
                                  ? "border-purple-500 bg-purple-500"
                                  : "border-gray-300 dark:border-slate-600"
                              )}
                            >
                              {isSelected && <Check className="w-3 h-3 text-white" />}
                            </div>
                            <div
                              className={cn(
                                "w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
                                isBp
                                  ? "bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400"
                                  : "bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400"
                              )}
                            >
                              {member.name?.charAt(0)?.toUpperCase() || (isBp ? "B" : "R")}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                                {member.name}
                              </p>
                              <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                                {isBp
                                  ? `${member.dms_code || member.employee_id || "—"}${member.pool_number ? ` • ${member.pool_number}` : ""}`
                                  : `${member.dms_code || "—"}${member.itop_number ? ` • ${member.itop_number}` : ""}`}
                              </p>
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>

                  <div className="px-5 py-4 border-t border-gray-100 dark:border-slate-800 shrink-0">
                    <button
                      onClick={submitAssign}
                      disabled={selectedCount === 0 || assigning}
                      className={cn(
                        "w-full min-h-[46px] rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all cursor-pointer",
                        selectedCount > 0 && !assigning
                          ? "bg-purple-500 text-white hover:bg-purple-600 shadow-md shadow-purple-500/20"
                          : "bg-gray-100 dark:bg-slate-800 text-gray-400 dark:text-gray-500 cursor-not-allowed"
                      )}
                    >
                      {assigning ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          {t("supervisors.assign_modal_assigning")}
                        </>
                      ) : (
                        <>
                          <UserRoundPlus className="w-4 h-4" />
                          {t("supervisors.assign_modal_assign", { count: selectedCount })}
                        </>
                      )}
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </div>
  );
}