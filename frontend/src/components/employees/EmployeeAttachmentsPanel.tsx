"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Camera,
  Check,
  Download,
  Eye,
  FileArchive,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import apiClient, { resolveImageUrl } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "react-hot-toast";
import { useLanguage } from "@/i18n/useLanguage";

/** A file parked in backend staging, waiting to be linked on Save. */
export interface StagedAttachment {
  staged_id: string;
  kind: "photo" | "document";
  doc_type?: string;
  title?: string;
  original_name: string;
  size: number;
  is_image: boolean;
  mime_type?: string;
  /** Local object URL used only for the in-modal thumbnail (never sent). */
  local_url?: string;
}

/** A document already persisted against the employee. */
export interface ExistingDocument {
  id: number;
  doc_type: string;
  title: string | null;
  file_name: string;
  file_size: number;
  mime_type: string | null;
  is_image: boolean;
  uploaded_by_name?: string | null;
  created_at?: string | null;
  file_url: string;
}

/** What the parent form must merge into its create/update payload. */
export interface AttachmentPayload {
  attachments: { staged_id: string; kind: "photo" | "document"; doc_type?: string; title?: string }[];
  remove_document_ids: number[];
  remove_photo: boolean;
}

export const EMPTY_ATTACHMENT_PAYLOAD: AttachmentPayload = {
  attachments: [],
  remove_document_ids: [],
  remove_photo: false,
};

export const EMPLOYEE_DOCUMENT_TYPES = [
  "nid_front",
  "nid_back",
  "education_certificate",
  "experience_certificate",
  "driving_license",
  "bank_document",
  "appointment_letter",
  "medical_certificate",
  "other",
] as const;

const PHOTO_MIME = ["image/jpeg", "image/png", "image/webp"];
const PHOTO_EXT = [".jpg", ".jpeg", ".png", ".webp"];
const DOC_EXT = [".pdf", ".jpg", ".jpeg", ".png", ".webp", ".doc", ".docx", ".xls", ".xlsx"];
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const DOC_MAX_BYTES = 10 * 1024 * 1024;
const MAX_DOCUMENTS = 20;

const PHOTO_ACCEPT = "image/jpeg,image/png,image/webp";
const DOC_ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx";

interface Props {
  employeeId?: number | null;
  initialPhotoUrl?: string | null;
  mode?: "edit" | "view";
  canView?: boolean;
  canUpload?: boolean;
  canDelete?: boolean;
  onChange?: (payload: AttachmentPayload) => void;
}

