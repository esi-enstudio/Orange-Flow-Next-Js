"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  Bike,
  Building2,
  Car,
  Check,
  Church,
  CreditCard,
  DollarSign,
  Droplets,
  RotateCcw,
  UserRound,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/i18n/useLanguage";
import apiClient from "@/lib/api";
import { DateRangePicker } from "@/components/date-picker";

export interface EmployeeFilters {
  search: string;
  house_id: number | null;
  role: string;
  market_type: string;
  motor_bike: string;
  bicyle: string;
  driving_license: string;
  blood_group: string;
  religion: string;
  has_assisted_code: boolean | null;
  has_user: boolean | null;
  has_bank_info: boolean | null;
  joining_date_from: string;
  joining_date_to: string;
  resigned_date_from: string;
  resigned_date_to: string;
  salary_min: string;
  salary_max: string;
}

export const defaultFilters: EmployeeFilters = {
  search: "",
  role: "",
  market_type: "",
  motor_bike: "",
  bicyle: "",
  driving_license: "",
  blood_group: "",
  religion: "",
  has_assisted_code: null,
  has_user: null,
  has_bank_info: null,
  joining_date_from: "",
  joining_date_to: "",
  resigned_date_from: "",
  resigned_date_to: "",
  salary_min: "",
  salary_max: "",
  house_id: null,
};

/** Filters that live in the drawer (search stays in the toolbar as immediate search). */
export function countActiveEmployeeFilters(filters: EmployeeFilters): number {
  return Object.entries(filters).filter(
    ([key, val]) => key !== "search" && val !== null && val !== ""
  ).length;
}

interface House {
  id: number;
  name: string;
  code: string;
}

interface FilterOption {
  value: string;
  label: string;
}

interface FilterOptions {
  statuses: string[];
  market_types: string[];
  blood_groups: string[];
  religions: string[];
}

interface Props {
  open: boolean;
  filters: EmployeeFilters;
  onApply: (filters: EmployeeFilters) => void;
  onClose: () => void;
  houses: House[];
}

const FIELD_CLASS =
  "w-full px-3 py-2.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500/40 focus:border-primary-500 transition-colors cursor-pointer";

function Field({ label, icon: Icon, children }: { label: string; icon: LucideIcon; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
        <Icon className="w-4 h-4 text-primary-500" />
        {label}
      </label>
      {children}
    </div>
  );
}

function TriBoolSelect({
  value,
  onChange,
}: {
  value: boolean | null;
  onChange: (v: boolean | null) => void;
}) {
  const { t } = useLanguage();
  return (
    <select
      value={value === null ? "" : String(value)}
      onChange={(e) => onChange(e.target.value === "" ? null : e.target.value === "true")}
      className={FIELD_CLASS}
    >
      <option value="">{t("common.all")}</option>
      <option value="true">{t("common.yes")}</option>
      <option value="false">{t("common.no")}</option>
    </select>
  );
}

