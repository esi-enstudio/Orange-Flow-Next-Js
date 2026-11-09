"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import apiClient from "@/lib/api";
import { toast } from "react-hot-toast";
import { ArrowLeft, FileText, CheckCircle2, AlertCircle, HelpCircle, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { AccessDenied } from "@/components/ui/AccessDenied";
import PageGuideModal from "@/components/PageGuideModal";
import ResignationDocumentsModal from "@/components/employees/ResignationDocumentsModal";

export default function ResignationDocumentsPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { hasPermission, user } = useAuth();

  const empId = Number(searchParams.get("emp_id"));
  const hasEmpId = Number.isFinite(empId) && empId > 0;
  const [loading, setLoading] = useState(hasEmpId);
  const [data, setData] = useState<any>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalEmp, setModalEmp] = useState<any>(null);

  // Employee picker (shown when no emp_id is in the URL, e.g. from the sidebar)
  const [overview, setOverview] = useState<{ data: any[]; pagination: any } | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const fetchData = async () => {
    if (!hasEmpId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await apiClient.get(`employees/${empId}/resignation-documents`);
      setData(res.data);
    } catch (err: any) {
      toast.error(err.response?.data?.detail || t("common.action_failed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empId]);

  const fetchOverview = async (pageNo: number, keyword: string) => {
    setOverviewLoading(true);
    setOverviewError(false);
    try {
      const res = await apiClient.get("employees/resignation-overview", {
        params: { page: pageNo, per_page: 20, search: keyword || undefined },
      });
      setOverview(res.data);
    } catch {
      setOverviewError(true);
    } finally {
      setOverviewLoading(false);
    }
  };

  useEffect(() => {
    if (hasEmpId) return;
    const timer = setTimeout(() => fetchOverview(page, search), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasEmpId, page, search]);

  if (!hasPermission("employees.resignation_view")) {
    return <AccessDenied />;
  }

  const openModal = (emp: any) => {
    setModalEmp(emp);
    setModalOpen(true);
  };

  if (loading) {
    // Content-aware skeleton: mirrors the header, the employee card and the
    // three document cards so the layout does not jump when the data arrives.
    return (
      <div className="space-y-6 animate-pulse">
        <div className="flex items-center justify-between">
          <div className="h-7 w-56 rounded-lg bg-gray-200 dark:bg-slate-700" />
          <div className="h-10 w-24 rounded-xl bg-gray-200 dark:bg-slate-700" />
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 p-6">
          <div className="space-y-2">
            <div className="h-4 w-48 rounded-md bg-gray-200 dark:bg-slate-700" />
            <div className="h-3 w-64 rounded-md bg-gray-100 dark:bg-slate-800" />
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="p-6 rounded-2xl border border-gray-200 dark:border-slate-700"
            >
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-gray-200 dark:bg-slate-700 shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-32 rounded-md bg-gray-200 dark:bg-slate-700" />
                  <div className="h-3 w-24 rounded-md bg-gray-100 dark:bg-slate-800" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!hasEmpId) {
    const rows = overview?.data ?? [];
    const meta = overview?.pagination;
    const missingLabel: Record<string, string> = {
      resignation_letter: t("resignation_docs.letter_chip"),
      nid: t("resignation_docs.nid_chip"),
      letterhead: t("resignation_docs.letterhead_chip"),
    };
    const openEmployee = (id: number) =>
      router.push(`/employees/resignation-documents?emp_id=${id}`);

    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <FileText className="w-6 h-6 text-primary-500" />
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {t("resignation_docs.page_title")}
            </h1>
            <PageGuideModal pageKey="resignation_docs" />
          </div>
          <Link
            href="/employees"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700 font-medium text-sm cursor-pointer transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            {t("resignation_docs.open_employees")}
          </Link>
        </div>

        {/* Search */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 p-4 sm:p-6">
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            {t("resignation_docs.list_subtitle")}
          </p>
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder={t("resignation_docs.search_placeholder")}
              className="w-full pl-10 pr-3 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 text-sm text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
        </div>

        {overviewLoading ? (
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 divide-y divide-gray-50 dark:divide-slate-800">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 sm:px-6 py-5 animate-pulse">
                <div className="w-10 h-10 rounded-xl bg-gray-200 dark:bg-slate-700 shrink-0" />
                <div className="space-y-2 flex-1">
                  <div className="h-3 w-32 bg-gray-200 dark:bg-slate-700 rounded-md" />
                  <div className="h-2.5 w-24 bg-gray-100 dark:bg-slate-800 rounded-md" />
                </div>
                <div className="hidden sm:block w-28 space-y-2">
                  <div className="h-3 w-20 bg-gray-200 dark:bg-slate-700 rounded-md" />
                  <div className="h-2.5 w-16 bg-gray-100 dark:bg-slate-800 rounded-md" />
                </div>
              </div>
            ))}
          </div>
        ) : overviewError ? (
          <div className="text-center py-12 bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700">
            <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t("resignation_docs.overview_failed")}
            </p>
            <button
              onClick={() => fetchOverview(page, search)}
              className="mt-4 px-4 py-2 rounded-xl bg-primary-500 text-white text-sm font-medium cursor-pointer hover:bg-primary-600 transition-colors"
            >
              {t("common.refresh")}
            </button>
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-16 bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700">
            <FileText className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
            <p className="text-gray-700 dark:text-gray-200 font-medium">
              {t("resignation_docs.no_resigned_title")}
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 max-w-md mx-auto">
              {t("resignation_docs.no_resigned_desc")}
            </p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden lg:block bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-slate-800/60 border-b border-gray-200 dark:border-slate-700">
                    <th className="px-2 py-2 text-left text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t("resignation_docs.employee")}</th>
                    <th className="px-2 py-2 text-left text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t("resignation_docs.employee_type")}</th>
                    <th className="px-2 py-2 text-left text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t("resignation_docs.employee_house")}</th>
                    <th className="px-2 py-2 text-left text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t("resignation_docs.employee_resigned")}</th>
                    <th className="px-2 py-2 text-left text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t("resignation_docs.docs_status")}</th>
                    <th className="px-2 py-2 text-right text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t("common.action")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                  {rows.map((emp: any) => (
                    <tr key={emp.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                      <td className="px-2 py-1">
                        <p className="font-medium text-gray-900 dark:text-gray-100">{emp.employee_name || "-"}</p>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400">{emp.dms_code || "-"}</p>
                      </td>
                      <td className="px-2 py-1 uppercase text-xs text-gray-600 dark:text-gray-300">{emp.employee_type || "-"}</td>
                      <td className="px-2 py-1 text-xs text-gray-600 dark:text-gray-300">{emp.house_name || "-"}</td>
                      <td className="px-2 py-1 text-xs text-gray-600 dark:text-gray-300">{emp.resigned_date || "-"}</td>
                      <td className="px-2 py-1">
                        {emp.ready ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-green-50 dark:bg-green-900/30 text-[11px] font-medium text-green-700 dark:text-green-300">
                            <CheckCircle2 className="w-3.5 h-3.5" /> {t("resignation_docs.ready_badge")}
                          </span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {emp.missing.map((item: string) => (
                              <span key={item} className="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-900/30 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                                {missingLabel[item] || item}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-1 text-right">
                        <button
                          onClick={() => openEmployee(emp.id)}
                          className="px-3 py-1.5 rounded-lg bg-primary-500 text-white text-xs font-medium hover:bg-primary-600 cursor-pointer transition-colors"
                        >
                          {t("resignation_docs.open_documents")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="lg:hidden space-y-3">
              {rows.map((emp: any) => (
                <button
                  key={emp.id}
                  onClick={() => openEmployee(emp.id)}
                  className="w-full text-left bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 p-4 cursor-pointer hover:border-primary-300 dark:hover:border-primary-700 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900 dark:text-gray-100 truncate">{emp.employee_name || "-"}</p>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400">
                        {emp.dms_code || "-"} · {(emp.employee_type || "-").toUpperCase()}
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
                    <span>{emp.house_name || "-"}</span>
                    {emp.resigned_date && <span>· {emp.resigned_date}</span>}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {emp.ready ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-green-50 dark:bg-green-900/30 text-[11px] font-medium text-green-700 dark:text-green-300">
                        <CheckCircle2 className="w-3.5 h-3.5" /> {t("resignation_docs.ready_badge")}
                      </span>
                    ) : (
                      emp.missing.map((item: string) => (
                        <span key={item} className="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-900/30 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                          {missingLabel[item] || item}
                        </span>
                      ))
                    )}
                  </div>
                </button>
              ))}
            </div>

            {/* Pagination */}
            {meta && meta.total_pages > 1 && (
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {meta.page} / {meta.total_pages} ({meta.total})
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={!meta.has_prev}
                    className="px-3 py-2 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-medium text-gray-700 dark:text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors inline-flex items-center gap-1"
                  >
                    <ChevronLeft className="w-4 h-4" /> {t("common.prev")}
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(meta.total_pages, p + 1))}
                    disabled={!meta.has_next}
                    className="px-3 py-2 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-medium text-gray-700 dark:text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors inline-flex items-center gap-1"
                  >
                    {t("common.next")} <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
        <p className="text-gray-500 dark:text-gray-400">{t("common.not_found")}</p>
        <button
          onClick={() => router.back()}
          className="mt-4 px-4 py-2 rounded-xl bg-primary-500 text-white cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4 inline mr-1" />
          {t("common.back")}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {t("resignation_docs.page_title")}
          </h1>
          <PageGuideModal pageKey="resignation_docs" />
        </div>
        <button
          onClick={() => router.back()}
          className="px-4 py-2 rounded-xl border bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700 font-medium cursor-pointer transition-colors flex items-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          {t("common.back")}
        </button>
      </div>

      {/* Employee Info Card */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {data.employee?.employee_name || t("resignation_docs.employee")}
            </h2>
            <div className="flex flex-wrap gap-3 mt-2 text-sm text-gray-500 dark:text-gray-400">
              <span className="flex items-center gap-1">
                <FileText className="w-4 h-4" />
                {data.employee?.dms_code || "-"}
              </span>
              <span className="flex items-center gap-1">
                <span className="uppercase">{data.employee?.employee_type || "-"}</span>
              </span>
              <span className="flex items-center gap-1">
                {data.employee?.house_name}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ResignationDocumentsModal
              isOpen={modalOpen}
              onClose={() => setModalOpen(false)}
              employeeId={empId}
              employeeName={data.employee?.employee_name || ""}
              employeeType={data.employee?.employee_type || ""}
              employeeDms={data.employee?.dms_code || ""}
              employeeStatus={data.employee?.status || ""}
              employeeHouseId={data.employee?.house_id}
              employeeHouseName={data.employee?.house_name || ""}
            />
          </div>
        </div>
      </div>

      {/* Status Grid */}
      <div className="grid gap-4 md:grid-cols-3">
        {/* Resignation Letter */}
        <div className={cn(
          "p-6 rounded-2xl border transition-all",
          data.resignation_letter
            ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
            : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
        )}>
          <div className="flex items-start gap-4">
            <div className={cn(
              "p-3 rounded-xl",
              data.resignation_letter
                ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400"
                : "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"
            )}>
              <FileText className="w-6 h-6" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                {t("resignation_docs.resignation_letter")}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {data.resignation_letter
                  ? t("resignation_docs.letter_uploaded")
                  : t("resignation_docs.letter_not_uploaded")}
              </p>
              {data.resignation_letter && (
                <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-2">
                  {data.resignation_letter.file_name}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* NID / Voter ID */}
        <div className={cn(
          "p-6 rounded-2xl border transition-all",
          data.nid
            ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
            : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
        )}>
          <div className="flex items-start gap-4">
            <div className={cn(
              "p-3 rounded-xl",
              data.nid
                ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400"
                : "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"
            )}>
              <FileText className="w-6 h-6" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                {t("resignation_docs.nid")}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {data.nid
                  ? t("resignation_docs.nid_uploaded")
                  : t("resignation_docs.nid_not_uploaded")}
              </p>
              {data.nid && (
                <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-2">
                  {data.nid.file_name}
                  {data.nid.source && ` (${data.nid.source})`}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Letterhead */}
        <div className={cn(
          "p-6 rounded-2xl border transition-all",
          data.letterhead?.configured
            ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
            : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
        )}>
          <div className="flex items-start gap-4">
            <div className={cn(
              "p-3 rounded-xl",
              data.letterhead?.configured
                ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400"
                : "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"
            )}>
              <HelpCircle className="w-6 h-6" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                {t("resignation_docs.letterhead")}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {data.letterhead?.configured
                  ? t("resignation_docs.letterhead_configured")
                  : t("resignation_docs.letterhead_not_configured")}
              </p>
              {data.letterhead && (
                <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-2">
                  {data.letterhead.house_name}
                </p>
              )}
              {!data.letterhead?.configured && data.letterhead?.house_id && (
                <Link
                  href={`/houses/letterhead?house_id=${data.letterhead.house_id}`}
                  className="mt-2 inline-block text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline"
                >
                  {t("resignation_docs.configure_letterhead")}
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Missing Items */}
      {data.missing.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-6">
          <h3 className="font-semibold text-amber-800 dark:text-amber-200 flex items-center gap-2">
            <AlertCircle className="w-5 h-5" />
            {t("resignation_docs.missing_items")}
          </h3>
          <ul className="mt-3 space-y-2">
            {data.missing.map((item: string) => (
              <li key={item} className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {t(`resignation_docs.${item === "resignation_letter" ? "resignation_letter" : item === "nid" ? "nid" : "letterhead"}`)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Generate Button */}
      <div className="flex items-center justify-end">
        <button
          onClick={() => openModal(data.employee)}
          disabled={!data.can_generate}
          className={cn(
            "px-6 py-3 rounded-xl font-medium cursor-pointer transition-colors flex items-center gap-2 text-lg",
            data.can_generate
              ? "bg-primary-500 text-white hover:bg-primary-600"
              : "bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed"
          )}>
          <FileText className="w-5 h-5" />
          {t("resignation_docs.generate_pdf")}
        </button>
      </div>

      {/* Info Box */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-2xl p-6">
        <h3 className="font-semibold text-blue-800 dark:text-blue-200 flex items-center gap-2">
          <HelpCircle className="w-5 h-5" />
          {t("resignation_docs.guide.title")}
        </h3>
        <p className="mt-2 text-sm text-blue-700 dark:text-blue-300">
          {t("resignation_docs.guide.overview")}
        </p>
        <details className="mt-4 group">
          <summary className="cursor-pointer font-medium text-blue-700 dark:text-blue-300 flex items-center gap-2">
            <span>{t("common.details")}</span>
            <span className="ml-auto transition-transform group-open:rotate-90">▼</span>
          </summary>
          <div className="mt-3 space-y-3 text-sm text-blue-700 dark:text-blue-300">
            <div>
              <p className="font-medium">{t("resignation_docs.guide.steps_title")}</p>
              <ol className="list-decimal list-inside mt-1 space-y-1">
                {Object.values(data?.guide?.steps || {}).map((s: any, i) => (
                  <li key={i}>{s.title}: {s.desc}</li>
                ))}
              </ol>
            </div>
            <div>
              <p className="font-medium">{t("resignation_docs.guide.notes_title")}</p>
              <ul className="list-disc list-inside mt-1 space-y-1">
                {Object.values(data?.guide?.notes || {}).map((n: any, i) => (
                  <li key={i}>{n.title}: {n.desc}</li>
                ))}
              </ul>
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}