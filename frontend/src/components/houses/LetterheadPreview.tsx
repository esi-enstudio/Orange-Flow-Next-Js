"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import apiClient from "@/lib/api";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/i18n/useLanguage";
import {
  LETTERHEAD_SAMPLE_VALUES,
  previewBlockStyle,
  substituteLetterheadPlaceholders,
} from "@/lib/letterhead";

type BodyBlock = {
  text?: string;
  enabled?: boolean;
  x: number;
  y: number;
  w: number;
  size: number;
  line_height?: number;
  align?: "left" | "center" | "right" | "justify";
  bold?: boolean;
};

/**
 * The A4 page as it will be printed: letterhead image + the house body text.
 * Font sizes scale with the rendered width so the text keeps the PDF layout.
 */
function LetterheadPage({
  imageUrl,
  body,
  values,
}: {
  imageUrl: string | null;
  body?: BodyBlock;
  values: Record<string, string>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      setWidth(entries[0]?.contentRect.width ?? 0);
    });
    observer.observe(element);
    setWidth(element.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  const html = body?.text ? substituteLetterheadPlaceholders(body.text, values) : "";

  return (
    <div ref={ref} className="relative aspect-[210/297] w-full overflow-hidden bg-white">
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt=""
          draggable={false}
          className="absolute left-0 top-0 h-auto w-full"
        />
      ) : (
        <div className="absolute inset-0 animate-pulse bg-gray-100" aria-hidden="true" />
      )}
      {body?.enabled && html && (
        <div
          className="absolute"
          style={{
            ...previewBlockStyle(body, width),
            lineHeight: body.line_height ?? 1.7,
            textAlign: body.align ?? "left",
          }}
        >
          <div
            className="pointer-events-none whitespace-pre-wrap break-words font-bengali text-gray-900 [&_img]:max-w-full [&_ol]:list-decimal [&_p]:m-0 [&_ul]:list-disc"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Letterhead thumbnail for document cards. Shows the page with its body text
 * (not just the blank pad) and opens a readable full-page preview on click.
 */
export default function LetterheadPreview({
  houseId,
  title,
  label,
  fallback,
  values: employeeValues,
}: {
  houseId: number | null | undefined;
  title: string;
  label: string;
  fallback: React.ReactNode;
  /** Employee-specific placeholder values; merged over the house values and samples. */
  values?: Record<string, string>;
}) {
  const { t } = useLanguage();
  const [mounted, setMounted] = useState(false);
  const [layout, setLayout] = useState<{ body?: BodyBlock } | null>(null);
  const [houseValues, setHouseValues] = useState<Record<string, string>>({});
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    setLayout(null);
    setHouseValues({});
    setImageUrl(null);
    setFailed(false);
    if (!houseId) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    setLoading(true);
    (async () => {
      try {
        const res = await apiClient.get(`houses/${houseId}/letterhead`);
        if (cancelled) return;
        setLayout(res.data?.layout ?? null);
        // `values` is Bangla-first (English fallback) and already includes the
        // house code; fall back to the raw fields for older responses.
        setHouseValues(
          res.data?.values ?? {
            house_name: res.data?.house_name ?? "",
            house_code: res.data?.house_code ?? "",
            house_address: res.data?.house_address ?? "",
          }
        );
        if (res.data?.has_image) {
          const image = await apiClient.get(`houses/${houseId}/letterhead/image`, {
            responseType: "blob",
          });
          if (cancelled) return;
          objectUrl = window.URL.createObjectURL(
            new Blob([image.data], { type: "image/jpeg" })
          );
          setImageUrl(objectUrl);
        }
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) window.URL.revokeObjectURL(objectUrl);
    };
  }, [houseId]);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!houseId || failed || (!loading && !layout && !imageUrl)) return <>{fallback}</>;

  if (loading) {
    return (
      <div
        className="h-32 w-[91px] shrink-0 animate-pulse rounded-xl bg-gray-200 dark:bg-slate-700"
        aria-hidden="true"
      />
    );
  }

  const values = { ...LETTERHEAD_SAMPLE_VALUES, ...houseValues, ...employeeValues };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={label}
        aria-label={label}
        className="h-32 w-[91px] shrink-0 overflow-hidden rounded-xl border border-gray-200 bg-white transition-all hover:ring-2 hover:ring-primary-500 cursor-pointer dark:border-slate-700 dark:bg-slate-800"
      >
        <LetterheadPage
          imageUrl={imageUrl}
          body={layout?.body}
          values={values}
        />
      </button>

      {mounted &&
        open &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="fixed inset-0 z-[200] flex flex-col bg-slate-950/85 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          >
            <div
              className="flex shrink-0 items-center justify-between gap-3 px-4 py-3"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="truncate text-sm font-semibold text-white">{title}</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t("common.close")}
                title={t("common.close")}
                className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl text-slate-300 hover:bg-white/10 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div
              className="flex-1 overflow-auto overscroll-contain p-3 sm:p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className={cn("mx-auto w-full max-w-[560px] rounded-lg bg-white shadow-2xl")}>
                <LetterheadPage
                  imageUrl={imageUrl}
                  body={layout?.body}
                  values={values}
                />
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