export default function EmployeeMasterFilter({ open, filters, onApply, onClose, houses }: Props) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState<EmployeeFilters>(filters);
  const wasOpen = useRef(false);

  // Stage a fresh copy of the applied filters every time the drawer opens, so
  // closing without Apply leaves the table untouched.
  useEffect(() => {
    if (open && !wasOpen.current) setDraft(filters);
    wasOpen.current = open;
  }, [open, filters]);

  const [options, setOptions] = useState<FilterOptions>({
    statuses: [],
    market_types: [],
    blood_groups: [],
    religions: [],
  });

  useEffect(() => {
    apiClient.get<FilterOptions>("/employees/filter-options").then((res) => {
      if (res.data) setOptions(res.data);
    }).catch(() => {});
  }, []);

  const update = (key: keyof EmployeeFilters, value: EmployeeFilters[keyof EmployeeFilters]) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };

  const yesNoOptions: FilterOption[] = [
    { value: "Yes", label: t("common.yes") },
    { value: "No", label: t("common.no") },
  ];

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[100] bg-black/30 backdrop-blur-sm"
          />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            role="dialog"
            aria-modal="true"
            aria-label={t("employees.filter_title")}
            className="fixed inset-y-0 right-0 z-[101] w-full sm:max-w-md bg-white dark:bg-slate-900 shadow-2xl flex flex-col"
          >
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-gray-100 dark:border-slate-800">
              <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">
                {t("employees.filter_title")}
              </h2>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setDraft({ ...defaultFilters, search: filters.search })}
                  className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 hover:text-gray-600 dark:hover:text-gray-300 transition-colors cursor-pointer"
                  title={t("employees.filter_reset")}
                  aria-label={t("employees.filter_reset")}
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label={t("common.close")}
                  className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 hover:text-gray-600 dark:hover:text-gray-300 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              <Field label={t("employees.filter_house")} icon={Building2}>
                <select
                  value={draft.house_id ? String(draft.house_id) : ""}
                  onChange={(e) => update("house_id", e.target.value ? Number(e.target.value) : null)}
                  className={FIELD_CLASS}
                >
                  <option value="">{t("employees.filter_all_houses")}</option>
                  {houses.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name} ({h.code})
                    </option>
                  ))}
                </select>
              </Field>

              <Field label={t("employees.filter_role")} icon={UserRound}>
                <select
                  value={draft.role}
                  onChange={(e) => update("role", e.target.value)}
                  className={FIELD_CLASS}
                >
                  <option value="">{t("employees.filter_all_roles")}</option>
                  {["RSO", "BP", "Supervisor", "Manager", "BSP", "RBSP"].map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </Field>

              <Field label={t("employees.filter_market_type")} icon={Activity}>
                <select
                  value={draft.market_type}
                  onChange={(e) => update("market_type", e.target.value)}
                  className={FIELD_CLASS}
                >
                  <option value="">{t("employees.filter_all_market_types")}</option>
                  {options.market_types.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </Field>

              <DateRangePicker
                label={t("employees.filter_joining_date")}
                value={{ from: draft.joining_date_from || null, to: draft.joining_date_to || null }}
                onChange={(range) => {
                  update("joining_date_from", range.from ?? "");
                  update("joining_date_to", range.to ?? "");
                }}
              />

              <DateRangePicker
                label={t("employees.filter_resigned_date")}
                value={{ from: draft.resigned_date_from || null, to: draft.resigned_date_to || null }}
                onChange={(range) => {
                  update("resigned_date_from", range.from ?? "");
                  update("resigned_date_to", range.to ?? "");
                }}
              />

              <Field label={t("employees.filter_blood_group")} icon={Droplets}>
                <select
                  value={draft.blood_group}
                  onChange={(e) => update("blood_group", e.target.value)}
                  className={FIELD_CLASS}
                >
                  <option value="">{t("employees.filter_any")}</option>
                  {options.blood_groups.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </Field>

              <Field label={t("employees.filter_religion")} icon={Church}>
                <select
                  value={draft.religion}
                  onChange={(e) => update("religion", e.target.value)}
                  className={FIELD_CLASS}
                >
                  <option value="">{t("employees.filter_any")}</option>
                  {options.religions.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </Field>

              <Field label={t("employees.filter_motor_bike")} icon={Bike}>
                <select
                  value={draft.motor_bike}
                  onChange={(e) => update("motor_bike", e.target.value)}
                  className={FIELD_CLASS}
                >
                  <option value="">{t("employees.filter_any")}</option>
                  {yesNoOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </Field>

              <Field label={t("employees.filter_bicycle")} icon={Bike}>
                <select
                  value={draft.bicyle}
                  onChange={(e) => update("bicyle", e.target.value)}
                  className={FIELD_CLASS}
                >
                  <option value="">{t("employees.filter_any")}</option>
                  {yesNoOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </Field>

              <Field label={t("employees.filter_driving_license")} icon={Car}>
                <select
                  value={draft.driving_license}
                  onChange={(e) => update("driving_license", e.target.value)}
                  className={FIELD_CLASS}
                >
                  <option value="">{t("employees.filter_any")}</option>
                  {yesNoOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </Field>

              <Field label={t("employees.filter_assisted_code")} icon={Check}>
                <TriBoolSelect
                  value={draft.has_assisted_code}
                  onChange={(v) => update("has_assisted_code", v)}
                />
              </Field>

              <Field label={t("employees.filter_linked_user")} icon={UserRound}>
                <TriBoolSelect value={draft.has_user} onChange={(v) => update("has_user", v)} />
              </Field>

              <Field label={t("employees.filter_bank_info")} icon={CreditCard}>
                <TriBoolSelect value={draft.has_bank_info} onChange={(v) => update("has_bank_info", v)} />
              </Field>

              <Field label={t("employees.filter_salary_min")} icon={DollarSign}>
                <input
                  type="number"
                  placeholder={t("employees.filter_salary_min_placeholder")}
                  value={draft.salary_min}
                  onChange={(e) => update("salary_min", e.target.value)}
                  className={cn(FIELD_CLASS, "cursor-text")}
                />
              </Field>

              <Field label={t("employees.filter_salary_max")} icon={DollarSign}>
                <input
                  type="number"
                  placeholder={t("employees.filter_salary_max_placeholder")}
                  value={draft.salary_max}
                  onChange={(e) => update("salary_max", e.target.value)}
                  className={cn(FIELD_CLASS, "cursor-text")}
                />
              </Field>
            </div>

            <div className="px-5 py-4 border-t border-gray-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => {
                  onApply(draft);
                  onClose();
                }}
                className="w-full inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium bg-primary-600 text-white hover:bg-primary-700 shadow-sm shadow-primary-600/25 active:scale-[0.98] transition-all cursor-pointer"
              >
                {t("employees.filter_apply")}
              </button>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
