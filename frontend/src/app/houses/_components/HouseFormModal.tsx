"use client";

import { useEffect, useRef, useState, type ElementType, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  Compass,
  Crosshair,
  Database,
  Eye,
  EyeOff,
  Hash,
  Loader2,
  LocateFixed,
  Mail,
  MapPin,
  MapPinned,
  Phone,
  RadioTower,
  ShieldCheck,
  User,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/i18n/useLanguage";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: any) => Promise<void>;
  formData: any;
  setFormData: (data: any) => void;
  isEdit: boolean;
  loading: boolean;
}

const inputBase =
  "w-full h-11 rounded-xl border bg-gray-50 dark:bg-slate-800/60 text-sm text-gray-900 dark:text-gray-100 " +
  "placeholder:text-gray-400 dark:placeholder:text-gray-500 outline-none transition-all " +
  "focus:bg-white dark:focus:bg-slate-800 focus:ring-2";

function TextField({
  label,
  value,
  onChange,
  name,
  type = "text",
  placeholder,
  icon: Icon,
  required,
  hint,
  error,
  autoFocus,
  step,
  trailing,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  name?: string;
  type?: string;
  placeholder?: string;
  icon?: ElementType;
  required?: boolean;
  hint?: string;
  error?: string;
  autoFocus?: boolean;
  step?: string;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label
        htmlFor={name}
        className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 ml-0.5"
      >
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <div className="relative group">
        {Icon && (
          <Icon
            className={cn(
              "absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none transition-colors",
              error
                ? "text-red-500"
                : "text-gray-400 dark:text-gray-500 group-focus-within:text-primary-500"
            )}
          />
        )}
        <input
          id={name}
          name={name}
          type={type}
          step={step}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          autoFocus={autoFocus}
          aria-invalid={!!error}
          className={cn(
            inputBase,
            Icon ? "pl-10" : "px-3.5",
            trailing ? "pr-11" : "pr-3.5",
            error
              ? "border-red-400/60 focus:ring-red-500/20 focus:border-red-500"
              : "border-gray-200 dark:border-slate-700 focus:ring-primary-500/20 focus:border-primary-500"
          )}
        />
        {trailing}
      </div>
      {error ? (
        <p className="text-[11px] font-medium text-red-500 ml-0.5">{error}</p>
      ) : hint ? (
        <p className="text-[11px] text-gray-400 dark:text-gray-500 ml-0.5">{hint}</p>
      ) : null}
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: ElementType;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 shadow-sm">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-7 h-7 rounded-lg bg-primary-50 dark:bg-primary-500/10 text-primary-600 dark:text-primary-400 flex items-center justify-center shrink-0">
          <Icon className="w-3.5 h-3.5" />
        </div>
        <h4 className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-700 dark:text-gray-200">
          {title}
        </h4>
        <div className="flex-1 h-px bg-gradient-to-r from-gray-200 to-transparent dark:from-slate-700" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{children}</div>
    </section>
  );
}

function ToggleCard({
  icon: Icon,
  title,
  description,
  checked,
  onChange,
}: {
  icon: ElementType;
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex items-start gap-3 w-full text-left rounded-xl border p-3.5 transition-all cursor-pointer",
        checked
          ? "border-primary-200 dark:border-primary-500/30 bg-primary-50/70 dark:bg-primary-500/10"
          : "border-gray-200 dark:border-slate-700 bg-gray-50/70 dark:bg-slate-800/40 hover:border-gray-300 dark:hover:border-slate-600"
      )}
    >
      <div
        className={cn(
          "w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-colors",
          checked
            ? "bg-primary-600 text-white shadow-md shadow-primary-500/25"
            : "bg-white dark:bg-slate-800 text-gray-400 dark:text-gray-500 border border-gray-200 dark:border-slate-700"
        )}
      >
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</p>
        <p className="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400 mt-0.5">
          {description}
        </p>
      </div>
      <span
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors mt-1",
          checked ? "bg-primary-600" : "bg-gray-300 dark:bg-slate-700"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all",
            checked ? "left-[22px]" : "left-0.5"
          )}
        />
      </span>
    </button>
  );
}

