"use client";

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import apiClient from "@/lib/api";
import { toast } from "react-hot-toast";
import {
  Loader2,
  ArrowLeft,
  Upload,
  Image as ImageIcon,
  Trash2,
  Save,
  Eye,
  RotateCcw,
  Bold,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AccessDenied } from "@/components/ui/AccessDenied";
import PageGuideModal from "@/components/PageGuideModal";

type Align = "left" | "center" | "right" | "justify";

interface Block {
  x: number;
  y: number;
  w: number;
  size: number;
  align: Align;
  bold: boolean;
}

interface BodyBlock extends Block {
  enabled: boolean;
  text: string;
  line_height: number;
}

interface LetterheadLayout {
  body: BodyBlock;
  fields: Record<string, Block>;
}

interface LetterheadData {
  house_id: number;
  house_name: string;
  house_code: string;
  house_address: string;
  has_image: boolean;
  image_url: string | null;
  layout: LetterheadLayout;
  default_layout: LetterheadLayout;
  body_placeholders?: string[];
  configured: boolean;
}

interface DragState {
  target: string;
  mode: "move" | "resize";
  left: number;
  top: number;
  width: number;
  height: number;
  grabX: number;
  grabY: number;
}

const FIELD_KEYS = [
  "application_date",
  "employee_name",
  "fathers_name",
  "nid",
  "joining_date",
  "resigned_date",
];

const ALIGNMENTS: Align[] = ["left", "center", "right", "justify"];

const SAMPLE_VALUES: Record<string, string> = {
  application_date: "৩০ নভেম্বর ২০২৬",
  employee_name: "মোঃ আব্দুল করিম",
  fathers_name: "মোঃ আব্দুল রহমান",
  nid: "১২৩৪৫৬৭৮৯০১২৩",
  designation: "RSO (Retail Sales Officer)",
  joining_date: "১৫ জানুয়ারি ২০২১",
  resigned_date: "৩০ জুন ২০২৬",
  dms_code: "R123456",
  proprietor_name: "সামছুজ্জামান পাটোয়ারী",
  proprietor_contact: "০১৯১৭৭৪৭৫৫৫",
};

const PLACEHOLDER_KEYS = [
  "application_date",
  "employee_name",
  "fathers_name",
  "nid",
  "designation",
  "joining_date",
  "resigned_date",
  "dms_code",
  "house_name",
  "house_address",
  "house_code",
  "proprietor_name",
  "proprietor_contact",
];

const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** Keep a block on the page and inside the allowed value ranges. */
function clampBlock<T extends Block>(block: T): T {
  const w = Math.min(100, Math.max(5, Number(block.w) || 5));
  return {
    ...block,
    w,
    x: Math.min(Math.max(0, Number(block.x) || 0), 100 - w),
    y: Math.min(100, Math.max(0, Number(block.y) || 0)),
    size: Math.min(30, Math.max(6, Number(block.size) || 12)),
  };
}

function detailMessage(err: any, fallback: string): string {
  const detail = err?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object" && typeof detail.message === "string") {
    return detail.message;
  }
  return fallback;
}

