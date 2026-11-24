"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "react-hot-toast";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";
import { useLanguage } from "@/i18n/useLanguage";
import apiClient from "@/lib/api";
import { getDocumentErrorMessage } from "@/lib/documents";

interface TemplateDeleteButtonProps {
  templateId: number;
  templateName: string;
  scope: "global" | "house";
  isDefault: boolean;
  canManage: boolean;
  isSuperAdmin: boolean;
  headers: Record<string, string>;
  onDeleted: (templateId: number) => void | Promise<void>;
  variant?: "icon" | "full";
}

export default function TemplateDeleteButton({
  templateId,
  templateName,
  scope,
  isDefault,
  canManage,
  isSuperAdmin,
  headers,
  onDeleted,
  variant = "icon",
}: TemplateDeleteButtonProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Global templates are super-admin-only; the backend returns 403 otherwise.
  const canDelete = canManage && (scope !== "global" || isSuperAdmin);
  if (!canDelete) return null;

  const confirmDelete = async () => {
    setDeleting(true);
    try {
      await apiClient.delete(`v1/documents/templates/${templateId}`, { headers });
    } catch (error: unknown) {
      setOpen(false);
      toast.error(getDocumentErrorMessage(error, t("documents.delete_error")));
      return;
    } finally {
      setDeleting(false);
    }

    setOpen(false);
    toast.success(t("documents.delete_success"));
    await onDeleted(templateId);
  };

  const label = t("documents.delete");

  return (
    <>
      {variant === "icon" ? (
        <button
          type="button"
          title={label}
          aria-label={label}
          disabled={deleting}
          onClick={() => setOpen(true)}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl border border-red-200 text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900/50 dark:hover:bg-red-950/30"
        >
          <Trash2 aria-hidden="true" className="size-4" />
        </button>
      ) : (
        <button
          type="button"
          disabled={deleting}
          onClick={() => setOpen(true)}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-red-200 px-4 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900/50 dark:hover:bg-red-950/30"
        >
          <Trash2 aria-hidden="true" className="size-4" />
          {label}
        </button>
      )}

      <ConfirmationModal
        isOpen={open}
        onClose={() => setOpen(false)}
        onConfirm={() => void confirmDelete()}
        title={t("documents.delete_title")}
        message={t(
          isDefault ? "documents.delete_default_message" : "documents.delete_message",
          { name: templateName },
        )}
        confirmText={t("documents.delete_confirm")}
        type="danger"
        loading={deleting}
      />
    </>
  );
}