export default function HouseFormModal({
  isOpen,
  onClose,
  onSubmit,
  formData,
  setFormData,
  isEdit,
  loading,
}: Props) {
  const { t } = useLanguage();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showPassword, setShowPassword] = useState(false);
  const [geoStatus, setGeoStatus] = useState<"idle" | "locating" | "success" | "error">("idle");
  const [geoMessage, setGeoMessage] = useState("");
  const geoRequestRef = useRef(0);
  const formDataRef = useRef(formData);
  const detectLocationRef = useRef<(force: boolean) => void>(() => {});

  useEffect(() => {
    formDataRef.current = formData;
  }, [formData]);

  useEffect(() => {
    if (isOpen) {
      setErrors({});
      setShowPassword(false);
      setGeoStatus("idle");
      setGeoMessage("");
      // Ignore any in-flight geolocation callback from a previous opening.
      geoRequestRef.current += 1;
    }
  }, [isOpen, isEdit]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen, loading, onClose]);

  const formatCoord = (value: number) => String(Math.round(value * 1e6) / 1e6);

  const detectLocation = (force: boolean) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoStatus("error");
      setGeoMessage(t("houses.geo_unsupported"));
      return;
    }
    if (typeof window !== "undefined" && !window.isSecureContext) {
      setGeoStatus("error");
      setGeoMessage(t("houses.geo_insecure"));
      return;
    }

    const requestId = geoRequestRef.current + 1;
    geoRequestRef.current = requestId;
    setGeoStatus("locating");
    setGeoMessage(t("houses.geo_locating"));

    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (geoRequestRef.current !== requestId) return;
        const latitude = formatCoord(position.coords.latitude);
        const longitude = formatCoord(position.coords.longitude);
        const current = formDataRef.current ?? {};
        const hasLatitude = String(current.latitude ?? "").trim().length > 0;
        const hasLongitude = String(current.longitude ?? "").trim().length > 0;
        // Automatic fill never overwrites a manual entry; "Detect" always refreshes.
        setFormData({
          ...current,
          latitude: force || !hasLatitude ? latitude : current.latitude,
          longitude: force || !hasLongitude ? longitude : current.longitude,
        });
        setErrors((prev) => ({ ...prev, latitude: "", longitude: "" }));
        setGeoStatus("success");
        setGeoMessage(t("houses.geo_detected"));
      },
      (error) => {
        if (geoRequestRef.current !== requestId) return;
        setGeoStatus("error");
        setGeoMessage(
          error.code === error.PERMISSION_DENIED
            ? t("houses.geo_permission_denied")
            : error.code === error.TIMEOUT
              ? t("houses.geo_timeout")
              : t("houses.geo_unavailable")
        );
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  };

  useEffect(() => {
    detectLocationRef.current = detectLocation;
  });

  // Auto-fill coordinates from the device location when a fresh create form opens.
  useEffect(() => {
    if (!isOpen || isEdit) return;
    const current = formDataRef.current ?? {};
    if (String(current.latitude ?? "").trim() || String(current.longitude ?? "").trim()) return;
    detectLocationRef.current(false);
  }, [isOpen, isEdit]);

  const set = (key: string, value: any) => {
    setFormData({ ...formData, [key]: value });
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: "" }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    const next: Record<string, string> = {};
    if (!String(formData.name ?? "").trim()) next.name = t("houses.validation_name_required");
    if (!String(formData.code ?? "").trim()) next.code = t("houses.validation_code_required");
    const email = String(formData.email ?? "").trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      next.email = t("houses.validation_email_invalid");
    }
    const latitude = String(formData.latitude ?? "").trim();
    if (latitude && Number.isNaN(Number(latitude))) {
      next.latitude = t("houses.validation_latitude_invalid");
    }
    const longitude = String(formData.longitude ?? "").trim();
    if (longitude && Number.isNaN(Number(longitude))) {
      next.longitude = t("houses.validation_longitude_invalid");
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    await onSubmit({
      ...formData,
      name: String(formData.name).trim(),
      code: String(formData.code).trim(),
      email,
    });
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="house-form-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={() => !loading && onClose()}
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-sm p-0 sm:p-4"
        >
          <motion.div
            key="house-form-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="house-form-title"
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.97, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 16 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="w-full sm:max-w-3xl bg-white dark:bg-slate-900 h-[100dvh] sm:h-auto sm:max-h-[92vh] sm:rounded-3xl rounded-t-3xl sm:rounded-b-3xl shadow-2xl border border-gray-100 dark:border-slate-800 flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="relative shrink-0 overflow-hidden border-b border-gray-100 dark:border-slate-800">
              <div className="absolute inset-0 bg-gradient-to-r from-primary-50 via-white to-white dark:from-primary-500/10 dark:via-slate-900 dark:to-slate-900" />
              <div className="absolute -right-12 -top-20 h-40 w-40 rounded-full bg-primary-500/10 blur-2xl pointer-events-none" />
              <div className="relative flex items-start justify-between gap-4 px-5 sm:px-6 py-5">
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-700 text-white flex items-center justify-center shadow-lg shadow-primary-500/25 shrink-0">
                    <Building2 className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3
                        id="house-form-title"
                        className="text-lg font-bold text-gray-900 dark:text-gray-100"
                      >
                        {isEdit ? t("houses.modal_edit_title") : t("houses.modal_create_title")}
                      </h3>
                      {isEdit && formData?.code && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white/80 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-[11px] font-mono font-semibold text-gray-600 dark:text-gray-300">
                          <Hash className="w-3 h-3" />
                          {formData.code}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">
                      {t("houses.modal_subtitle")}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={loading}
                  aria-label={t("common.close")}
                  className="w-10 h-10 rounded-xl flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-white/70 dark:hover:bg-slate-800 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 shrink-0"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Body */}
            <form
              id="house-form"
              onSubmit={handleSubmit}
              className="flex flex-col flex-1 min-h-0"
              noValidate
            >
              <div className="flex-1 overflow-y-auto scrollbar-custom bg-gray-50/60 dark:bg-slate-950/30 px-4 sm:px-6 py-5 space-y-4">
                <Section icon={Building2} title={t("houses.section_basic")}>
                  <TextField
                    name="name"
                    label={t("houses.field_house_name")}
                    placeholder={t("houses.field_house_name_placeholder")}
                    icon={Building2}
                    value={formData.name}
                    onChange={(v) => set("name", v)}
                    error={errors.name}
                    required
                    autoFocus
                  />
                  <TextField
                    name="code"
                    label={t("houses.field_house_code")}
                    placeholder={t("houses.field_house_code_placeholder")}
                    icon={Hash}
                    value={formData.code}
                    onChange={(v) => set("code", v.toUpperCase())}
                    error={errors.code}
                    required
                  />
                  <TextField
                    name="email"
                    label={t("houses.field_email")}
                    type="email"
                    placeholder={t("houses.field_email_placeholder")}
                    icon={Mail}
                    value={formData.email}
                    onChange={(v) => set("email", v)}
                    error={errors.email}
                  />
                  <TextField
                    name="lifting_date"
                    label={t("houses.field_lifting_date")}
                    type="date"
                    icon={CalendarDays}
                    value={formData.lifting_date}
                    onChange={(v) => set("lifting_date", v)}
                  />
                </Section>

                <Section icon={MapPin} title={t("houses.section_location")}>
                  {!isEdit && (
                    <div
                      className={cn(
                        "sm:col-span-2 flex flex-wrap items-center gap-2.5 rounded-xl border px-3 py-2.5 transition-colors",
                        geoStatus === "error"
                          ? "border-amber-200 dark:border-amber-500/30 bg-amber-50/70 dark:bg-amber-500/10"
                          : geoStatus === "success"
                            ? "border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/70 dark:bg-emerald-500/10"
                            : "border-gray-200 dark:border-slate-700 bg-gray-50/70 dark:bg-slate-800/30"
                      )}
                    >
                      <span
                        className={cn(
                          "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                          geoStatus === "error"
                            ? "bg-amber-100 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400"
                            : geoStatus === "success"
                              ? "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                              : "bg-primary-50 dark:bg-primary-500/10 text-primary-600 dark:text-primary-400"
                        )}
                      >
                        {geoStatus === "locating" ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : geoStatus === "success" ? (
                          <CheckCircle2 className="w-4 h-4" />
                        ) : geoStatus === "error" ? (
                          <AlertTriangle className="w-4 h-4" />
                        ) : (
                          <LocateFixed className="w-4 h-4" />
                        )}
                      </span>
                      <p
                        aria-live="polite"
                        className={cn(
                          "flex-1 min-w-[150px] text-[11px] leading-relaxed",
                          geoStatus === "error"
                            ? "text-amber-700 dark:text-amber-300"
                            : geoStatus === "success"
                              ? "text-emerald-700 dark:text-emerald-300"
                              : "text-gray-500 dark:text-gray-400"
                        )}
                      >
                        {geoMessage || t("houses.geo_hint")}
                      </p>
                      <button
                        type="button"
                        onClick={() => detectLocation(true)}
                        disabled={geoStatus === "locating"}
                        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[11px] font-bold shrink-0 border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 hover:text-gray-900 dark:hover:text-gray-100 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {geoStatus === "locating" ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Crosshair className="w-3.5 h-3.5" />
                        )}
                        {geoStatus === "error"
                          ? t("houses.geo_retry")
                          : geoStatus === "success"
                            ? t("houses.geo_refresh")
                            : t("houses.geo_detect")}
                      </button>
                    </div>
                  )}
                  <TextField
                    name="cluster"
                    label={t("houses.field_cluster")}
                    placeholder={t("houses.field_cluster_placeholder")}
                    icon={Compass}
                    value={formData.cluster}
                    onChange={(v) => set("cluster", v)}
                  />
                  <TextField
                    name="region"
                    label={t("houses.field_region")}
                    placeholder={t("houses.field_region_placeholder")}
                    icon={MapPinned}
                    value={formData.region}
                    onChange={(v) => set("region", v)}
                  />
                  <TextField
                    name="wh_region"
                    label={t("houses.field_wh_region")}
                    placeholder={t("houses.field_wh_region_placeholder")}
                    icon={MapPinned}
                    value={formData.wh_region}
                    onChange={(v) => set("wh_region", v)}
                  />
                  <TextField
                    name="district"
                    label={t("houses.field_district")}
                    placeholder={t("houses.field_district_placeholder")}
                    icon={MapPin}
                    value={formData.district}
                    onChange={(v) => set("district", v)}
                  />
                  <TextField
                    name="latitude"
                    label={t("houses.field_latitude")}
                    type="number"
                    step="any"
                    placeholder={t("houses.field_latitude_placeholder")}
                    icon={Compass}
                    value={formData.latitude}
                    onChange={(v) => set("latitude", v)}
                    error={errors.latitude}
                  />
                  <TextField
                    name="longitude"
                    label={t("houses.field_longitude")}
                    type="number"
                    step="any"
                    placeholder={t("houses.field_longitude_placeholder")}
                    icon={Compass}
                    value={formData.longitude}
                    onChange={(v) => set("longitude", v)}
                    error={errors.longitude}
                  />
                  <TextField
                    name="bts_id"
                    label={t("houses.field_bts_id")}
                    placeholder={t("houses.field_bts_id_placeholder")}
                    icon={RadioTower}
                    value={formData.bts_id}
                    onChange={(v) => set("bts_id", v)}
                  />
                  <TextField
                    name="address"
                    label={t("houses.field_address")}
                    placeholder={t("houses.field_address_placeholder")}
                    icon={MapPin}
                    value={formData.address}
                    onChange={(v) => set("address", v)}
                    className="sm:col-span-2"
                  />
                </Section>

                <Section icon={Users} title={t("houses.section_contact")}>
                  <TextField
                    name="proprietor_name"
                    label={t("houses.field_proprietor_name")}
                    placeholder={t("houses.field_proprietor_name_placeholder")}
                    icon={User}
                    value={formData.proprietor_name}
                    onChange={(v) => set("proprietor_name", v)}
                  />
                  <TextField
                    name="proprietor_contact"
                    label={t("houses.field_proprietor_contact")}
                    type="tel"
                    placeholder={t("houses.field_proprietor_contact_placeholder")}
                    icon={Phone}
                    value={formData.proprietor_contact}
                    onChange={(v) => set("proprietor_contact", v)}
                  />
                  <TextField
                    name="poc_name"
                    label={t("houses.field_poc_name")}
                    placeholder={t("houses.field_poc_name_placeholder")}
                    icon={User}
                    value={formData.poc_name}
                    onChange={(v) => set("poc_name", v)}
                  />
                  <TextField
                    name="poc_mobile"
                    label={t("houses.field_poc_mobile")}
                    type="tel"
                    placeholder={t("houses.field_poc_mobile_placeholder")}
                    icon={Phone}
                    value={formData.poc_mobile}
                    onChange={(v) => set("poc_mobile", v)}
                  />
                </Section>

                <Section icon={Database} title={t("houses.section_dms")}>
                  <TextField
                    name="dms_house_id"
                    label={t("houses.field_dms_house_id")}
                    placeholder={t("houses.field_dms_house_id_placeholder")}
                    icon={Hash}
                    value={formData.dms_house_id}
                    onChange={(v) => set("dms_house_id", v)}
                  />
                  <TextField
                    name="dms_user"
                    label={t("houses.field_dms_user")}
                    placeholder={t("houses.field_dms_user_placeholder")}
                    icon={User}
                    value={formData.dms_user}
                    onChange={(v) => set("dms_user", v)}
                  />
                  <TextField
                    name="dms_pass"
                    label={t("houses.field_dms_pass")}
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    icon={Database}
                    value={formData.dms_pass}
                    onChange={(v) => set("dms_pass", v)}
                    trailing={
                      <button
                        type="button"
                        onClick={() => setShowPassword((prev) => !prev)}
                        aria-label={
                          showPassword ? t("houses.password_hide") : t("houses.password_show")
                        }
                        className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    }
                  />
                </Section>

                <Section icon={ShieldCheck} title={t("houses.section_preferences")}>
                  <ToggleCard
                    icon={ShieldCheck}
                    title={t("houses.field_status")}
                    description={t("houses.field_status_hint")}
                    checked={!!formData.is_active}
                    onChange={(v) => set("is_active", v)}
                  />
                  <ToggleCard
                    icon={RadioTower}
                    title={t("houses.field_show_pull_button")}
                    description={t("houses.field_show_pull_button_hint")}
                    checked={!!formData.show_pull_button}
                    onChange={(v) => set("show_pull_button", v)}
                  />
                </Section>
              </div>

              {/* Footer */}
              <div className="shrink-0 border-t border-gray-100 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur px-4 sm:px-6 py-4 flex items-center gap-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={loading}
                  className="flex-1 sm:flex-none sm:px-6 h-11 rounded-xl text-sm font-bold text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t("houses.btn_cancel")}
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-[2] sm:flex-none sm:min-w-[220px] sm:ml-auto h-11 rounded-xl bg-gradient-to-r from-primary-600 to-primary-700 text-white text-sm font-bold shadow-lg shadow-primary-500/20 hover:shadow-primary-500/30 hover:from-primary-500 hover:to-primary-600 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  {loading
                    ? t("common.processing")
                    : isEdit
                      ? t("houses.btn_update")
                      : t("houses.btn_create")}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