export default function HouseLetterheadPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { hasPermission } = useAuth();

  const houseId = Number(searchParams.get("house_id")) || 0;
  const canView = hasPermission("houses.letterhead_view");
  const canEdit = hasPermission("houses.letterhead_edit");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [data, setData] = useState<LetterheadData | null>(null);
  const [layout, setLayout] = useState<LetterheadLayout | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageVersion, setImageVersion] = useState(0);
  const canvasRef = useRef<HTMLDivElement>(null);
  const bodyTextRef = useRef<HTMLTextAreaElement>(null);

  const fieldLabel = (key: string) => t(`houses.letterhead.field_labels.${key}`);

  const fetchData = async () => {
    if (!houseId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await apiClient.get(`houses/${houseId}/letterhead`);
      setData(res.data);
      setLayout(res.data.layout);
    } catch (err: any) {
      toast.error(detailMessage(err, t("common.action_failed")));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [houseId]);

  // The stream endpoint is permission-guarded, so the image has to be fetched
  // with the auth token and turned into an object URL (a plain <img src> would
  // be rejected with 401).
  useEffect(() => {
    if (!houseId || !data?.has_image) {
      setImageUrl(null);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    apiClient
      .get(`houses/${houseId}/letterhead/image`, { responseType: "blob" })
      .then((res) => {
        if (cancelled) return;
        objectUrl = window.URL.createObjectURL(new Blob([res.data], { type: "image/jpeg" }));
        setImageUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setImageUrl(null);
      });
    return () => {
      cancelled = true;
      if (objectUrl) window.URL.revokeObjectURL(objectUrl);
    };
  }, [houseId, data?.has_image, imageVersion]);

  const updateBlock = (target: string, patch: Partial<BodyBlock>) => {
    setLayout((prev) => {
      if (!prev) return prev;
      if (target === "body") {
        return { ...prev, body: clampBlock({ ...prev.body, ...patch } as BodyBlock) };
      }
      const block = prev.fields[target];
      if (!block) return prev;
      return {
        ...prev,
        fields: { ...prev.fields, [target]: clampBlock({ ...block, ...patch } as Block) },
      };
    });
  };

  const startDrag = (
    e: ReactMouseEvent,
    target: string,
    mode: "move" | "resize"
  ) => {
    if (!canEdit || !layout) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    const block = target === "body" ? layout.body : layout.fields[target];
    if (!rect || !block) return;
    e.preventDefault();
    e.stopPropagation();
    setSelected(target);
    setDrag({
      target,
      mode,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      grabX: ((e.clientX - rect.left) / rect.width) * 100 - block.x,
      grabY: ((e.clientY - rect.top) / rect.height) * 100 - block.y,
    });
  };

  useEffect(() => {
    if (!drag) return;
    const handleMove = (e: MouseEvent) => {
      const pxX = ((e.clientX - drag.left) / drag.width) * 100;
      const pxY = ((e.clientY - drag.top) / drag.height) * 100;
      setLayout((prev) => {
        if (!prev) return prev;
        const isBody = drag.target === "body";
        const block = isBody ? prev.body : prev.fields[drag.target];
        if (!block) return prev;
        const next =
          drag.mode === "move"
            ? { ...block, x: pxX - drag.grabX, y: pxY - drag.grabY }
            : { ...block, w: pxX - block.x };
        const clamped = clampBlock(next as Block);
        return isBody
          ? { ...prev, body: clamped as BodyBlock }
          : { ...prev, fields: { ...prev.fields, [drag.target]: clamped } };
      });
    };
    const handleUp = () => setDrag(null);
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [drag]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (!selected || !canEdit) return;
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
      e.preventDefault();
      const step = e.shiftKey ? 5 : 1;
      setLayout((prev) => {
        if (!prev) return prev;
        const isBody = selected === "body";
        const block = isBody ? prev.body : prev.fields[selected];
        if (!block) return prev;
        const next = {
          ...block,
          x: e.key === "ArrowLeft" ? block.x - step : e.key === "ArrowRight" ? block.x + step : block.x,
          y: e.key === "ArrowUp" ? block.y - step : e.key === "ArrowDown" ? block.y + step : block.y,
        };
        const clamped = clampBlock(next as Block);
        return isBody
          ? { ...prev, body: clamped as BodyBlock }
          : { ...prev, fields: { ...prev.fields, [selected]: clamped } };
      });
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [selected, canEdit]);

  const uploadImage = async () => {
    if (!imageFile) return;
    setImageBusy(true);
    const form = new FormData();
    form.append("file", imageFile);
    try {
      const res = await apiClient.post(`houses/${houseId}/letterhead/image`, form);
      setData(res.data);
      setImageFile(null);
      setImageVersion((v) => v + 1);
      toast.success(t("houses.letterhead.toast_upload_success"));
    } catch (err: any) {
      toast.error(detailMessage(err, t("houses.letterhead.toast_upload_failed")));
    } finally {
      setImageBusy(false);
    }
  };

  const deleteImage = async () => {
    if (!confirm(t("houses.letterhead.delete_confirm"))) return;
    setImageBusy(true);
    try {
      const res = await apiClient.delete(`houses/${houseId}/letterhead/image`);
      setData(res.data);
      toast.success(t("houses.letterhead.toast_delete_success"));
    } catch (err: any) {
      toast.error(detailMessage(err, t("houses.letterhead.toast_delete_failed")));
    } finally {
      setImageBusy(false);
    }
  };

  const handleFileChange = (file: File | null) => {
    if (!file) {
      setImageFile(null);
      return;
    }
    if (file.size > IMAGE_MAX_BYTES) {
      toast.error(t("houses.letterhead.image_too_large"));
      setImageFile(null);
      return;
    }
    setImageFile(file);
  };

  const saveLayout = async () => {
    if (!layout) return;
    setSaving(true);
    try {
      const res = await apiClient.put(`houses/${houseId}/letterhead`, { layout });
      setData(res.data);
      setLayout(res.data.layout);
      toast.success(t("houses.letterhead.toast_save_success"));
    } catch (err: any) {
      toast.error(detailMessage(err, t("houses.letterhead.toast_save_failed")));
    } finally {
      setSaving(false);
    }
  };

  const previewPdf = async () => {
    if (!layout || !data?.has_image) return;
    setPreviewing(true);
    try {
      const res = await apiClient.post(
        `houses/${houseId}/letterhead/preview`,
        { layout },
        { responseType: "blob" }
      );
      const url = window.URL.createObjectURL(new Blob([res.data], { type: "application/pdf" }));
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
    } catch (err: any) {
      toast.error(detailMessage(err, t("houses.letterhead.toast_preview_failed")));
    } finally {
      setPreviewing(false);
    }
  };

  const resetLayout = () => {
    if (!data?.default_layout) return;
    if (!confirm(t("houses.letterhead.reset_confirm"))) return;
    setLayout(JSON.parse(JSON.stringify(data.default_layout)));
    setSelected(null);
    toast.success(t("houses.letterhead.toast_reset_done"));
  };

  // Canvas preview uses the real house values and sample employee data.
  const sampleValue = (key: string) => {
    if (key === "house_name") return data?.house_name ?? "";
    if (key === "house_address") return data?.house_address ?? "";
    if (key === "house_code") return data?.house_code ?? "";
    return SAMPLE_VALUES[key] ?? "";
  };

  const substitute = (text: string) =>
    text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_match, key: string) => sampleValue(key));

  /** Insert a dynamic value at the caret so the body text stays hand-editable. */
  const insertPlaceholder = (key: string) => {
    if (!canEdit || !layout) return;
    const token = `{{${key}}}`;
    const element = bodyTextRef.current;
    const text = layout.body.text ?? "";
    const start = element?.selectionStart ?? text.length;
    const end = element?.selectionEnd ?? text.length;
    updateBlock("body", { text: text.slice(0, start) + token + text.slice(end) });
    requestAnimationFrame(() => {
      if (!element) return;
      element.focus();
      const caret = start + token.length;
      element.setSelectionRange(caret, caret);
    });
  };

  const blockStyle = (block: Block) => ({
    left: `${block.x}%`,
    top: `${block.y}%`,
    width: `${block.w}%`,
    fontSize: `${block.size}pt`,
    fontWeight: block.bold ? 700 : 400,
  });

  const selectedBlock =
    selected === "body" ? layout?.body : selected ? layout?.fields[selected] : undefined;

  if (!canView) return <AccessDenied />;

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="flex items-center justify-between">
          <div className="h-7 w-56 rounded-lg bg-gray-200 dark:bg-slate-700" />
          <div className="h-10 w-24 rounded-xl bg-gray-200 dark:bg-slate-700" />
        </div>
        <div className="h-24 rounded-2xl bg-gray-100 dark:bg-slate-800" />
        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          <div className="aspect-[210/297] w-full rounded-2xl bg-gray-100 dark:bg-slate-800" />
          <div className="space-y-6">
            <div className="h-56 rounded-2xl bg-gray-100 dark:bg-slate-800" />
            <div className="h-40 rounded-2xl bg-gray-100 dark:bg-slate-800" />
          </div>
        </div>
      </div>
    );
  }

  if (!houseId || !data || !layout) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 dark:text-gray-400">{t("common.not_found")}</p>
        <button
          onClick={() => router.push("/houses")}
          className="mt-4 px-4 py-2 rounded-xl bg-primary-500 text-white cursor-pointer inline-flex items-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          {t("common.back")}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {t("houses.letterhead.title")}
          </h1>
          <PageGuideModal pageKey="houses_letterhead" />
        </div>
        <button
          onClick={() => router.push("/houses")}
          className="px-4 py-2 rounded-xl border bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700 font-medium cursor-pointer transition-colors flex items-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          {t("common.back")}
        </button>
      </div>

      {/* House Info */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 truncate">
              {data.house_name} ({data.house_code})
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 break-words">
              {data.house_address || t("common.no_address")}
            </p>
          </div>
          <span
            className={cn(
              "inline-flex shrink-0 px-3 py-1 rounded-full text-sm font-medium",
              data.configured
                ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
            )}
          >
            {data.configured
              ? t("houses.letterhead.status_configured")
              : t("houses.letterhead.status_not_configured")}
          </span>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        {/* Canvas */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden">
          <div className="p-4 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between gap-3">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">
              {t("houses.letterhead.editor_title")}
            </h3>
            {canEdit && (
              <button
                onClick={() =>
                  setLayout((prev) =>
                    prev ? { ...prev, body: { ...prev.body, enabled: !prev.body.enabled } } : prev
                  )
                }
                className={cn(
                  "px-3 py-1.5 rounded-xl text-sm font-medium transition-colors cursor-pointer",
                  layout.body.enabled
                    ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                    : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 hover:bg-gray-200"
                )}
              >
                {layout.body.enabled
                  ? t("houses.letterhead.hide_body")
                  : t("houses.letterhead.show_body")}
              </button>
            )}
          </div>

          <div
            ref={canvasRef}
            className="relative w-full aspect-[210/297] overflow-hidden bg-white select-none"
          >
            {imageUrl ? (
              // Full-page A4 scans fill the page; header-only designs stay at
              // the top. Same rule as the PDF renderer (`background-size: 100% auto`).
              <img
                src={imageUrl}
                alt=""
                draggable={false}
                className="absolute left-0 top-0 w-full h-auto pointer-events-none"
              />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-8 text-center text-gray-400 dark:text-gray-500">
                <ImageIcon className="w-12 h-12 opacity-50" />
                <p className="text-sm">{t("houses.letterhead.no_image")}</p>
              </div>
            )}

            {layout.body.enabled && (
              <div
                className={cn(
                  "absolute border-2 border-dashed p-1.5 cursor-move overflow-hidden",
                  selected === "body"
                    ? "border-primary-500 bg-primary-50/30 dark:bg-primary-900/20"
                    : "border-emerald-400/70 bg-emerald-50/20 dark:bg-emerald-900/10"
                )}
                style={{
                  ...blockStyle(layout.body),
                  lineHeight: layout.body.line_height,
                  textAlign: layout.body.align,
                }}
                onMouseDown={(e) => startDrag(e, "body", "move")}
              >
                <span className="pointer-events-none block whitespace-pre-wrap break-words font-bengali text-gray-900">
                  {substitute(layout.body.text)}
                </span>
                {canEdit && (
                  <span
                    onMouseDown={(e) => startDrag(e, "body", "resize")}
                    className="absolute right-0 top-0 h-full w-2 cursor-ew-resize bg-primary-500/0 hover:bg-primary-500/40"
                    aria-hidden="true"
                  />
                )}
              </div>
            )}

            {FIELD_KEYS.map((key) => {
              const field = layout.fields[key];
              if (!field) return null;
              return (
                <div
                  key={key}
                  className={cn(
                    "absolute bg-primary-50/90 dark:bg-primary-900/40 border-2 rounded px-1.5 py-1 cursor-move overflow-hidden transition-colors",
                    selected === key
                      ? "border-primary-600 ring-2 ring-primary-500/40"
                      : "border-primary-500/70"
                  )}
                  style={blockStyle(field)}
                  onMouseDown={(e) => startDrag(e, key, "move")}
                  title={fieldLabel(key)}
                >
                  <span
                    className="pointer-events-none block truncate font-bengali font-medium text-primary-700 dark:text-primary-200"
                    style={{ textAlign: field.align }}
                  >
                    {SAMPLE_VALUES[key]}
                  </span>
                  <span className="pointer-events-none block font-mono text-[9px] text-primary-500 dark:text-primary-300">
                    {fieldLabel(key)}
                  </span>
                  {canEdit && (
                    <span
                      onMouseDown={(e) => startDrag(e, key, "resize")}
                      className="absolute right-0 top-0 h-full w-2 cursor-ew-resize bg-primary-500/0 hover:bg-primary-500/40"
                      aria-hidden="true"
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right panel */}
        <div className="space-y-6">
          {/* Image */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 p-4">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
              <ImageIcon className="w-5 h-5" />
              {t("houses.letterhead.image_title")}
            </h3>
            {canEdit && (
              <div className="space-y-3">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
                  className="w-full text-sm text-gray-600 dark:text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-medium file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100 cursor-pointer"
                />
                <button
                  onClick={uploadImage}
                  disabled={!imageFile || imageBusy}
                  className={cn(
                    "w-full px-4 py-2.5 rounded-xl font-medium transition-colors flex items-center justify-center gap-2",
                    imageFile && !imageBusy
                      ? "bg-primary-500 text-white hover:bg-primary-600 cursor-pointer"
                      : "bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed"
                  )}
                >
                  {imageBusy ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Upload className="w-4 h-4" />
                  )}
                  {data.has_image
                    ? t("houses.letterhead.replace_image")
                    : t("houses.letterhead.upload_image")}
                </button>
                {data.has_image && (
                  <button
                    onClick={deleteImage}
                    disabled={imageBusy}
                    className="w-full px-4 py-2.5 rounded-xl border font-medium transition-colors flex items-center justify-center gap-2 bg-red-50 text-red-600 border-red-200 hover:bg-red-100 cursor-pointer disabled:cursor-not-allowed"
                  >
                    <Trash2 className="w-4 h-4" />
                    {t("houses.letterhead.delete_image")}
                  </button>
                )}
              </div>
            )}
            <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
              {t("houses.letterhead.image_hint")}
            </p>
          </div>

          {/* Selected block settings */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 p-4">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">
              {t("houses.letterhead.field_settings")}
            </h3>
            {!selectedBlock ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t("houses.letterhead.select_hint")}
              </p>
            ) : (
              <div className="space-y-4">
                <p className="text-sm font-semibold text-primary-600 dark:text-primary-400">
                  {selected === "body" ? t("houses.letterhead.body_block") : fieldLabel(selected!)}
                </p>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">
                      {t("houses.letterhead.font_size")}
                    </label>
                    <input
                      type="number"
                      min={6}
                      max={30}
                      step={0.5}
                      value={selectedBlock.size}
                      disabled={!canEdit}
                      onChange={(e) => updateBlock(selected!, { size: Number(e.target.value) })}
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm outline-none focus:ring-2 focus:ring-primary-500 disabled:cursor-not-allowed"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">
                      {t("houses.letterhead.width_percent")}
                    </label>
                    <input
                      type="number"
                      min={5}
                      max={100}
                      step={1}
                      value={Math.round(selectedBlock.w)}
                      disabled={!canEdit}
                      onChange={(e) => updateBlock(selected!, { w: Number(e.target.value) })}
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm outline-none focus:ring-2 focus:ring-primary-500 disabled:cursor-not-allowed"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">
                    {t("houses.letterhead.align_label")}
                  </label>
                  <div className="grid grid-cols-4 gap-1.5">
                    {ALIGNMENTS.map((align) => (
                      <button
                        key={align}
                        onClick={() => updateBlock(selected!, { align })}
                        disabled={!canEdit}
                        className={cn(
                          "px-2 py-2 rounded-xl text-xs font-medium border transition-colors",
                          selectedBlock.align === align
                            ? "bg-primary-50 dark:bg-primary-900/30 border-primary-500 text-primary-700 dark:text-primary-300"
                            : "bg-gray-50 dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700",
                          canEdit ? "cursor-pointer" : "cursor-not-allowed"
                        )}
                      >
                        {t(`houses.letterhead.align_${align}`)}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  onClick={() => updateBlock(selected!, { bold: !selectedBlock.bold })}
                  disabled={!canEdit}
                  className={cn(
                    "inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium border transition-colors",
                    selectedBlock.bold
                      ? "bg-primary-50 dark:bg-primary-900/30 border-primary-500 text-primary-700 dark:text-primary-300"
                      : "bg-gray-50 dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300",
                    canEdit ? "cursor-pointer" : "cursor-not-allowed"
                  )}
                >
                  <Bold className="w-4 h-4" />
                  {t("houses.letterhead.bold")}
                </button>

                {selected === "body" && (
                  <>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">
                        {t("houses.letterhead.body_text")}
                      </label>
                      <textarea
                        ref={bodyTextRef}
                        rows={8}
                        value={layout.body.text}
                        disabled={!canEdit}
                        onChange={(e) => updateBlock("body", { text: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-bengali outline-none focus:ring-2 focus:ring-primary-500 disabled:cursor-not-allowed"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">
                        {t("houses.letterhead.dynamic_values")}
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {(data?.body_placeholders ?? PLACEHOLDER_KEYS).map((key) => (
                          <button
                            key={key}
                            type="button"
                            onClick={() => insertPlaceholder(key)}
                            disabled={!canEdit}
                            title={t(`houses.letterhead.placeholder_labels.${key}`)}
                            className="px-2 py-1 rounded-lg bg-gray-100 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-[11px] font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-700 cursor-pointer disabled:cursor-not-allowed"
                          >
                            {`{{${key}}}`}
                          </button>
                        ))}
                      </div>
                      <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
                        {t("houses.letterhead.dynamic_hint")}
                      </p>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1.5">
                        {t("houses.letterhead.line_height")}
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={3}
                        step={0.1}
                        value={layout.body.line_height}
                        disabled={!canEdit}
                        onChange={(e) =>
                          updateBlock("body", { line_height: Number(e.target.value) })
                        }
                        className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm outline-none focus:ring-2 focus:ring-primary-500 disabled:cursor-not-allowed"
                      />
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Field list */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 p-4">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">
              {t("houses.letterhead.fields_title")}
            </h3>
            <div className="space-y-2 max-h-64 overflow-auto">
              {FIELD_KEYS.map((key) => (
                <button
                  key={key}
                  onClick={() => setSelected(key)}
                  className={cn(
                    "w-full px-3 py-2 rounded-xl text-left text-sm border transition-colors cursor-pointer",
                    selected === key
                      ? "bg-primary-50 dark:bg-primary-900/30 border-primary-500 text-primary-700 dark:text-primary-300"
                      : "bg-gray-50 dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700"
                  )}
                >
                  {fieldLabel(key)}
                </button>
              ))}
            </div>
            <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
              {t("houses.letterhead.drag_hint")}
            </p>
          </div>

          {/* Actions */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 p-4">
            <div className="flex flex-col gap-3">
              <button
                onClick={saveLayout}
                disabled={saving || !canEdit}
                className={cn(
                  "px-4 py-2.5 rounded-xl font-medium transition-colors flex items-center justify-center gap-2",
                  canEdit
                    ? "bg-primary-500 text-white hover:bg-primary-600 cursor-pointer"
                    : "bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed"
                )}
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t("common.saving")}
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    {t("common.save")}
                  </>
                )}
              </button>
              <button
                onClick={previewPdf}
                disabled={previewing || !data.has_image}
                className={cn(
                  "px-4 py-2.5 rounded-xl border font-medium transition-colors flex items-center justify-center gap-2",
                  data.has_image && !previewing
                    ? "bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700 cursor-pointer"
                    : "bg-gray-100 dark:bg-slate-800 text-gray-400 border-gray-200 dark:border-slate-700 cursor-not-allowed"
                )}
              >
                {previewing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
                {t("houses.letterhead.preview")}
              </button>
              <button
                onClick={resetLayout}
                disabled={!canEdit}
                className={cn(
                  "px-4 py-2.5 rounded-xl border font-medium transition-colors flex items-center justify-center gap-2",
                  canEdit
                    ? "bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700 cursor-pointer"
                    : "bg-gray-100 dark:bg-slate-800 text-gray-400 border-gray-200 dark:border-slate-700 cursor-not-allowed"
                )}
              >
                <RotateCcw className="w-4 h-4" />
                {t("houses.letterhead.reset_layout")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
