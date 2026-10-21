"use client";

import { useState } from "react";
import {
  MapPin,
  Phone,
  User,
  Edit2,
  Trash2,
  ChevronDown,
  ChevronUp,
  Building2,
  MapPinned,
  Key,
  Crown,
  CalendarClock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/i18n/useLanguage";

interface House {
  id: number;
  name: string;
  code: string;
  cluster: string;
  region: string;
  wh_region: string;
  district: string;
  email: string;
  address: string;
  proprietor_name: string;
  proprietor_contact: string;
  poc_name: string;
  poc_mobile: string;
  lifting_date: string;
  latitude: string;
  longitude: string;
  bts_id: string;
  dms_user: string;
  dms_pass: string;
  dms_house_id: string;
  show_pull_button: boolean;
  is_active: boolean;
  plan_name?: string | null;
  plan_slug?: string | null;
  plan_status?: string | null;
  plan_end_date?: string | null;
  plan_days_remaining?: number | null;
  plan_billing_interval?: string | null;
  plan_is_valid?: boolean | null;
}

interface Props {
  house: House;
  onEdit: (house: House) => void;
  onDelete: (id: number) => void;
  onToggleStatus: (house: House) => void;
  canEdit: boolean;
  canDelete: boolean;
}

export default function HouseCard({ house, onEdit, onDelete, onToggleStatus, canEdit, canDelete }: Props) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useLanguage();

  const planStatus = house.plan_status ?? null;
  const planDays = house.plan_days_remaining ?? null;
  const planValid = house.plan_is_valid === true;
  const planExpired =
    !!planStatus &&
    (!planValid || planStatus === "expired" || planStatus === "cancelled" || planStatus === "paused");

  const planTone = !planStatus
    ? "border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/60 text-gray-600 dark:text-gray-300"
    : planStatus === "past_due"
      ? "border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300"
      : planValid
        ? "border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
        : "border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300";

  const planStatusLabel = planStatus ? t(`houses.plan_status_${planStatus}`) : t("houses.plan_none");

  let planExpiryText = "";
  if (!planStatus) {
    planExpiryText = t("houses.plan_none");
  } else if (planStatus === "past_due") {
    planExpiryText = t("houses.plan_status_past_due");
  } else if (planExpired || planDays === 0) {
    planExpiryText = t("houses.plan_expired");
  } else if (planDays === 1) {
    planExpiryText = t("houses.plan_day_left", { days: planDays });
  } else if (planDays !== null) {
    planExpiryText = t("houses.plan_days_left", { days: planDays });
  }

  const planEndDateLabel = house.plan_end_date
    ? new Date(house.plan_end_date).toLocaleDateString()
    : "—";

  const billingLabel =
    house.plan_billing_interval === "yearly"
      ? t("houses.plan_billing_yearly")
      : house.plan_billing_interval === "monthly"
        ? t("houses.plan_billing_monthly")
        : "—";

  return (
    <div className="group bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm hover:shadow-lg hover:border-primary-200 dark:hover:border-primary-900/30 transition-all duration-300 overflow-hidden">
      {/* Header */}
      <div className="p-5">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 text-white shadow-lg shadow-indigo-500/30 shrink-0">
              <Building2 className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 truncate">
                {house.name}
              </h3>
              <div className="flex items-center gap-2 mt-1">
                <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 dark:bg-slate-800 rounded-lg text-xs font-mono font-semibold text-gray-700 dark:text-gray-300">
                  <Key className="w-3 h-3" />
                  {house.code}
                </span>
                <span className={cn(
                  "inline-flex items-center px-2 py-1 rounded-lg text-xs font-semibold",
                  house.is_active
                    ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    : "bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-gray-400"
                )}>
                  {house.is_active ? t('common.active') : t('common.inactive')}
                </span>
                {house.show_pull_button && (
                  <span className="inline-flex items-center px-2 py-1 rounded-lg text-xs font-bold bg-primary-50 dark:bg-primary-500/10 text-primary-700 dark:text-primary-300">
                    {t('houses.pull_enabled')}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {canEdit && (
              <button
                onClick={() => onEdit(house)}
                className="p-2 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors cursor-pointer"
                title="Edit"
              >
                <Edit2 className="w-4 h-4" />
              </button>
            )}
            {canDelete && (
              <button
                onClick={() => onDelete(house.id)}
                className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors cursor-pointer"
                title="Delete"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={() => setExpanded(!expanded)}
              className="p-2 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Quick Info */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center gap-2 text-sm">
            <MapPin className="w-4 h-4 text-gray-400 shrink-0" />
            <span className="text-gray-600 dark:text-gray-400 truncate">{house.district}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <MapPinned className="w-4 h-4 text-gray-400 shrink-0" />
            <span className="text-gray-600 dark:text-gray-400 truncate">{house.region}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <User className="w-4 h-4 text-gray-400 shrink-0" />
            <span className="text-gray-600 dark:text-gray-400 truncate">{house.poc_name}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Phone className="w-4 h-4 text-gray-400 shrink-0" />
            <span className="text-gray-600 dark:text-gray-400 font-mono truncate">{house.poc_mobile}</span>
          </div>
        </div>

        {/* Subscription plan strip */}
        <div className={cn("mt-4 flex flex-wrap items-center gap-2.5 rounded-xl border px-3 py-2.5", planTone)}>
          <Crown className="w-4 h-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold truncate">
              {house.plan_name || t("houses.plan_none")}
            </p>
            {planStatus && (
              <p className="text-[11px] opacity-80 truncate">{planExpiryText}</p>
            )}
          </div>
          {planStatus && (
            <span className="inline-flex items-center px-2 py-1 rounded-lg bg-white/70 dark:bg-slate-900/50 text-[11px] font-bold uppercase tracking-wide">
              {planStatusLabel}
            </span>
          )}
        </div>
        {planExpired && !house.is_active && (
          <p className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-red-600 dark:text-red-400">
            <CalendarClock className="w-3.5 h-3.5 shrink-0" />
            {t("houses.plan_auto_deactivated")}
          </p>
        )}
      </div>

      {/* Expanded Details */}
      {expanded && (
        <div className="border-t border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-800/50 p-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                Location Details
              </p>
              <div className="space-y-2">
                <div>
                  <span className="text-xs text-gray-500 dark:text-gray-400">Cluster:</span>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{house.cluster}</p>
                </div>
                <div>
                  <span className="text-xs text-gray-500 dark:text-gray-400">WH Region:</span>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{house.wh_region}</p>
                </div>
                <div>
                  <span className="text-xs text-gray-500 dark:text-gray-400">Address:</span>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{house.address}</p>
                </div>
                {(house.latitude && house.longitude) && (
                  <div>
                    <span className="text-xs text-gray-500 dark:text-gray-400">Coordinates:</span>
                    <p className="text-sm font-mono font-medium text-gray-900 dark:text-gray-100">
                      {house.latitude}, {house.longitude}
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                Contact & Business
              </p>
              <div className="space-y-2">
                <div>
                  <span className="text-xs text-gray-500 dark:text-gray-400">Proprietor:</span>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{house.proprietor_name}</p>
                  {house.proprietor_contact && (
                    <p className="text-sm font-mono text-gray-600 dark:text-gray-400">{house.proprietor_contact}</p>
                  )}
                </div>
                {house.email && (
                  <div>
                    <span className="text-xs text-gray-500 dark:text-gray-400">Email:</span>
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{house.email}</p>
                  </div>
                )}
                <div>
                  <span className="text-xs text-gray-500 dark:text-gray-400">Lifting Date:</span>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {house.lifting_date ? new Date(house.lifting_date).toLocaleDateString() : '-'}
                  </p>
                </div>
                {house.bts_id && (
                  <div>
                    <span className="text-xs text-gray-500 dark:text-gray-400">BTS ID:</span>
                    <p className="text-sm font-mono font-medium text-gray-900 dark:text-gray-100">{house.bts_id}</p>
                  </div>
                )}
              </div>
            </div>

            <div className="md:col-span-2">
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                {t("houses.plan_title")}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-xs text-gray-500 dark:text-gray-400">{t("houses.plan_name_label")}:</span>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {house.plan_name || t("houses.plan_none")}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-gray-500 dark:text-gray-400">{t("houses.plan_status_hint")}:</span>
                  <p className={cn(
                    "text-sm font-semibold",
                    planExpired
                      ? "text-red-600 dark:text-red-400"
                      : planStatus === "past_due"
                        ? "text-amber-600 dark:text-amber-400"
                        : planValid
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-gray-900 dark:text-gray-100"
                  )}>
                    {planStatusLabel}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-gray-500 dark:text-gray-400">{t("houses.plan_expires_on", { date: planEndDateLabel })}</span>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{planExpiryText}</p>
                </div>
                <div>
                  <span className="text-xs text-gray-500 dark:text-gray-400">{t("houses.plan_billing_interval")}:</span>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{billingLabel}</p>
                </div>
              </div>
            </div>

            <div className="md:col-span-2">
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                DMS Integration
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <span className="text-xs text-gray-500 dark:text-gray-400">DMS House ID:</span>
                  <p className="text-sm font-mono font-medium text-gray-900 dark:text-gray-100">{house.dms_house_id}</p>
                </div>
                <div>
                  <span className="text-xs text-gray-500 dark:text-gray-400">DMS Username:</span>
                  <p className="text-sm font-mono font-medium text-gray-900 dark:text-gray-100">{house.dms_user}</p>
                </div>
                <div>
                  <span className="text-xs text-gray-500 dark:text-gray-400">DMS Password:</span>
                  <p className="text-sm font-mono font-medium text-gray-900 dark:text-gray-100">••••••••</p>
                </div>
              </div>
            </div>
          </div>

          {/* Actions */}
          {canEdit && (
            <div className="mt-4 pt-4 border-t border-gray-200 dark:border-slate-700 flex justify-end">
              <button
                onClick={() => onToggleStatus(house)}
                className={cn(
                  "px-4 py-2 rounded-xl text-sm font-semibold transition-colors cursor-pointer",
                  house.is_active
                    ? "bg-gray-200 dark:bg-slate-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-slate-600"
                    : "bg-emerald-500 text-white hover:bg-emerald-600"
                )}
              >
                {house.is_active ? 'Deactivate' : 'Activate'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
