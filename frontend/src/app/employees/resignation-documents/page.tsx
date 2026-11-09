"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import apiClient from "@/lib/api";
import { toast } from "react-hot-toast";
import { ArrowLeft, FileText, CheckCircle2, AlertCircle, HelpCircle } from "lucide-react";
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
    return (
      <div className="max-w-xl mx-auto text-center py-16">
        <div className="flex items-center justify-center gap-2.5 mb-3">
          <FileText className="w-6 h-6 text-primary-500" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {t("resignation_docs.page_title")}
          </h1>
          <PageGuideModal pageKey="resignation_docs" />
        </div>
        <p className="text-gray-700 dark:text-gray-300 font-medium">
          {t("resignation_docs.no_employee_title")}
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
          {t("resignation_docs.no_employee_desc")}
        </p>
        <Link
          href="/employees"
          className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary-500 text-white font-medium hover:bg-primary-600 transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          {t("resignation_docs.open_employees")}
        </Link>
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