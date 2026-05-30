"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import apiClient from "@/lib/api";
import { toast } from "react-hot-toast";
import { 
  User, 
  Mail, 
  Phone, 
  Lock, 
  Save, 
  Camera, 
  ShieldCheck,
  Building2,
  Calendar,
  Loader2,
  Briefcase,
  Banknote,
  CreditCard,
  MapPin,
  Home,
  Smartphone,
  Shield,
  Users2,
  Store,
  Activity,
  Network,
  SmartphoneNfc,
  ChevronDown,
  X,
  BookUser
} from "lucide-react";
import { motion } from "framer-motion";
import { useLanguage } from "@/i18n/useLanguage";

function InputField({ label, value, onChange, type = "text", icon: Icon, error }: { label: string; value: any; onChange: (v: string) => void; type?: string; icon?: any; error?: string }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-bold text-gray-400 uppercase tracking-widest ml-1">{label}</label>
      <div className="relative">
        {Icon && (
          <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        )}
        <input 
          type={type}
          className={cn(
            "w-full p-2.5 bg-gray-50 dark:bg-slate-800 border rounded-xl text-sm outline-none transition-all dark:text-gray-100",
            Icon ? "pl-10" : "px-3",
            error
              ? "border-red-500/50 focus:border-red-500 ring-1 ring-red-500/10"
              : "border-transparent focus:ring-1 focus:ring-primary-500 focus:bg-white dark:focus:bg-slate-800"
          )}
          value={value || ""}
          onChange={e => onChange(e.target.value)}
        />
      </div>
      {error && <p className="text-[11px] text-red-500 mt-0.5">{error}</p>}
    </div>
  );
}

function SelectField({ label, value, onChange, icon: Icon, options, error }: { label: string; value: any; onChange: (v: string) => void; icon?: any; options: {value: string; label: string}[]; error?: string }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-bold text-gray-400 uppercase tracking-widest ml-1">{label}</label>
      <div className="relative">
        {Icon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
            <Icon className="w-4 h-4 text-gray-400" />
          </div>
        )}
        <select 
          className={cn(
            "w-full p-2.5 bg-gray-50 dark:bg-slate-800 border rounded-xl text-sm dark:text-gray-100 outline-none transition-all appearance-none",
            Icon ? "pl-10" : "px-3",
            error
              ? "border-red-500/50 ring-1 ring-red-500/10"
              : "border-transparent focus:ring-1 focus:ring-primary-500 focus:bg-white dark:focus:bg-slate-800"
          )}
          value={value || ""}
          onChange={e => onChange(e.target.value)}
        >
          <option value="">Select...</option>
          {options.map((opt: any) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
      </div>
      {error && <p className="text-[11px] text-red-500 mt-0.5">{error}</p>}
    </div>
  );
}

function cn(...classes: any[]) {
  return classes.filter(Boolean).join(" ");
}

interface EmployeeProfile {
  id: number;
  user_id: number;
  house_id: number;
  house?: { id: number; name: string; code: string };
  user?: any;
  dms_code: string;
  itop_number: string;
  personal_number: string;
  pool_number: string;
  status: string;
  assisted_retailer_code: string;
  agency_id: string;
  market_type: string;
  salary: string;
  joining_date: string;
  resigned_date: string;
  nid: string;
  dob: string;
  blood_group: string;
  religion: string;
  home_town: string;
  fathers_name: string;
  mothers_name: string;
  last_education: string;
  institution_name: string;
  present_address: string;
  permanent_address: string;
  bank_name: string;
  bank_account: string;
  branch_name: string;
  routing_number: string;
  emergency_contact_person_name: string;
  emergency_contact_person_number: string;
  emergency_person_relationship: string;
  previous_company_name: string;
  previous_company_salary: string;
  motor_bike: string;
  bicyle: string;
  driving_license: string;
}

