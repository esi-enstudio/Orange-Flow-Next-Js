"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  Upload,
  X,
  HelpCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import apiClient from "@/lib/api";
import { toast } from "react-hot-toast";
import PageGuideModal from "@/components/PageGuideModal";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  employeeId: number;
  employeeName: string;
  employeeType: string;
  employeeDms: string;
  employeeStatus: string;
  employeeHouseId: number;
  employeeHouseName: string;
  /** Told after an upload so the parent page can refresh its document cards. */
  onUploaded?: () => void;
}

const ICONS: Record<string, React.ReactNode> = {
  resignation_letter: <FileText className="w-5 h-5" />,
  nid: <FileText className="w-5 h-5" />,
  letterhead: <HelpCircle className="w-5 h-5" />,
};

export default function ResignationDocumentsModal({
  isOpen,
  onClose,
  employeeId,
  employeeName,
  employeeType,
  employeeDms,
  employeeStatus,
  employeeHouseId,
  employeeHouseName,
  onUploaded,
}: Props) {
  const { t } = useLanguage();
  const { hasPermission } = useAuth();
  const canUpload = hasPermission("employees.resignation_upload");
  const canGenerate = hasPermission("employees.resignation_generate");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [data, setData] = useState<{
    employee: any;
    resignation_letter: any;
    nid: any;
    letterhead: any;
    missing: string[];
    can_generate: boolean;
  } | null>(null);
  const [letterFile, setLetterFile] = useState<File | null>(null);
  const [nidFile, setNidFile] = useState<File | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get(`employees/${employeeId}/resignation-documents`);
      setData(res.data);
    } catch (err: any) {
      toast.error(err.response?.data?.detail || t("common.action_failed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) fetchData();
  }, [isOpen, employeeId]);

  const uploadLetter = async () => {
    if (!letterFile) return;
    const form = new FormData();
    form.append("kind", "resignation_letter");
    form.append("file", letterFile);
    try {
      await apiClient.post(`employees/${employeeId}/resignation-documents`, form);
      toast.success(t("resignation_docs.generate_success"));
      setLetterFile(null);
      fetchData();
      onUploaded?.();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || t("resignation_docs.generate_failed"));
    }
  };

  const uploadNid = async () => {
    if (!nidFile) return;
    const form = new FormData();
    form.append("kind", "nid");
    form.append("file", nidFile);
    try {
      await apiClient.post(`employees/${employeeId}/resignation-documents`, form);
      toast.success(t("resignation_docs.generate_success"));
      setNidFile(null);
      fetchData();
      onUploaded?.();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || t("resignation_docs.generate_failed"));
    }
  };

  const generatePdf = async () => {
    setGenerating(true);
    try {
      const res = await apiClient.post(
        `employees/${employeeId}/resignation-package`,
        {},
        { responseType: "blob" }
      );
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `Resignation_${employeeDms || employeeId}.pdf`);
      document.body.appendChild(link);
      link.click();
      toast.success(t("resignation_docs.generate_success"));
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      if (detail?.code) {
        toast.error(t(`resignation_docs.${detail.code.toLowerCase()}`) || detail.message);
      } else {
        toast.error(t("resignation_docs.generate_failed"));
      }
    } finally {
      setGenerating(false);
    }
  };

  if (!isOpen) return null;

  const missingLabels: Record<string, string> = {
    resignation_letter: t("resignation_docs.resignation_letter"),
    nid: t("resignation_docs.nid"),
    letterhead: t("resignation_docs.letterhead"),
  };

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-labelledby="resignation-modal-title"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="w-full max-w-3xl max-h-[90vh] overflow-auto bg-white dark:bg-slate-900 rounded-2xl shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-6 py-4 border-b dark:border-slate-700">
            <div className="flex items-center gap-2.5">
              <h2 id="resignation-modal-title" className="text-xl font-bold text-gray-900 dark:text-gray-100">
                {t("resignation_docs.title")}
              </h2>
              <PageGuideModal pageKey="resignation_docs" />
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              aria-label={t("common.close")}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
            </div>
          ) : data ? (
            <div className="p-6 space-y-6">
              {/* Employee Info */}
              <div className="bg-gray-50 dark:bg-slate-800 rounded-xl p-4">
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">
                  {t("resignation_docs.employee")}
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div>
                    <p className="text-gray-500 dark:text-gray-400">{t("resignation_docs.employee_name")}</p>
                    <p className="font-medium">{employeeName}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 dark:text-gray-400">{t("resignation_docs.employee_type")}</p>
                    <p className="font-medium uppercase">{employeeType}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 dark:text-gray-400">{t("resignation_docs.employee_dms")}</p>
                    <p className="font-medium">{employeeDms}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 dark:text-gray-400">{t("resignation_docs.employee_status")}</p>
                    <p className="font-medium">{employeeStatus}</p>
                  </div>
                  <div className="md:col-span-2">
                    <p className="text-gray-500 dark:text-gray-400">{t("resignation_docs.employee_house")}</p>
                    <p className="font-medium">{employeeHouseName}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 dark:text-gray-400">{t("resignation_docs.employee_father")}</p>
                    <p className="font-medium">{data.employee?.fathers_name || "-"}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 dark:text-gray-400">{t("resignation_docs.employee_nid")}</p>
                    <p className="font-medium">{data.employee?.nid || "-"}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 dark:text-gray-400">{t("resignation_docs.employee_joining")}</p>
                    <p className="font-medium">{data.employee?.joining_date || "-"}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 dark:text-gray-400">{t("resignation_docs.employee_resigned")}</p>
                    <p className="font-medium">{data.employee?.resigned_date || "-"}</p>
                  </div>
                </div>
              </div>

              {/* Documents Status */}
              <div className="space-y-4">
                <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                  {t("resignation_docs.missing_items")}
                  <span className="ml-2 text-sm font-normal text-gray-500">
                    ({data.missing.length} {data.missing.length === 1 ? "item" : "items"})
                  </span>
                </h3>

                <div className="grid gap-3 md:grid-cols-3">
                  {/* Resignation Letter */}
                  <div className={cn(
                    "p-4 rounded-xl border transition-all",
                    data.resignation_letter
                      ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
                      : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
                  )}>
                    <div className="flex items-start gap-3">
                      <div className={cn(
                        "p-2 rounded-lg",
                        data.resignation_letter
                          ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400"
                          : "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"
                      )}>
                        {ICONS.resignation_letter}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 dark:text-gray-100">
                          {t("resignation_docs.resignation_letter")}
                        </p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          {data.resignation_letter
                            ? t("resignation_docs.letter_uploaded")
                            : t("resignation_docs.letter_not_uploaded")}
                        </p>
                        {data.resignation_letter && (
                          <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
                            {data.resignation_letter.file_name}
                          </p>
                        )}
                      </div>
                    </div>
                    {!data.resignation_letter && canUpload && (
                      <div className="mt-3 space-y-2">
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          onChange={(e) => setLetterFile(e.target.files?.[0] || null)}
                          className="w-full text-sm text-gray-600 dark:text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-medium file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100 cursor-pointer"
                        />
                        <button
                          onClick={uploadLetter}
                          disabled={!letterFile || loading}
                          className="w-full py-2 px-3 rounded-xl bg-primary-500 text-white text-sm font-medium hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
                        >
                          <Upload className="w-4 h-4 inline mr-1" />
                          {t("resignation_docs.upload_letter")}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* NID */}
                  <div className={cn(
                    "p-4 rounded-xl border transition-all",
                    data.nid
                      ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
                      : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
                  )}>
                    <div className="flex items-start gap-3">
                      <div className={cn(
                        "p-2 rounded-lg",
                        data.nid
                          ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400"
                          : "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"
                      )}>
                        {ICONS.nid}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 dark:text-gray-100">
                          {t("resignation_docs.nid")}
                        </p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          {data.nid
                            ? t("resignation_docs.nid_uploaded")
                            : t("resignation_docs.nid_not_uploaded")}
                        </p>
                        {data.nid && (
                          <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
                            {data.nid.file_name}
                            {data.nid.source && ` (${data.nid.source})`}
                          </p>
                        )}
                      </div>
                    </div>
                    {!data.nid && canUpload && (
                      <div className="mt-3 space-y-2">
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          onChange={(e) => setNidFile(e.target.files?.[0] || null)}
                          className="w-full text-sm text-gray-600 dark:text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-medium file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100 cursor-pointer"
                        />
                        <button
                          onClick={uploadNid}
                          disabled={!nidFile || loading}
                          className="w-full py-2 px-3 rounded-xl bg-primary-500 text-white text-sm font-medium hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
                        >
                          <Upload className="w-4 h-4 inline mr-1" />
                          {t("resignation_docs.upload_nid")}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Letterhead */}
                  <div className={cn(
                    "p-4 rounded-xl border transition-all",
                    data.letterhead?.configured
                      ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
                      : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
                  )}>
                    <div className="flex items-start gap-3">
                      <div className={cn(
                        "p-2 rounded-lg",
                        data.letterhead?.configured
                          ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400"
                          : "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"
                      )}>
                        {ICONS.letterhead}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 dark:text-gray-100">
                          {t("resignation_docs.letterhead")}
                        </p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          {data.letterhead?.configured
                            ? t("resignation_docs.letterhead_configured")
                            : t("resignation_docs.letterhead_not_configured")}
                        </p>
                        {data.letterhead && (
                          <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
                            {data.letterhead.house_name}
                          </p>
                        )}
                      </div>
                    </div>
                    {!data.letterhead?.configured && (
                      <div className="mt-2 space-y-1">
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          {t("resignation_docs.error_letterhead_missing")}
                        </p>
                        {data.letterhead?.house_id && (
                          <Link
                            href={`/houses/letterhead?house_id=${data.letterhead.house_id}`}
                            className="inline-block text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline"
                          >
                            {t("resignation_docs.configure_letterhead")}
                          </Link>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {data.missing.length > 0 && !canUpload && (
                <p className="text-sm text-amber-600 dark:text-amber-400">
                  {t("resignation_docs.no_upload_permission")}
                </p>
              )}

              {/* Generate Button */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t dark:border-slate-700">
                <button
                  onClick={onClose}
                  className="px-5 py-2.5 rounded-xl border bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700 font-medium cursor-pointer transition-colors"
                >
                  {t("common.close")}
                </button>
                <button
                  onClick={generatePdf}
                  disabled={!data.can_generate || generating || !canGenerate}
                  className={cn(
                    "px-6 py-2.5 rounded-xl font-medium cursor-pointer transition-colors flex items-center gap-2",
                    generating
                      ? "bg-primary-500 text-white opacity-75"
                      : data.can_generate
                      ? "bg-primary-500 text-white hover:bg-primary-600"
                      : "bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed"
                  )}>
                  {generating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {t("resignation_docs.generating")}
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4" />
                      {t("resignation_docs.generate_pdf")}
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center py-12 text-gray-500">
              {t("common.failed_to_load")}
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}