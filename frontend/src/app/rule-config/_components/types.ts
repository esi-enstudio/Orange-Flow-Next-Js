"use client";

import { Activity, BarChart3, Sliders } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export const ROLES = ["HOUSE", "SUPERVISOR", "RSO", "BP"] as const;
export type Role = (typeof ROLES)[number];

export interface RuleType {
  id: number;
  house_id: number | null;
  context_key: string;
  rule_name: string;
  target_role: string;
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
  excluded_product_codes: string[];
  excluded_retailer_types: string[];
  included_employee_ids: number[];
}

export interface ProductOption { code: string; name: string }
export interface RetailerTypeOption { name: string; code: string }
export interface EmployeeOption {
  id: number;
  user_id: number | null;
  name: string;
  employee_type: string;
  dms_code: string;
}

export interface OptionsData {
  product_codes: ProductOption[];
  retailer_types: RetailerTypeOption[];
  employees: EmployeeOption[];
  roles: string[];
  context_keys: string[];
}

export interface RuleContextMeta {
  icon: LucideIcon;
  iconBg: string;
  active: string;
  chip: string;
}

export const ROLE_STYLE: Record<Role, { icon: string; active: string; chip: string }> = {
  HOUSE: { icon: "🏠", active: "bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300", chip: "bg-violet-100 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300" },
  SUPERVISOR: { icon: "👔", active: "bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300", chip: "bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300" },
  RSO: { icon: "👤", active: "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", chip: "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  BP: { icon: "🏅", active: "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300", chip: "bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300" },
};

export const CONTEXT_META: Record<string, RuleContextMeta> = {
  ga_live: {
    icon: Activity,
    iconBg: "bg-emerald-50 dark:bg-emerald-500/10",
    active: "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30",
    chip: "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  },
  activation_report: {
    icon: BarChart3,
    iconBg: "bg-violet-50 dark:bg-violet-500/10",
    active: "bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-500/30",
    chip: "bg-violet-100 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300",
  },
};

export const DEFAULT_CONTEXT_META: RuleContextMeta = {
  icon: Sliders,
  iconBg: "bg-gray-100 dark:bg-slate-800",
  active: "bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-slate-700",
  chip: "bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-gray-300",
};