export default function ProfilePage() {
  const { user, refreshStatus } = useAuth();
  const { t } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [empLoading, setEmpLoading] = useState(false);
  const [empFetchLoading, setEmpFetchLoading] = useState(true);
  const [empData, setEmpData] = useState<EmployeeProfile | null>(null);
  const [empForm, setEmpForm] = useState<any>({});
  const [empErrors, setEmpErrors] = useState<Record<string, string>>({});

  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone_number: "",
    telegram_id: "",
    password: "",
    confirmPassword: ""
  });
  const [profilePic, setProfilePic] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    if (user) {
      setFormData({
        name: user.name || "",
        email: user.email || "",
        phone_number: user.phone_number || "",
        telegram_id: user.telegram_id?.toString() || "",
        password: "",
        confirmPassword: ""
      });
      setProfilePic(user.profile_pic ? `${process.env.NEXT_PUBLIC_API_URL?.replace("/api", "")}${user.profile_pic}` : null);
      fetchEmployeeProfile();
    }
  }, [user]);

  const fetchEmployeeProfile = async () => {
    setEmpFetchLoading(true);
    try {
      const res = await apiClient.get("employees/me");
      setEmpData(res.data);
      setEmpForm({
        itop_number: res.data.itop_number || "",
        personal_number: res.data.personal_number || "",
        pool_number: res.data.pool_number || "",
        assisted_retailer_code: res.data.assisted_retailer_code || "",
        agency_id: res.data.agency_id || "",
        market_type: res.data.market_type || "",
        salary: res.data.salary || "",
        joining_date: res.data.joining_date || "",
        resigned_date: res.data.resigned_date || "",
        nid: res.data.nid || "",
        dob: res.data.dob || "",
        blood_group: res.data.blood_group || "",
        religion: res.data.religion || "",
        home_town: res.data.home_town || "",
        fathers_name: res.data.fathers_name || "",
        mothers_name: res.data.mothers_name || "",
        last_education: res.data.last_education || "",
        institution_name: res.data.institution_name || "",
        present_address: res.data.present_address || "",
        permanent_address: res.data.permanent_address || "",
        bank_name: res.data.bank_name || "",
        bank_account: res.data.bank_account || "",
        branch_name: res.data.branch_name || "",
        routing_number: res.data.routing_number || "",
        emergency_contact_person_name: res.data.emergency_contact_person_name || "",
        emergency_contact_person_number: res.data.emergency_contact_person_number || "",
        emergency_person_relationship: res.data.emergency_person_relationship || "",
        previous_company_name: res.data.previous_company_name || "",
        previous_company_salary: res.data.previous_company_salary || "",
        motor_bike: res.data.motor_bike || "",
        bicyle: res.data.bicyle || "",
        driving_license: res.data.driving_license || "",
      });
    } catch (err: any) {
      if (err.response?.status !== 404) {
        console.error("Failed to fetch employee profile", err);
      }
    } finally {
      setEmpFetchLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const uploadData = new FormData();
    uploadData.append("file", file);

    setIsUploading(true);
    try {
      const response = await apiClient.post("auth/profile-pic", uploadData);
      const newPicUrl = response.data.url;
      setProfilePic(`${process.env.NEXT_PUBLIC_API_URL?.replace("/api", "")}${newPicUrl}`);
      toast.success(t('profile.toast_pic_updated'));
    } catch (err: any) {
      toast.error(t('profile.toast_pic_failed'));
    } finally {
      setIsUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (formData.password && formData.password !== formData.confirmPassword) {
      toast.error(t('profile.toast_pass_mismatch'));
      return;
    }

    setLoading(true);
    try {
      const updateData = {
        name: formData.name,
        email: formData.email,
        phone_number: formData.phone_number,
        telegram_id: formData.telegram_id ? parseInt(formData.telegram_id) : null,
        ...(formData.password ? { password: formData.password } : {})
      };

      await apiClient.put("auth/profile", updateData);
      toast.success(t('profile.toast_update_success'));
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to update profile");
    } finally {
      setLoading(false);
    }
  };

  const handleEmpFieldChange = (field: string, value: any) => {
    setEmpForm((prev: any) => ({ ...prev, [field]: value }));
  };

  const handleEmpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmpLoading(true);
    setEmpErrors({});
    try {
      await apiClient.put("employees/me", empForm);
      toast.success("Employee profile updated!");
      fetchEmployeeProfile();
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      if (Array.isArray(detail)) {
        const errors: Record<string, string> = {};
        detail.forEach((e: any) => {
          const field = e.loc?.[e.loc.length - 1];
          if (field) errors[field] = e.msg;
        });
        setEmpErrors(errors);
      } else {
        toast.error(detail || "Failed to update employee profile");
      }
    } finally {
      setEmpLoading(false);
    }
  };

  if (!user) return null;

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500 pb-20">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-gray-100 dark:border-slate-800">
        <div className="flex items-center gap-5">
          <div className="relative group">
            <div className="w-24 h-24 rounded-3xl bg-primary-500 flex items-center justify-center text-white text-4xl font-black shadow-2xl shadow-primary-200 dark:shadow-none transition-transform duration-300 group-hover:scale-105 overflow-hidden border-4 border-white dark:border-slate-900">
              {profilePic ? (
                <img src={profilePic} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                user.name?.charAt(0) || "U"
              )}
              {isUploading && (
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 text-white animate-spin" />
                </div>
              )}
            </div>
            <label className="absolute -bottom-2 -right-2 p-2 bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-gray-100 dark:border-slate-700 text-gray-500 hover:text-primary-500 transition-all cursor-pointer">
              <Camera className="w-4 h-4" />
              <input type="file" className="hidden" accept="image/*" onChange={handleFileChange} disabled={isUploading} />
            </label>
          </div>
          <div>
            <h1 className="text-3xl font-black text-gray-900 dark:text-gray-100 tracking-tight">{user.name}</h1>
            <div className="flex items-center gap-2 mt-1 text-gray-500 dark:text-gray-400">
              <span className="text-sm font-medium">@{user.username}</span>
              <span className="w-1 h-1 rounded-full bg-gray-300 dark:bg-slate-700" />
              <div className="flex items-center gap-1 px-2 py-0.5 bg-primary-50 dark:bg-primary-500/10 text-primary-600 dark:text-primary-400 rounded-full text-[10px] font-bold uppercase tracking-wider">
                <ShieldCheck className="w-3 h-3" />
                {user.roles?.[0]?.name || "User"}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-gray-100 dark:border-slate-800 shadow-sm">
            <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">{t('profile.quick_stats')}</h3>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center text-blue-600 dark:text-blue-400">
                  <Building2 className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-[10px] text-gray-400 font-bold uppercase">{t('profile.assigned_houses')}</p>
                  <p className="text-sm font-bold dark:text-gray-200">{t('profile.houses_count', { count: user.houses?.length || 0 })}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-purple-50 dark:bg-purple-500/10 flex items-center justify-center text-purple-600 dark:text-purple-400">
                  <Calendar className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-[10px] text-gray-400 font-bold uppercase">{t('profile.account_status')}</p>
                  <p className="text-sm font-bold text-green-500 capitalize">{user.status}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-primary-500 p-6 rounded-3xl shadow-xl shadow-primary-200 dark:shadow-none text-white overflow-hidden relative">
            <div className="relative z-10">
              <h3 className="text-xs font-black text-white/60 uppercase tracking-widest mb-2">{t('profile.need_help')}</h3>
              <p className="text-sm font-medium leading-relaxed">{t('profile.help_text')}</p>
            </div>
            <div className="absolute -right-8 -bottom-8 w-32 h-32 bg-white/10 rounded-full blur-3xl" />
          </div>
        </div>

        <div className="lg:col-span-2 space-y-8">
          {/* Account Settings */}
          <form onSubmit={handleSubmit} className="bg-white dark:bg-slate-900 p-8 rounded-3xl border border-gray-100 dark:border-slate-800 shadow-sm space-y-6">
            <h3 className="text-lg font-black text-gray-900 dark:text-gray-100 tracking-tight flex items-center gap-2">
              <User className="w-5 h-5 text-primary-500" />
              {t('profile.account_settings')}
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">{t('profile.field_name')}</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleInputChange}
                    className="w-full pl-10 pr-4 py-3 bg-gray-50 dark:bg-slate-800 border-none rounded-xl text-sm focus:ring-2 focus:ring-primary-500 transition-all outline-none"
                    placeholder={t('profile.field_name_placeholder')}
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">{t('profile.field_email')}</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleInputChange}
                    className="w-full pl-10 pr-4 py-3 bg-gray-50 dark:bg-slate-800 border-none rounded-xl text-sm focus:ring-2 focus:ring-primary-500 transition-all outline-none"
                    placeholder={t('profile.field_email_placeholder')}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">{t('profile.field_phone')}</label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    name="phone_number"
                    value={formData.phone_number}
                    onChange={handleInputChange}
                    className="w-full pl-10 pr-4 py-3 bg-gray-50 dark:bg-slate-800 border-none rounded-xl text-sm focus:ring-2 focus:ring-primary-500 transition-all outline-none"
                    placeholder={t('profile.field_phone_placeholder')}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">{t('profile.field_telegram')}</label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    name="telegram_id"
                    value={formData.telegram_id}
                    onChange={handleInputChange}
                    className="w-full pl-10 pr-4 py-3 bg-gray-50 dark:bg-slate-800 border-none rounded-xl text-sm focus:ring-2 focus:ring-primary-500 transition-all outline-none"
                    placeholder={t('profile.field_telegram_placeholder')}
                  />
                </div>
              </div>
            </div>

            <div className="pt-6 border-t border-gray-50 dark:border-slate-800">
              <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                <Lock className="w-3.5 h-3.5" />
                {t('profile.security_title')}
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">{t('profile.field_new_password')}</label>
                  <input
                    type="password"
                    name="password"
                    value={formData.password}
                    onChange={handleInputChange}
                    className="w-full px-4 py-3 bg-gray-50 dark:bg-slate-800 border-none rounded-xl text-sm focus:ring-2 focus:ring-primary-500 transition-all outline-none"
                    placeholder={t('profile.field_new_password_placeholder')}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">{t('profile.field_confirm_password')}</label>
                  <input
                    type="password"
                    name="confirmPassword"
                    value={formData.confirmPassword}
                    onChange={handleInputChange}
                    className="w-full px-4 py-3 bg-gray-50 dark:bg-slate-800 border-none rounded-xl text-sm focus:ring-2 focus:ring-primary-500 transition-all outline-none"
                    placeholder={t('profile.field_confirm_password_placeholder')}
                  />
                </div>
              </div>
            </div>

            <div className="pt-4">
              <button
                type="submit"
                disabled={loading}
                className="w-full md:w-auto px-8 py-3 bg-primary-500 hover:bg-primary-600 disabled:bg-primary-300 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-primary-200 dark:shadow-none transition-all active:scale-95"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                {t('profile.btn_save')}
              </button>
            </div>
          </form>

          {/* Employee Profile */}
          {empFetchLoading ? (
            <div className="bg-white dark:bg-slate-900 p-8 rounded-3xl border border-gray-100 dark:border-slate-800 shadow-sm flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : empData ? (
            <form onSubmit={handleEmpSubmit} className="bg-white dark:bg-slate-900 p-8 rounded-3xl border border-gray-100 dark:border-slate-800 shadow-sm space-y-8">
              <h3 className="text-lg font-black text-gray-900 dark:text-gray-100 tracking-tight flex items-center gap-2">
                <BookUser className="w-5 h-5 text-primary-500" />
                Employee Profile
              </h3>

              {/* Read-only info */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-primary-50 dark:bg-primary-500/5 rounded-2xl border border-primary-100 dark:border-primary-500/10">
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">DMS Code</p>
                  <p className="text-sm font-bold dark:text-gray-200">{empData.dms_code}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">House</p>
                  <p className="text-sm font-bold dark:text-gray-200">{empData.house?.name || "—"}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Status</p>
                  <p className="text-sm font-bold text-green-500 capitalize">{empData.status}</p>
                </div>
              </div>

              {/* Professional Details */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b dark:border-slate-800">
                  <Briefcase className="w-4 h-4 text-blue-500" />
                  <h4 className="text-[11px] font-bold text-gray-900 dark:text-gray-100 uppercase tracking-widest">{t('employees.section_professional')}</h4>
                </div>
                {/* Read-only fields */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4 bg-gray-50 dark:bg-slate-800/50 rounded-2xl">
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('employees.field_itop')}</p>
                    <p className="text-sm font-bold dark:text-gray-200">{empForm.itop_number || "—"}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('employees.field_pool_number')}</p>
                    <p className="text-sm font-bold dark:text-gray-200">{empForm.pool_number || "—"}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('employees.field_joining_date')}</p>
                    <p className="text-sm font-bold dark:text-gray-200">{empForm.joining_date || "—"}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('employees.field_salary')}</p>
                    <p className="text-sm font-bold dark:text-gray-200">{empForm.salary || "—"}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('employees.field_assisted_retailer')}</p>
                    <p className="text-sm font-bold dark:text-gray-200">{empForm.assisted_retailer_code || "—"}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('employees.field_agency_id')}</p>
                    <p className="text-sm font-bold dark:text-gray-200">{empForm.agency_id || "—"}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t('employees.field_market_type')}</p>
                    <p className="text-sm font-bold dark:text-gray-200">{empForm.market_type || "—"}</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  <InputField label={t('employees.field_personal_number')} type="tel" icon={Phone} value={empForm.personal_number} onChange={(v) => handleEmpFieldChange("personal_number", v)} error={empErrors.personal_number} />
                </div>
              </div>

              {/* Personal Information */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b dark:border-slate-800">
                  <User className="w-4 h-4 text-purple-500" />
                  <h4 className="text-[11px] font-bold text-gray-900 dark:text-gray-100 uppercase tracking-widest">{t('employees.section_personal')}</h4>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  <InputField label={t('employees.field_nid')} icon={CreditCard} value={empForm.nid} onChange={(v) => handleEmpFieldChange("nid", v)} />
                  <InputField label={t('employees.field_dob')} icon={Calendar} type="date" value={empForm.dob} onChange={(v) => handleEmpFieldChange("dob", v)} error={empErrors.dob} />
                  <SelectField label={t('employees.field_blood_group')} icon={Activity} value={empForm.blood_group} onChange={(v) => handleEmpFieldChange("blood_group", v)} options={[
                    {value:"A+",label:"A+"},{value:"A-",label:"A-"},{value:"B+",label:"B+"},{value:"B-",label:"B-"},
                    {value:"AB+",label:"AB+"},{value:"AB-",label:"AB-"},{value:"O+",label:"O+"},{value:"O-",label:"O-"}
                  ]} />
                  <SelectField label={t('employees.field_religion')} icon={User} value={empForm.religion} onChange={(v) => handleEmpFieldChange("religion", v)} options={[
                    {value:"Islam",label:"Islam"},{value:"Hindu",label:"Hindu"},{value:"Christian",label:"Christian"},{value:"Buddhist",label:"Buddhist"},{value:"Others",label:"Others"}
                  ]} />
                  <InputField label={t('employees.field_home_town')} icon={Home} value={empForm.home_town} onChange={(v) => handleEmpFieldChange("home_town", v)} />
                  <InputField label={t('employees.field_father_name')} icon={User} value={empForm.fathers_name} onChange={(v) => handleEmpFieldChange("fathers_name", v)} />
                  <InputField label={t('employees.field_mother_name')} icon={User} value={empForm.mothers_name} onChange={(v) => handleEmpFieldChange("mothers_name", v)} />
                  <SelectField label={t('employees.field_education')} icon={Briefcase} value={empForm.last_education} onChange={(v) => handleEmpFieldChange("last_education", v)} options={[
                    {value:"SSC",label:"SSC"},{value:"HSC",label:"HSC"},{value:"Honours",label:"Honours"},{value:"Masters",label:"Masters"},{value:"Others",label:"Others"}
                  ]} />
                  <InputField label={t('employees.field_institution')} icon={Store} value={empForm.institution_name} onChange={(v) => handleEmpFieldChange("institution_name", v)} />
                  <div className="lg:col-span-2">
                    <InputField label={t('employees.field_present_address')} icon={MapPin} value={empForm.present_address} onChange={(v) => handleEmpFieldChange("present_address", v)} />
                  </div>
                  <div className="lg:col-span-2">
                    <InputField label={t('employees.field_permanent_address')} icon={MapPin} value={empForm.permanent_address} onChange={(v) => handleEmpFieldChange("permanent_address", v)} />
                  </div>
                </div>
              </div>

              {/* Bank Details */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b dark:border-slate-800">
                  <Building2 className="w-4 h-4 text-emerald-500" />
                  <h4 className="text-[11px] font-bold text-gray-900 dark:text-gray-100 uppercase tracking-widest">{t('employees.section_bank')}</h4>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  <InputField label={t('employees.field_bank_name')} icon={Store} value={empForm.bank_name} onChange={(v) => handleEmpFieldChange("bank_name", v)} />
                  <InputField label={t('employees.field_account_number')} icon={CreditCard} value={empForm.bank_account} onChange={(v) => handleEmpFieldChange("bank_account", v)} />
                  <InputField label={t('employees.field_branch_name')} icon={MapPin} value={empForm.branch_name} onChange={(v) => handleEmpFieldChange("branch_name", v)} />
                  <InputField label={t('employees.field_routing_number')} icon={Network} value={empForm.routing_number} onChange={(v) => handleEmpFieldChange("routing_number", v)} />
                </div>
              </div>

              {/* Emergency Contact */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b dark:border-slate-800">
                  <Users2 className="w-4 h-4 text-red-500" />
                  <h4 className="text-[11px] font-bold text-gray-900 dark:text-gray-100 uppercase tracking-widest">{t('employees.section_emergency')}</h4>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  <InputField label={t('employees.field_emergency_contact')} icon={User} value={empForm.emergency_contact_person_name} onChange={(v) => handleEmpFieldChange("emergency_contact_person_name", v)} />
                  <InputField label={t('employees.field_emergency_phone')} type="tel" icon={Phone} value={empForm.emergency_contact_person_number} onChange={(v) => handleEmpFieldChange("emergency_contact_person_number", v)} error={empErrors.emergency_contact_person_number} />
                  <InputField label={t('employees.field_emergency_relation')} icon={Users2} value={empForm.emergency_person_relationship} onChange={(v) => handleEmpFieldChange("emergency_person_relationship", v)} />
                </div>
              </div>

              {/* Experience & Assets */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b dark:border-slate-800">
                  <Briefcase className="w-4 h-4 text-amber-500" />
                  <h4 className="text-[11px] font-bold text-gray-900 dark:text-gray-100 uppercase tracking-widest">{t('employees.section_experience')}</h4>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  <InputField label={t('employees.field_prev_company')} icon={Briefcase} value={empForm.previous_company_name} onChange={(v) => handleEmpFieldChange("previous_company_name", v)} />
                  <InputField label={t('employees.field_prev_salary')} type="number" icon={Banknote} value={empForm.previous_company_salary} onChange={(v) => handleEmpFieldChange("previous_company_salary", v)} error={empErrors.previous_company_salary} />
                  <SelectField label={t('employees.field_motor_bike')} icon={Activity} value={empForm.motor_bike} onChange={(v) => handleEmpFieldChange("motor_bike", v)} options={[{value:"Yes",label:"Yes"},{value:"No",label:"No"}]} error={empErrors.motor_bike} />
                  <SelectField label={t('employees.field_bicycle')} icon={Activity} value={empForm.bicyle} onChange={(v) => handleEmpFieldChange("bicyle", v)} options={[{value:"Yes",label:"Yes"},{value:"No",label:"No"}]} error={empErrors.bicyle} />
                  <SelectField label={t('employees.field_driving_license')} icon={Activity} value={empForm.driving_license} onChange={(v) => handleEmpFieldChange("driving_license", v)} options={[{value:"Yes",label:"Yes"},{value:"No",label:"No"}]} error={empErrors.driving_license} />
                </div>
              </div>

              <div className="pt-4 border-t border-gray-100 dark:border-slate-800">
                <button
                  type="submit"
                  disabled={empLoading}
                  className="w-full md:w-auto px-8 py-3 bg-primary-500 hover:bg-primary-600 disabled:bg-primary-300 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-primary-200 dark:shadow-none transition-all active:scale-95"
                >
                  {empLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  {t('profile.btn_save')}
                </button>
              </div>
            </form>
          ) : (
            <div className="bg-white dark:bg-slate-900 p-8 rounded-3xl border border-gray-100 dark:border-slate-800 shadow-sm">
              <div className="text-center py-12">
                <BookUser className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
                <h3 className="text-lg font-bold dark:text-gray-200">No Employee Profile</h3>
                <p className="text-sm text-gray-500 mt-1">You are not assigned to an employee profile yet.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
