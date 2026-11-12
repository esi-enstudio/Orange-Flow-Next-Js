"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  Download,
  FileText,
  Image as ImageIcon,
  Loader2,
  PenTool,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/i18n/useLanguage";
import { useAuth } from "@/context/AuthContext";
import apiClient from "@/lib/api";
import { toast } from "react-hot-toast";

interface HouseDocument {
  id: number;
  house_id: number;
  doc_type: string;
  title: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  created_at: string | null;
  download_url: string;
}

interface DocumentsData {
  house_id: number;
  house_name: string;
  house_code: string;
  letterhead: { has_image: boolean; image_url: string | null; configured: boolean };
  signature: { has_signature: boolean; signature_url: string | null };
  documents: HouseDocument[];
  document_types: string[];
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  houseId: number;
  houseName: string;
}

const LETTERHEAD_MAX_BYTES = 5 * 1024 * 1024;
const SIGNATURE_MAX_BYTES = 2 * 1024 * 1024;
const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

const inputBase =
  "w-full h-11 rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/60 px-3 " +
  "text-sm text-gray-900 dark:text-gray-100 outline-none transition-all focus:bg-white dark:focus:bg-slate-800 " +
  "focus:ring-2 focus:ring-primary-500";

function detailMessage(err: any, fallback: string): string {
  const detail = err?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object" && typeof detail.message === "string") {
    return detail.message;
  }
  return fallback;
}

