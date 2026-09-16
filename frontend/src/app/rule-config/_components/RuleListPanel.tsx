"use client";

import { useMemo } from "react";
import { CheckCircle2, CircleDashed, Clock, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/i18n/useLanguage";
import type { RuleType } from "./types";

interface RuleListPanelProps {
  rules: RuleType[];
  selectedId: number | null;
  canCreate: boolean;
  onCreate: () => void;
  onSelect: (rule: RuleType) => void;
}

export default function RuleListPanel({
  rules,
  selectedId,
  canCreate,
  onCreate,
  onSelect,
}: RuleListPanelProps) {
  const { t } = useLanguage();

  const activeCount = useMemo(() => rules.filter((r) => r.is_active).length, [rules]);

  const contextLabel = (ctx: string) => {
    const label = t(`rule_config.contexts.${ctx}`);
    return label === `rule_config.contexts.${ctx}` ? ctx : label;
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-gray-700 dark:text-gray-300">
            {t("rule_config.page.rules")}
          </span>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-gray-400 font-semibold">
            {t("rule_config.page.rule_count", { active: activeCount, total: rules.length })}
          </span>
        </div>
        {canCreate && (
          <button
            type="button"
            onClick={onCreate}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-500/10 hover:bg-primary-100 dark:hover:bg-primary-500/20 transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            {t("rule_config.page.new_rule")}
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
        {rules.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center rounded-2xl border border-dashed border-gray-200 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-800/30">
            <div className="w-12 h-12 rounded-2xl bg-gray-100 dark:bg-slate-800 flex items-center justify-center mb-3">
              <CircleDashed className="w-6 h-6 text-gray-400 dark:text-gray-500" />
            </div>
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
              {t("rule_config.messages.no_data")}
            </p>
            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1 px-6">
              {t("rule_config.messages.empty_hint")}
            </p>
          </div>
        ) : (
          rules.map((rule) => (
            <button
              key={rule.id}
              type="button"
              onClick={() => onSelect(rule)}
              className={cn(
                "w-full text-left rounded-xl border px-3.5 py-3 transition-all cursor-pointer",
                rule.id === selectedId
                  ? "border-primary-500/60 bg-primary-50/60 dark:bg-primary-500/10 shadow-sm"
                  : "border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-gray-300 dark:hover:border-slate-600"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <p className="text-sm font-semibold truncate text-gray-900 dark:text-gray-100">
                    {rule.rule_name}
                  </p>
                  {rule.apply_to && rule.apply_to !== "all" && (
                    <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded-full bg-violet-50 dark:bg-violet-500/15 text-violet-600 dark:text-violet-300 font-semibold">
                      {t(`rule_config.sections.${rule.apply_to}`)}
                    </span>
                  )}
                  {rule.column_key && rule.column_key !== "all" && (
                    <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded-full bg-cyan-50 dark:bg-cyan-500/15 text-cyan-600 dark:text-cyan-300 font-semibold">
                      {t(`rule_config.columns.${rule.column_key}`)}
                    </span>
                  )}
                </div>
                {rule.is_active ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                ) : (
                  <span className="shrink-0 mt-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-gray-400 font-bold">
                    {t("common.inactive")}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-gray-400 font-semibold">
                  {contextLabel(rule.context_key)}
                </span>
                {rule.updated_at && (
                  <span className="flex items-center gap-1 text-[11px] text-gray-400 dark:text-gray-500">
                    <Clock className="w-3 h-3" />
                    {new Date(rule.updated_at + "Z").toLocaleString()}
                  </span>
                )}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}