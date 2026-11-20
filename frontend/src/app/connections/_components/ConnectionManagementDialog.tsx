"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useLanguage } from "@/i18n/useLanguage";

interface ConnectionManagementDialogProps {
  open: boolean;
  title: string;
  description: string;
  errorMessage?: string | null;
  onClose: () => void;
  children: ReactNode;
}

export function ConnectionManagementDialog({
  open,
  title,
  description,
  errorMessage,
  onClose,
  children,
}: ConnectionManagementDialogProps) {
  const { t } = useLanguage();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="connection-management-title"
        aria-describedby="connection-management-description"
        tabIndex={-1}
        className="flex max-h-[100dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-gray-200 bg-white shadow-2xl outline-none dark:border-slate-700 dark:bg-slate-900 sm:max-h-[90dvh] sm:max-w-3xl sm:rounded-3xl"
      >
        <div className="flex items-start gap-3 border-b border-gray-100 px-4 py-4 dark:border-slate-800 sm:px-6">
          <div className="min-w-0 flex-1">
            <h2
              id="connection-management-title"
              className="text-lg font-bold text-gray-900 dark:text-gray-100"
            >
              {title}
            </h2>
            <p
              id="connection-management-description"
              className="mt-1 text-sm text-gray-500 dark:text-gray-400"
            >
              {description}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("connectionsPage.actions.close")}
            className="flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-slate-800"
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
          {errorMessage && (
            <p
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
            >
              {errorMessage}
            </p>
          )}
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