function formatBytes(bytes: number | null | undefined): string {
  const value = bytes ?? 0;
  if (value <= 0) return "0 KB";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

function documentIcon(docType: string, isImage: boolean) {
  if (isImage) return ImageIcon;
  if (docType === "bank_document") return FileSpreadsheet;
  return FileText;
}

export default function EmployeeAttachmentsPanel({
  employeeId,
  initialPhotoUrl,
  mode = "edit",
  canView = true,
  canUpload = true,
  canDelete = true,
  onChange,
}: Props) {
  const { t } = useLanguage();
  const isView = mode === "view";

  const [photoStaged, setPhotoStaged] = useState<StagedAttachment | null>(null);
  const [storedPhotoUrl, setStoredPhotoUrl] = useState<string | null>(initialPhotoUrl || null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [documents, setDocuments] = useState<StagedAttachment[]>([]);
  const [existingDocs, setExistingDocs] = useState<ExistingDocument[]>([]);
  const [removedIds, setRemovedIds] = useState<number[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [docsBusy, setDocsBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [photoDragging, setPhotoDragging] = useState(false);
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);

  const photoInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const createdUrls = useRef<string[]>([]);
  const photosPreview = photoStaged?.local_url || resolveImageUrl(storedPhotoUrl);

  const trackUrl = (url: string) => {
    createdUrls.current.push(url);
    return url;
  };

  // Load persisted documents once the employee exists (edit/view mode only).
  useEffect(() => {
    if (!employeeId || !canView) return;
    let cancelled = false;
    setLoadingDocs(true);
    apiClient
      .get(`employees/${employeeId}/documents`)
      .then((res) => {
        if (cancelled) return;
        setExistingDocs(res.data?.documents || []);
        if (res.data?.photo_url) setStoredPhotoUrl(res.data.photo_url);
      })
      .catch(() => {
        if (!cancelled) toast.error(t("employees.attachments_load_failed"));
      })
      .finally(() => {
        if (!cancelled) setLoadingDocs(false);
      });
    return () => {
      cancelled = true;
    };
  }, [employeeId, canView, t]);

  // Propagate the staged state up so the parent can include it on Save.
  useEffect(() => {
    if (isView) return;
    onChange?.({
      attachments: [
        ...(photoStaged
          ? [{ staged_id: photoStaged.staged_id, kind: "photo" as const }]
          : []),
        ...documents.map((d) => ({
          staged_id: d.staged_id,
          kind: "document" as const,
          doc_type: d.doc_type,
          title: d.title,
        })),
      ],
      remove_document_ids: removedIds,
      remove_photo: removePhoto,
    });
  }, [photoStaged, documents, removedIds, removePhoto, isView, onChange]);

  // Release every object URL we created when the panel unmounts.
  useEffect(() => {
    const urls = createdUrls.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const stageFile = async (file: File, kind: "photo" | "document") => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("kind", kind);
    const res = await apiClient.post("employees/documents/stage", formData);
    return res.data as Omit<StagedAttachment, "local_url">;
  };

  const handlePhotoPick = async (file: File | undefined | null) => {
    if (!file) return;
    const ext = extensionOf(file.name);
    if (!PHOTO_MIME.includes(file.type) || !PHOTO_EXT.includes(ext)) {
      toast.error(t("employees.attachments_unsupported_photo"));
      return;
    }
    if (file.size > PHOTO_MAX_BYTES) {
      toast.error(t("employees.attachments_photo_too_large"));
      return;
    }
    setPhotoBusy(true);
    try {
      const staged = await stageFile(file, "photo");
      if (photoStaged?.local_url) URL.revokeObjectURL(photoStaged.local_url);
      setPhotoStaged({ ...staged, kind: "photo", local_url: trackUrl(URL.createObjectURL(file)) });
      setRemovePhoto(false);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || t("employees.attachments_upload_failed"));
    } finally {
      setPhotoBusy(false);
      if (photoInputRef.current) photoInputRef.current.value = "";
    }
  };

  const handleDocsPick = async (fileList: FileList | null) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    const room = MAX_DOCUMENTS - (documents.length + existingDocs.length);
    if (files.length > room) {
      toast.error(t("employees.attachments_too_many"));
      return;
    }
    setDocsBusy(true);
    const accepted: StagedAttachment[] = [];
    for (const file of files) {
      const ext = extensionOf(file.name);
      if (!DOC_EXT.includes(ext)) {
        toast.error(`${file.name}: ${t("employees.attachments_unsupported_document")}`);
        continue;
      }
      if (file.size > DOC_MAX_BYTES) {
        toast.error(`${file.name}: ${t("employees.attachments_document_too_large")}`);
        continue;
      }
      try {
        const staged = await stageFile(file, "document");
        accepted.push({
          ...staged,
          kind: "document",
          doc_type: staged.doc_type || "other",
          title: "",
          local_url: PHOTO_EXT.includes(ext) ? trackUrl(URL.createObjectURL(file)) : undefined,
        });
      } catch (err: any) {
        toast.error(`${file.name}: ${err?.response?.data?.detail || t("employees.attachments_upload_failed")}`);
      }
    }
    if (accepted.length) setDocuments((prev) => [...prev, ...accepted]);
    setDocsBusy(false);
    if (docInputRef.current) docInputRef.current.value = "";
  };

  const updateDocument = (stagedId: string, patch: Partial<StagedAttachment>) => {
    setDocuments((prev) => prev.map((d) => (d.staged_id === stagedId ? { ...d, ...patch } : d)));
  };

  const removeStagedDocument = (stagedId: string) => {
    setDocuments((prev) => {
      const target = prev.find((d) => d.staged_id === stagedId);
      if (target?.local_url) URL.revokeObjectURL(target.local_url);
      return prev.filter((d) => d.staged_id !== stagedId);
    });
  };

  const toggleRemoveExisting = (id: number) => {
    setRemovedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const openExistingPreview = async (doc: ExistingDocument) => {
    if (!doc.is_image) {
      await downloadDocument(doc);
      return;
    }
    try {
      const res = await apiClient.get(`employees/${employeeId}/documents/${doc.id}/file`, {
        responseType: "blob",
      });
      const url = trackUrl(URL.createObjectURL(res.data));
      setPreview({ url, name: doc.file_name });
    } catch {
      toast.error(t("employees.attachments_load_failed"));
    }
  };

  const downloadDocument = async (doc: ExistingDocument) => {
    try {
      const res = await apiClient.get(`employees/${employeeId}/documents/${doc.id}/file`, {
        responseType: "blob",
        params: { download: true },
      });
      const url = URL.createObjectURL(res.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = doc.file_name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t("employees.attachments_load_failed"));
    }
  };

  const closePreview = () => {
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview(null);
  };

  const docTypeLabel = (type: string) => t(`employees.doc_type_${type}`);

  // Nothing to show when the user can neither view nor upload.
  if (isView && !employeeId) return null;
  if (!canView && !canUpload) return null;

  const totalDocs = documents.length + existingDocs.filter((d) => !removedIds.includes(d.id)).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 pb-2 border-b dark:border-slate-800">
        <Paperclip className="w-4 h-4 text-amber-500" />
        <h4 className="text-[11px] font-bold text-gray-900 dark:text-gray-100 uppercase tracking-widest">
          {t("employees.section_attachments")}
        </h4>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* ------------------------------ Profile photo ------------------------------ */}
        <div
          className={cn(
            "lg:col-span-1 rounded-2xl border border-gray-200 dark:border-slate-800 bg-gray-50/60 dark:bg-slate-800/40 p-4 transition-all",
            photoDragging && "ring-2 ring-primary-400 border-primary-300 dark:border-primary-500/40"
          )}
          onDragOver={(e) => {
            e.preventDefault();
            if (!isView && canUpload) setPhotoDragging(true);
          }}
          onDragLeave={() => setPhotoDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setPhotoDragging(false);
            if (!isView && canUpload) handlePhotoPick(e.dataTransfer.files?.[0]);
          }}
        >
          <p className="text-[11px] font-bold text-gray-500 uppercase mb-3">{t("employees.attachments_photo_label")}</p>
          <div className="flex items-center gap-4">
            <div
              className={cn(
                "relative w-20 h-20 sm:w-24 sm:h-24 rounded-2xl overflow-hidden shrink-0 flex items-center justify-center border",
                "bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-700"
              )}
            >
              {photoBusy ? (
                <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
              ) : photosPreview && !removePhoto ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photosPreview} alt="" className="w-full h-full object-cover" />
              ) : (
                <Camera className="w-7 h-7 text-gray-300 dark:text-slate-600" />
              )}
              {photoStaged && !photoBusy && (
                <span className="absolute bottom-0 inset-x-0 text-center text-[9px] font-bold uppercase tracking-wide bg-blue-600/90 text-white py-0.5">
                  {t("employees.attachments_new")}
                </span>
              )}
            </div>

            <div className="flex-1 min-w-0 space-y-2">
              <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-snug">{t("employees.attachments_photo_hint")}</p>
              {!isView && canUpload && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => photoInputRef.current?.click()}
                    disabled={photoBusy}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary-600 text-white text-xs font-bold hover:bg-primary-700 transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                  >
                    {photoBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    {photosPreview ? t("employees.attachments_change_photo") : t("employees.attachments_upload_photo")}
                  </button>
                  {photosPreview && (
                    <button
                      type="button"
                      onClick={() => {
                        if (photoStaged) {
                          if (photoStaged.local_url) URL.revokeObjectURL(photoStaged.local_url);
                          setPhotoStaged(null);
                        } else if (canDelete) {
                          setRemovePhoto((v) => !v);
                        }
                      }}
                      className={cn(
                        "inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all active:scale-95 cursor-pointer border",
                        removePhoto
                          ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/20"
                          : "bg-white dark:bg-slate-900 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800"
                      )}
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      {removePhoto ? t("employees.attachments_undo") : t("employees.attachments_remove_photo")}
                    </button>
                  )}
                </div>
              )}
              {removePhoto && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-start gap-1">
                  <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
                  {t("employees.attachments_remove_photo_note")}
                </p>
              )}
            </div>
          </div>
          <input
            ref={photoInputRef}
            type="file"
            accept={PHOTO_ACCEPT}
            className="hidden"
            onChange={(e) => handlePhotoPick(e.target.files?.[0])}
          />
        </div>

        {/* ------------------------------- Documents -------------------------------- */}
        <div className="lg:col-span-2 rounded-2xl border border-gray-200 dark:border-slate-800 bg-gray-50/60 dark:bg-slate-800/40 p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold text-gray-500 uppercase">
                {t("employees.attachments_docs_label")}
                {totalDocs > 0 && <span className="ml-1.5 text-gray-400 font-mono">({totalDocs})</span>}
              </p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{t("employees.attachments_docs_hint")}</p>
            </div>
            {!isView && canUpload && (
              <button
                type="button"
                onClick={() => docInputRef.current?.click()}
                disabled={docsBusy}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white dark:bg-slate-900 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-slate-700 text-xs font-bold hover:bg-gray-50 dark:hover:bg-slate-800 transition-all active:scale-95 disabled:opacity-50 shrink-0 cursor-pointer"
              >
                {docsBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5 text-primary-500" />}
                {docsBusy ? t("employees.attachments_uploading") : t("employees.attachments_add_document")}
              </button>
            )}
          </div>
          <input
            ref={docInputRef}
            type="file"
            multiple
            accept={DOC_ACCEPT}
            className="hidden"
            onChange={(e) => handleDocsPick(e.target.files)}
          />

          {!isView && canUpload && (
            <button
              type="button"
              onClick={() => docInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                handleDocsPick(e.dataTransfer.files);
              }}
              className={cn(
                "w-full rounded-xl border-2 border-dashed px-3 py-3 text-xs font-semibold transition-colors cursor-pointer",
                dragging
                  ? "border-primary-400 bg-primary-50 dark:bg-primary-500/10 text-primary-600 dark:text-primary-300"
                  : "border-gray-200 dark:border-slate-700 text-gray-400 dark:text-gray-500 hover:border-primary-300 hover:text-primary-500"
              )}
            >
              <Paperclip className="w-4 h-4 inline-block mr-1.5 -mt-0.5" />
              {t("employees.attachments_drop_hint")}
            </button>
          )}

          {/* Loading skeleton */}
          {loadingDocs && (
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3 rounded-xl border border-gray-100 dark:border-slate-800 p-3 animate-pulse">
                  <div className="w-10 h-10 rounded-lg bg-gray-200 dark:bg-slate-700 shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-40 bg-gray-200 dark:bg-slate-700 rounded-md" />
                    <div className="h-2.5 w-24 bg-gray-100 dark:bg-slate-800 rounded-md" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Document list */}
          {!loadingDocs && documents.length === 0 && existingDocs.length === 0 && (
            <div className="rounded-xl border border-dashed border-gray-200 dark:border-slate-700 px-3 py-6 text-center">
              <FileArchive className="w-6 h-6 mx-auto text-gray-300 dark:text-slate-600 mb-1.5" />
              <p className="text-xs text-gray-400 dark:text-gray-500">{t("employees.attachments_no_documents")}</p>
            </div>
          )}

          <div className="space-y-2">
            {/* Newly staged documents */}
            {documents.map((doc) => {
              const Icon = documentIcon(doc.doc_type || "other", doc.is_image);
              return (
                <div
                  key={doc.staged_id}
                  className="flex flex-wrap sm:flex-nowrap items-center gap-3 rounded-xl border border-blue-200 dark:border-blue-500/30 bg-blue-50/50 dark:bg-blue-500/5 p-3"
                >
                  <div className="w-10 h-10 rounded-lg bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 flex items-center justify-center overflow-hidden shrink-0">
                    {doc.local_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={doc.local_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <Icon className="w-5 h-5 text-blue-500" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-gray-800 dark:text-gray-100 truncate">{doc.original_name}</p>
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      <select
                        value={doc.doc_type}
                        onChange={(e) => updateDocument(doc.staged_id, { doc_type: e.target.value })}
                        className="p-1.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-[11px] dark:text-gray-100 outline-none focus:ring-1 focus:ring-primary-500 cursor-pointer"
                      >
                        {EMPLOYEE_DOCUMENT_TYPES.map((dt) => (
                          <option key={dt} value={dt}>
                            {docTypeLabel(dt)}
                          </option>
                        ))}
                      </select>
                      <input
                        value={doc.title || ""}
                        onChange={(e) => updateDocument(doc.staged_id, { title: e.target.value })}
                        placeholder={t("employees.attachments_doc_title_placeholder")}
                        className="flex-1 min-w-[120px] p-1.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg text-[11px] dark:text-gray-100 outline-none focus:ring-1 focus:ring-primary-500"
                      />
                      <span className="text-[10px] text-gray-400">{formatBytes(doc.size)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-md bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300 whitespace-nowrap">
                      {t("employees.attachments_new")}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeStagedDocument(doc.staged_id)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all cursor-pointer"
                      title={t("employees.attachments_remove")}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}

            {/* Persisted documents */}
            {existingDocs.map((doc) => {
              const Icon = documentIcon(doc.doc_type, doc.is_image);
              const marked = removedIds.includes(doc.id);
              return (
                <div
                  key={doc.id}
                  className={cn(
                    "flex flex-wrap sm:flex-nowrap items-center gap-3 rounded-xl border p-3 transition-colors",
                    marked
                      ? "border-red-200 dark:border-red-500/30 bg-red-50/60 dark:bg-red-500/5 opacity-70"
                      : "border-gray-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/40"
                  )}
                >
                  <div className="w-10 h-10 rounded-lg bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 flex items-center justify-center shrink-0">
                    <Icon className="w-5 h-5 text-gray-400 dark:text-gray-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={cn("text-xs font-bold truncate", marked ? "text-red-500 line-through" : "text-gray-800 dark:text-gray-100")}>
                      {doc.title || doc.file_name}
                    </p>
                    <p className="text-[10px] text-gray-400 truncate">
                      {docTypeLabel(doc.doc_type)} · {formatBytes(doc.file_size)}
                      {doc.uploaded_by_name ? ` · ${t("employees.attachments_uploaded_by", { name: doc.uploaded_by_name })}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 ml-auto">
                    {marked ? (
                      <span className="text-[10px] font-bold uppercase text-red-500 px-1.5 py-0.5 rounded-md bg-red-100 dark:bg-red-500/20 whitespace-nowrap">
                        {t("employees.attachments_will_remove")}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => openExistingPreview(doc)}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-all cursor-pointer"
                        title={t("employees.attachments_preview")}
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => downloadDocument(doc)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-500/10 transition-all cursor-pointer"
                      title={t("employees.attachments_download")}
                    >
                      <Download className="w-4 h-4" />
                    </button>
                    {!isView && canDelete && (
                      <button
                        type="button"
                        onClick={() => toggleRemoveExisting(doc.id)}
                        className={cn(
                          "p-1.5 rounded-lg transition-all cursor-pointer",
                          marked
                            ? "text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-500/10"
                            : "text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"
                        )}
                        title={marked ? t("employees.attachments_undo") : t("employees.attachments_remove")}
                      >
                        {marked ? <RotateCcw className="w-4 h-4" /> : <Trash2 className="w-4 h-4" />}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Image preview overlay */}
      {preview && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={closePreview}
        >
          <div className="relative max-w-3xl w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 mb-2">
              <p className="text-sm font-semibold text-white truncate">{preview.name}</p>
              <button
                type="button"
                onClick={closePreview}
                className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-all cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview.url} alt={preview.name} className="w-full max-h-[75vh] object-contain rounded-2xl bg-white dark:bg-slate-900" />
          </div>
        </div>
      )}

      {/* Inline confirmation that staged files are not saved yet */}
      {!isView && (documents.length > 0 || photoStaged) && (
        <p className="text-[11px] text-blue-600 dark:text-blue-400 flex items-center gap-1">
          <Check className="w-3 h-3" />
          {t("employees.attachments_pending_hint")}
        </p>
      )}
    </div>
  );
}