function formatSize(bytes: number): string {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string | null, locale: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(locale === "bn" ? "bn-BD" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function HouseDocumentsModal({ isOpen, onClose, houseId, houseName }: Props) {
  const { t, language } = useLanguage();
  const { hasPermission } = useAuth();
  const canUpload = hasPermission("houses.document_upload");
  const canDelete = hasPermission("houses.document_delete");

  const [data, setData] = useState<DocumentsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [letterheadImageUrl, setLetterheadImageUrl] = useState<string | null>(null);
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null);

  const [letterheadFile, setLetterheadFile] = useState<File | null>(null);
  const [signatureFile, setSignatureFile] = useState<File | null>(null);
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docType, setDocType] = useState("trade_license");
  const [docTitle, setDocTitle] = useState("");
  const letterheadInput = useRef<HTMLInputElement>(null);
  const signatureInput = useRef<HTMLInputElement>(null);
  const docInput = useRef<HTMLInputElement>(null);

  const fetchDocuments = useCallback(async () => {
    if (!houseId) return;
    setLoading(true);
    try {
      const res = await apiClient.get(`houses/${houseId}/documents`);
      setData(res.data);
      setDocType((current) =>
        res.data?.document_types?.includes(current) ? current : res.data?.document_types?.[0] ?? "other"
      );
    } catch (err: any) {
      toast.error(detailMessage(err, t("houses.documents.toast_load_failed")));
    } finally {
      setLoading(false);
    }
  }, [houseId, t]);

  useEffect(() => {
    if (isOpen) fetchDocuments();
  }, [isOpen, fetchDocuments]);

  // Private files are streamed through authenticated endpoints, so they are
  // fetched as blobs and rendered from object URLs.
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setLetterheadImageUrl(null);
    if (!isOpen || !data?.letterhead.has_image) return;
    apiClient
      .get(`houses/${houseId}/letterhead/image`, { responseType: "blob" })
      .then((res) => {
        if (cancelled) return;
        objectUrl = window.URL.createObjectURL(new Blob([res.data], { type: "image/jpeg" }));
        setLetterheadImageUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (objectUrl) window.URL.revokeObjectURL(objectUrl);
    };
  }, [isOpen, houseId, data?.letterhead.has_image]);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setSignatureUrl(null);
    if (!isOpen || !data?.signature.has_signature) return;
    apiClient
      .get(`houses/${houseId}/signature`, { responseType: "blob" })
      .then((res) => {
        if (cancelled) return;
        objectUrl = window.URL.createObjectURL(new Blob([res.data], { type: "image/png" }));
        setSignatureUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (objectUrl) window.URL.revokeObjectURL(objectUrl);
    };
  }, [isOpen, houseId, data?.signature.has_signature]);

  const docTypeOptions = useMemo(() => data?.document_types ?? [], [data?.document_types]);

  const handleFile = (
    event: ChangeEvent<HTMLInputElement>,
    maxBytes: number,
    tooLargeKey: string,
    setFile: (file: File | null) => void
  ) => {
    const file = event.target.files?.[0] ?? null;
    if (file && file.size > maxBytes) {
      toast.error(t(tooLargeKey));
      event.target.value = "";
      setFile(null);
      return;
    }
    setFile(file);
  };

  const uploadLetterhead = async () => {
    if (!letterheadFile) return;
    setBusy("letterhead");
    const form = new FormData();
    form.append("file", letterheadFile);
    try {
      await apiClient.post(`houses/${houseId}/letterhead/image`, form);
      setLetterheadFile(null);
      if (letterheadInput.current) letterheadInput.current.value = "";
      toast.success(t("houses.documents.toast_letterhead_saved"));
      await fetchDocuments();
    } catch (err: any) {
      toast.error(detailMessage(err, t("houses.documents.toast_upload_failed")));
    } finally {
      setBusy(null);
    }
  };

  const deleteLetterhead = async () => {
    if (!confirm(t("houses.letterhead.delete_confirm"))) return;
    setBusy("letterhead");
    try {
      await apiClient.delete(`houses/${houseId}/letterhead/image`);
      toast.success(t("houses.documents.toast_letterhead_deleted"));
      await fetchDocuments();
    } catch (err: any) {
      toast.error(detailMessage(err, t("houses.documents.toast_delete_failed")));
    } finally {
      setBusy(null);
    }
  };

  const uploadSignature = async () => {
    if (!signatureFile) return;
    setBusy("signature");
    const form = new FormData();
    form.append("file", signatureFile);
    try {
      await apiClient.post(`houses/${houseId}/signature`, form);
      setSignatureFile(null);
      if (signatureInput.current) signatureInput.current.value = "";
      toast.success(t("houses.documents.toast_signature_saved"));
      await fetchDocuments();
    } catch (err: any) {
      toast.error(detailMessage(err, t("houses.documents.toast_upload_failed")));
    } finally {
      setBusy(null);
    }
  };

  const deleteSignature = async () => {
    if (!confirm(t("houses.documents.signature_delete_confirm"))) return;
    setBusy("signature");
    try {
      await apiClient.delete(`houses/${houseId}/signature`);
      toast.success(t("houses.documents.toast_signature_deleted"));
      await fetchDocuments();
    } catch (err: any) {
      toast.error(detailMessage(err, t("houses.documents.toast_delete_failed")));
    } finally {
      setBusy(null);
    }
  };

  const uploadDocument = async (event: FormEvent) => {
    event.preventDefault();
    if (!docFile) {
      toast.error(t("houses.documents.file_required"));
      return;
    }
    setBusy("document");
    const form = new FormData();
    form.append("file", docFile);
    try {
      await apiClient.post("houses/" + houseId + "/documents", form, {
        params: { doc_type: docType, title: docTitle || undefined },
      });
      setDocFile(null);
      setDocTitle("");
      if (docInput.current) docInput.current.value = "";
      toast.success(t("houses.documents.toast_document_saved"));
      await fetchDocuments();
    } catch (err: any) {
      toast.error(detailMessage(err, t("houses.documents.toast_upload_failed")));
    } finally {
      setBusy(null);
    }
  };

  const downloadDocument = async (doc: HouseDocument) => {
    try {
      const res = await apiClient.get(`houses/${houseId}/documents/${doc.id}/file`, {
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: doc.mime_type || "application/octet-stream" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = doc.file_name || `document-${doc.id}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => window.URL.revokeObjectURL(url), 30_000);
    } catch (err: any) {
      toast.error(detailMessage(err, t("houses.documents.toast_download_failed")));
    }
  };

  const deleteDocument = async (doc: HouseDocument) => {
    if (!confirm(t("houses.documents.delete_confirm", { file: doc.title || doc.file_name }))) return;
    setBusy(`document-${doc.id}`);
    try {
      await apiClient.delete(`houses/${houseId}/documents/${doc.id}`);
      toast.success(t("houses.documents.toast_document_deleted"));
      await fetchDocuments();
    } catch (err: any) {
      toast.error(detailMessage(err, t("houses.documents.toast_delete_failed")));
    } finally {
      setBusy(null);
    }
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-sm p-0 sm:p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 24, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 24, opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", damping: 26, stiffness: 260 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-3xl max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 shadow-2xl"
          >
            <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-gray-100 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur px-5 py-4">
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 truncate">
                  {t("houses.documents.title")}
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                  {houseName} · {t("houses.documents.subtitle")}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-2 rounded-xl text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-800 cursor-pointer shrink-0"
                aria-label={t("common.close")}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {loading && !data ? (
              <div className="p-5 space-y-4 animate-pulse">
                <div className="h-32 rounded-2xl bg-gray-100 dark:bg-slate-800" />
                <div className="h-24 rounded-2xl bg-gray-100 dark:bg-slate-800" />
                <div className="h-40 rounded-2xl bg-gray-100 dark:bg-slate-800" />
              </div>
            ) : (
              <div className="p-5 space-y-5">
                {/* Letterhead page */}
                <section className="rounded-2xl border border-gray-200 dark:border-slate-700 p-4">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <h3 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                      <ImageIcon className="w-4 h-4" />
                      {t("houses.documents.letterhead_title")}
                    </h3>
                    <span
                      className={cn(
                        "px-2.5 py-1 rounded-lg text-[11px] font-bold",
                        data?.letterhead.has_image
                          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                          : "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
                      )}
                    >
                      {data?.letterhead.has_image
                        ? t("houses.letterhead.status_configured")
                        : t("houses.letterhead.status_not_configured")}
                    </span>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-4">
                    <div className="w-full sm:w-32 shrink-0 aspect-[210/297] rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/60 overflow-hidden flex items-center justify-center">
                      {letterheadImageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={letterheadImageUrl} alt="" className="w-full h-full object-cover object-top" />
                      ) : (
                        <ImageIcon className="w-8 h-8 text-gray-300 dark:text-gray-600" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1 space-y-2">
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {t("houses.documents.letterhead_hint")}
                      </p>
                      {canUpload && (
                        <>
                          <input
                            ref={letterheadInput}
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            onChange={(e) =>
                              handleFile(e, LETTERHEAD_MAX_BYTES, "houses.documents.letterhead_too_large", setLetterheadFile)
                            }
                            className="block w-full text-xs text-gray-600 dark:text-gray-300 file:mr-3 file:py-2 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100 cursor-pointer"
                          />
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={uploadLetterhead}
                              disabled={!letterheadFile || busy === "letterhead"}
                              className={cn(
                                "inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-colors",
                                letterheadFile && busy !== "letterhead"
                                  ? "bg-primary-500 text-white hover:bg-primary-600 cursor-pointer"
                                  : "bg-gray-200 dark:bg-slate-700 text-gray-500 dark:text-gray-400 cursor-not-allowed"
                              )}
                            >
                              {busy === "letterhead" ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Upload className="w-3.5 h-3.5" />
                              )}
                              {data?.letterhead.has_image
                                ? t("houses.documents.replace")
                                : t("houses.documents.upload")}
                            </button>
                            {data?.letterhead.has_image && canDelete && (
                              <button
                                type="button"
                                onClick={deleteLetterhead}
                                disabled={busy === "letterhead"}
                                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 disabled:cursor-not-allowed cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                {t("houses.documents.delete")}
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </section>

                {/* Proprietor signature */}
                <section className="rounded-2xl border border-gray-200 dark:border-slate-700 p-4">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <h3 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                      <PenTool className="w-4 h-4" />
                      {t("houses.documents.signature_title")}
                    </h3>
                    <span
                      className={cn(
                        "px-2.5 py-1 rounded-lg text-[11px] font-bold",
                        data?.signature.has_signature
                          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                          : "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
                      )}
                    >
                      {data?.signature.has_signature
                        ? t("houses.documents.signature_uploaded")
                        : t("houses.documents.signature_missing")}
                    </span>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-4">
                    <div className="w-full sm:w-40 shrink-0 h-24 rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/60 overflow-hidden flex items-center justify-center">
                      {signatureUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={signatureUrl} alt="" className="max-w-full max-h-full object-contain" />
                      ) : (
                        <PenTool className="w-7 h-7 text-gray-300 dark:text-gray-600" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1 space-y-2">
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {t("houses.documents.signature_hint")}
                      </p>
                      {canUpload && (
                        <>
                          <input
                            ref={signatureInput}
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            onChange={(e) =>
                              handleFile(e, SIGNATURE_MAX_BYTES, "houses.documents.signature_too_large", setSignatureFile)
                            }
                            className="block w-full text-xs text-gray-600 dark:text-gray-300 file:mr-3 file:py-2 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100 cursor-pointer"
                          />
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={uploadSignature}
                              disabled={!signatureFile || busy === "signature"}
                              className={cn(
                                "inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-colors",
                                signatureFile && busy !== "signature"
                                  ? "bg-primary-500 text-white hover:bg-primary-600 cursor-pointer"
                                  : "bg-gray-200 dark:bg-slate-700 text-gray-500 dark:text-gray-400 cursor-not-allowed"
                              )}
                            >
                              {busy === "signature" ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Upload className="w-3.5 h-3.5" />
                              )}
                              {data?.signature.has_signature
                                ? t("houses.documents.replace")
                                : t("houses.documents.upload")}
                            </button>
                            {data?.signature.has_signature && canDelete && (
                              <button
                                type="button"
                                onClick={deleteSignature}
                                disabled={busy === "signature"}
                                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 disabled:cursor-not-allowed cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                {t("houses.documents.delete")}
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </section>

                {/* Other documents */}
                <section className="rounded-2xl border border-gray-200 dark:border-slate-700 p-4">
                  <h3 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-1">
                    <FileText className="w-4 h-4" />
                    {t("houses.documents.other_title")}
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                    {t("houses.documents.other_hint")}
                  </p>

                  {canUpload && (
                    <form onSubmit={uploadDocument} className="grid gap-3 sm:grid-cols-2 mb-4">
                      <div>
                        <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                          {t("houses.documents.doc_type")}
                        </label>
                        <select
                          value={docType}
                          onChange={(e) => setDocType(e.target.value)}
                          className={cn(inputBase, "cursor-pointer")}
                        >
                          {docTypeOptions.map((type) => (
                            <option key={type} value={type}>
                              {t(`houses.documents.types.${type}`)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                          {t("houses.documents.doc_title")}
                        </label>
                        <input
                          type="text"
                          value={docTitle}
                          maxLength={200}
                          onChange={(e) => setDocTitle(e.target.value)}
                          placeholder={t("houses.documents.doc_title_placeholder")}
                          className={inputBase}
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <input
                          ref={docInput}
                          type="file"
                          accept=".jpg,.jpeg,.png,.webp,.pdf,.doc,.docx,.xls,.xlsx"
                          onChange={(e) =>
                            handleFile(e, DOCUMENT_MAX_BYTES, "houses.documents.file_too_large", setDocFile)
                          }
                          className="block w-full text-xs text-gray-600 dark:text-gray-300 file:mr-3 file:py-2 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100 cursor-pointer"
                        />
                        <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
                          {t("houses.documents.compress_hint")}
                        </p>
                      </div>
                      <div className="sm:col-span-2 flex justify-end">
                        <button
                          type="submit"
                          disabled={!docFile || busy === "document"}
                          className={cn(
                            "inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-colors",
                            docFile && busy !== "document"
                              ? "bg-primary-500 text-white hover:bg-primary-600 cursor-pointer"
                              : "bg-gray-200 dark:bg-slate-700 text-gray-500 dark:text-gray-400 cursor-not-allowed"
                          )}
                        >
                          {busy === "document" ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Upload className="w-3.5 h-3.5" />
                          )}
                          {t("houses.documents.upload")}
                        </button>
                      </div>
                    </form>
                  )}

                  {loading ? (
                    <div className="space-y-2 animate-pulse">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="h-14 rounded-xl bg-gray-100 dark:bg-slate-800" />
                      ))}
                    </div>
                  ) : (data?.documents.length ?? 0) === 0 ? (
                    <p className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                      {t("houses.documents.no_documents")}
                    </p>
                  ) : (
                    <ul className="divide-y divide-gray-100 dark:divide-slate-800">
                      {data!.documents.map((doc) => (
                        <li key={doc.id} className="flex items-center gap-3 py-2.5">
                          <div className="p-2 rounded-xl bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-gray-400 shrink-0">
                            <FileText className="w-4 h-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                              {doc.title || doc.file_name}
                            </p>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                              {t(`houses.documents.types.${doc.doc_type}`)} · {formatSize(doc.file_size)} ·{" "}
                              {formatDate(doc.created_at, language)}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => downloadDocument(doc)}
                              className="p-2 rounded-lg text-gray-400 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-500/10 transition-colors cursor-pointer"
                              title={t("houses.documents.download")}
                              aria-label={t("houses.documents.download")}
                            >
                              <Download className="w-4 h-4" />
                            </button>
                            {canDelete && (
                              <button
                                type="button"
                                onClick={() => deleteDocument(doc)}
                                disabled={busy === `document-${doc.id}`}
                                className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors cursor-pointer disabled:cursor-not-allowed"
                                title={t("houses.documents.delete")}
                                aria-label={t("houses.documents.delete")}
                              >
                                {busy === `document-${doc.id}` ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <Trash2 className="w-4 h-4" />
                                )}
                              </button>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
