"use client";

import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useLanguage } from "@/i18n/useLanguage";
import { cn } from "@/lib/utils";

export type DeployStep = {
  name: string;
  status: "running" | "completed" | "failed";
  startTime?: number;
};

const STEP_LABELS: Record<string, { en: string; bn: string }> = {
  pulling: { en: "Pulling latest code", bn: "সর্বশেষ কোড পুল হচ্ছে" },
  installing: { en: "Installing dependencies", bn: "ডিপেন্ডেন্সি ইনস্টল হচ্ছে" },
  building: { en: "Building frontend", bn: "ফ্রন্টএন্ড বিল্ড হচ্ছে" },
  restarting: { en: "Restarting services", bn: "সার্ভিস রিস্টার্ট হচ্ছে" },
  verifying: { en: "Verifying health", bn: "স্বাস্থ্য পরীক্ষা হচ্ছে" },
};

export default function DeployProgress({ steps, preparing }: { steps: DeployStep[]; preparing?: boolean }) {
  const { t, language } = useLanguage();

  const getStepLabel = (step: string) => {
    const labels = STEP_LABELS[step];
    if (!labels) {
      const raw = t(`deploy.step_${step}`);
      return raw.startsWith("deploy.") ? step : raw;
    }
    return language === "bn" ? labels.bn : labels.en;
  };

  if (preparing && steps.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
        <Loader2 className="w-4 h-4 animate-spin" />
        {t("deploy.preparing")}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {steps.map((step, i) => (
        <div key={i} className="flex items-center gap-3">
          {step.status === "running" ? (
            <Loader2 className="w-5 h-5 animate-spin text-blue-500 shrink-0" />
          ) : step.status === "completed" ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
          ) : (
            <XCircle className="w-5 h-5 text-red-500 shrink-0" />
          )}
          <span className={cn("text-sm", step.status === "failed" ? "text-red-600 dark:text-red-400" : "text-gray-700 dark:text-gray-300")}>
            {getStepLabel(step.name)}
          </span>
          {step.status === "running" && (
            <span className="ml-auto text-[11px] text-gray-400 dark:text-gray-500">{t("deploy.in_progress")}</span>
          )}
          {step.status === "completed" && (
            <span className="ml-auto text-[11px] text-emerald-500">{t("deploy.done")}</span>
          )}
        </div>
      ))}
    </div>
  );
}
