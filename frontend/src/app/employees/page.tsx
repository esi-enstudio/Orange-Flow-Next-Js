"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { 
  Users2, 
  Plus, 
  Search, 
  Trash2, 
  ChevronLeft, 
  ChevronRight,
  ChevronDown,
  Loader2,
  X,
  Check,
  Edit2,
  Phone,
  Briefcase,
  Store,
  User,
  CreditCard,
  MapPin,
  Calendar,
  Home,
  Banknote,
  Smartphone,
  SmartphoneNfc,
  Shield,
  ShieldCheck,
  Activity,
  Network,
  ClipboardList,
  Upload,
  Download,
  FileSpreadsheet,
  Eye
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "react-hot-toast";
import { useRef } from "react";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { useLanguage } from "@/i18n/useLanguage";

interface Employee {
  id: number;
  user_id?: number;
  user?: User;
  house_id?: number;
  house?: House;
  dms_code: string;
  itop_number: string;
  personal_number: string;
  status: string;
  joining_date: string;
  salary: string;
  market_type: string;
  itop_sr_number?: string;
  pool_number?: string;
  agency_id?: string;
  assisted_retailer_code?: string;
  bank_name?: string;
  bank_account?: string;
  branch_name?: string;
  routing_number?: string;
  home_town?: string;
  emergency_contact_person_name?: string;
  emergency_contact_person_number?: string;
  emergency_person_relationship?: string;
  last_education?: string;
  institution_name?: string;
  blood_group?: string;
  present_address?: string;
  permanent_address?: string;
  fathers_name?: string;
  mothers_name?: string;
  religion?: string;
  dob?: string;
  nid?: string;
  previous_company_name?: string;
  previous_company_salary?: string;
  motor_bike?: string;
  bicyle?: string;
  driving_license?: string;
  resigned_date?: string;
}

interface House {
  id: number;
  name: string;
  code: string;
}

interface Role {
  id: number;
  name: string;
}

interface User {
  id: number;
  name: string;
  username: string;
  roles?: Role[];
  profile_pic?: string;
}

function InputField({ label, value, onChange, required, type = "text", icon: Icon, error }: any) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-bold text-gray-500 uppercase">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <div className="relative group">
        {Icon && (
          <div className={cn(
            "absolute left-3 top-1/2 -translate-y-1/2 transition-colors",
            error ? "text-red-500" : "text-gray-400 group-focus-within:text-primary-500"
          )}>
            <Icon className="w-4 h-4" />
          </div>
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
          required={required}
        />
      </div>
      {error && <p className="text-[11px] text-red-500 mt-0.5">{error}</p>}
    </div>
  );
}

function FieldRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-baseline gap-2 py-1.5 border-b border-gray-50 dark:border-slate-800/50">
      <span className="text-[11px] font-bold text-gray-400 uppercase shrink-0 w-[110px]">{label}</span>
      <span className="text-sm font-bold dark:text-gray-200 truncate">{value || "—"}</span>
    </div>
  );
}

function profilePicUrl(pic?: string): string | null {
  if (!pic) return null;
  return `${process.env.NEXT_PUBLIC_API_URL?.replace("/api", "")}${pic}`;
}

export default function EmployeesPage() {
  const { t } = useLanguage();
  const { hasPermission, loading: authLoading, selectedHouse } = useAuth();
  const [members, setMembers] = useState<Employee[]>([]);
  const [houses, setHouses] = useState<House[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const limit = 5;

  // Form State
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [formData, setFormData] = useState({
    user_id: undefined as number | undefined,
    house_id: undefined as number | undefined,
    dms_code: "",
    itop_number: "",
    personal_number: "",
    status: "Active",
    joining_date: "",
    resigned_date: "",
    salary: "",
    market_type: "Urban",
    assisted_retailer_code: "",
    agency_id: "",
    pool_number: "",
    bank_name: "",
    bank_account: "",
    branch_name: "",
    routing_number: "",
    home_town: "",
    emergency_contact_person_name: "",
    emergency_contact_person_number: "",
    emergency_person_relationship: "",
    last_education: "",
    institution_name: "",
    blood_group: "",
    present_address: "",
    permanent_address: "",
    fathers_name: "",
    mothers_name: "",
    religion: "",
    dob: "",
    nid: "",
    previous_company_name: "",
    previous_company_salary: "",
    motor_bike: "No",
    bicyle: "No",
    driving_license: "No",
  });
  const [formLoading, setFormLoading] = useState(false);
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<Employee | null>(null);

  // View Modal
  const [viewingMember, setViewingMember] = useState<Employee | null>(null);
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);

  // Delete Confirmation
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // Import/Export Progress
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importResults, setImportResults] = useState<{success: number, error: number} | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isExporting, setIsExporting] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [empRes, housesRes, usersRes] = await Promise.all([
        apiClient.get("employees"),
        apiClient.get("houses"),
        apiClient.get("users")
      ]);
      setMembers(empRes.data);
      setHouses(housesRes.data);
      setUsers(usersRes.data);
    } catch (err) {
      toast.error(t('employees.toast_load_failed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && hasPermission("view_employees")) {
      fetchData();
    }
  }, [selectedHouse, authLoading, hasPermission]);

  const openViewModal = (m: Employee) => {
    setViewingMember(m);
    setIsViewModalOpen(true);
  };

  const openAddModal = () => {
    setEditingMember(null);
    setFormErrors({});
    setFormData({
      user_id: undefined,
      house_id: selectedHouse?.id || undefined,
      dms_code: "",
      itop_number: "",
      personal_number: "",
      status: "Active",
      joining_date: new Date().toISOString().split('T')[0],
      resigned_date: "",
      salary: "",
      market_type: "Urban",
      assisted_retailer_code: "",
      agency_id: "",
      pool_number: "",
      bank_name: "",
      bank_account: "",
      branch_name: "",
      routing_number: "",
      home_town: "",
      emergency_contact_person_name: "",
      emergency_contact_person_number: "",
      emergency_person_relationship: "",
      last_education: "",
      institution_name: "",
      blood_group: "",
      present_address: "",
      permanent_address: "",
      fathers_name: "",
      mothers_name: "",
      religion: "",
      dob: "",
      nid: "",
      previous_company_name: "",
      previous_company_salary: "",
      motor_bike: "No",
      bicyle: "No",
      driving_license: "No",
    });
    setIsFormModalOpen(true);
  };

  const openEditModal = (m: Employee) => {
    setEditingMember(m);
    setFormErrors({});
    setFormData({
      user_id: m.user_id,
      house_id: m.house_id,
      dms_code: m.dms_code,
      itop_number: m.itop_number,
      personal_number: m.personal_number,
      status: m.status || "Active",
      joining_date: m.joining_date || "",
      resigned_date: m.resigned_date || "",
      salary: m.salary || "",
      market_type: m.market_type || "Urban",
      assisted_retailer_code: m.assisted_retailer_code || "",
      agency_id: m.agency_id || "",
      pool_number: m.pool_number || "",
      bank_name: m.bank_name || "",
      bank_account: m.bank_account || "",
      branch_name: m.branch_name || "",
      routing_number: m.routing_number || "",
      home_town: m.home_town || "",
      emergency_contact_person_name: m.emergency_contact_person_name || "",
      emergency_contact_person_number: m.emergency_contact_person_number || "",
      emergency_person_relationship: m.emergency_person_relationship || "",
      last_education: m.last_education || "",
      institution_name: m.institution_name || "",
      blood_group: m.blood_group || "",
      present_address: m.present_address || "",
      permanent_address: m.permanent_address || "",
      fathers_name: m.fathers_name || "",
      mothers_name: m.mothers_name || "",
      religion: m.religion || "",
      dob: m.dob || "",
      nid: m.nid || "",
      previous_company_name: m.previous_company_name || "",
      previous_company_salary: m.previous_company_salary || "",
      motor_bike: m.motor_bike || "No",
      bicyle: m.bicyle || "No",
      driving_license: m.driving_license || "No",
    });
    setIsFormModalOpen(true);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormLoading(true);
    setFormErrors({});
    try {
      if (editingMember) {
        await apiClient.put(`employees/${editingMember.id}`, formData);
        toast.success(t('employees.toast_update_success'));
      } else {
        await apiClient.post("employees", formData);
        toast.success(t('employees.toast_create_success'));
      }
      setIsFormModalOpen(false);
      fetchData();
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      if (Array.isArray(detail)) {
        const errors: Record<string, string> = {};
        detail.forEach((e: any) => {
          const field = e.loc?.[e.loc.length - 1];
          if (field) errors[field] = e.msg;
        });
        setFormErrors(errors);
      } else {
        toast.error(detail || t('common.action_failed'));
      }
    } finally {
      setFormLoading(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingId) return;
    setFormLoading(true);
    try {
      await apiClient.delete(`employees/${deletingId}`);
      toast.success(t('employees.toast_delete_success'));
      fetchData();
    } catch (err) {
      toast.error(t('employees.toast_delete_failed'));
    } finally {
      setFormLoading(false);
      setIsConfirmOpen(false);
      setDeletingId(null);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    setImportProgress(0);
    setImportResults(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const url = selectedHouse ? `employees/import?house_id=${selectedHouse.id}` : "employees/import";
      const response = await apiClient.post(url, formData);
      toast.success(response.data.message);
      fetchData();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || t('employees.toast_import_failed'));
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const response = await apiClient.get("employees/export", { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'employees.xlsx');
      document.body.appendChild(link);
      link.click();
      toast.success(t('employees.toast_export_success'));
    } catch (err) {
      toast.error(t('employees.toast_export_failed'));
    } finally {
      setIsExporting(false);
    }
  };

  const handleStatusChange = async (empId: number, newStatus: string) => {
    try {
      const emp = members.find(m => m.id === empId);
      if (!emp) return;
      
      const updatedData = { ...emp, status: newStatus };
      await apiClient.put(`employees/${empId}`, updatedData);
      toast.success(`Status updated to ${newStatus}`);
      fetchData();
    } catch (err) {
      toast.error(t('common.action_failed'));
    }
  };

  const filteredMembers = members.filter(m => 
    (m.user?.name?.toLowerCase() || "").includes(search.toLowerCase()) || 
    (m.dms_code || "").toLowerCase().includes(search.toLowerCase()) ||
    (m.itop_number || "").includes(search)
  );

  const totalPages = Math.ceil(filteredMembers.length / limit);
  const paginatedMembers = filteredMembers.slice(page * limit, (page + 1) * limit);

  if (authLoading) return <div className="p-8 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary-500"/></div>;
  if (!hasPermission("view_employees")) return <AccessDenied />;

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 font-mono tracking-tight flex items-center gap-2">
              <Users2 className="w-6 h-6 text-primary-500" />
              {t('employees.title')}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('employees.description')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={handleExport}
            disabled={isExporting}
            className="px-4 py-2 bg-white dark:bg-slate-900 border dark:border-slate-800 text-gray-700 dark:text-gray-200 rounded-xl text-sm font-bold hover:bg-gray-50 dark:hover:bg-slate-800 flex items-center gap-2 transition-all shadow-sm active:scale-95 disabled:opacity-50"
          >
            {isExporting ? <Loader2 className="w-4 h-4 animate-spin"/> : <Download className="w-4 h-4 text-primary-500"/>}
            {t('employees.export')}
          </button>
          <button 
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
            className="px-4 py-2 bg-white dark:bg-slate-900 border dark:border-slate-800 text-gray-700 dark:text-gray-200 rounded-xl text-sm font-bold hover:bg-gray-50 dark:hover:bg-slate-800 flex items-center gap-2 transition-all shadow-sm active:scale-95 disabled:opacity-50"
          >
            {isImporting ? <Loader2 className="w-4 h-4 animate-spin"/> : <Upload className="w-4 h-4 text-primary-500"/>}
            {t('employees.import')}
          </button>
          <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept=".xlsx,.xls"/>
          <button 
            onClick={openAddModal}
            className="px-4 py-2 bg-primary-600 text-white rounded-xl text-sm font-bold hover:bg-primary-700 flex items-center gap-2 transition-all shadow-lg shadow-primary-200 dark:shadow-none active:scale-95"
          >
            <Plus className="w-4 h-4" />
            {t('employees.add_new')}
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border dark:border-slate-800 shadow-sm overflow-hidden transition-all duration-300">
        <div className="p-4 border-b dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900/50 flex flex-col md:flex-row gap-4 justify-between items-center">
          <div className="relative w-full md:w-96 group">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-primary-500 transition-colors" />
            <input 
              type="text" 
              placeholder={t('employees.search_placeholder')} 
              className="w-full pl-10 pr-4 py-2 bg-white dark:bg-slate-800 border-none rounded-xl text-sm focus:ring-1 focus:ring-primary-500 outline-none dark:text-gray-100 transition-all shadow-sm"
              value={search}
              onChange={e => {setSearch(e.target.value); setPage(0);}}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-gray-400 uppercase tracking-widest bg-gray-100 dark:bg-slate-800 px-3 py-1 rounded-full">{t('employees.count_label', { count: filteredMembers.length })}</span>
          </div>
        </div>

        {loading ? (
          <div className="p-12 flex flex-col items-center justify-center gap-4">
            <div className="w-12 h-12 border-4 border-primary-100 border-t-primary-500 rounded-full animate-spin"></div>
            <p className="text-sm font-bold text-gray-500 animate-pulse">{t('employees.loading_text')}</p>
          </div>
        ) : filteredMembers.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-16 h-16 bg-gray-50 dark:bg-slate-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Users2 className="w-8 h-8 text-gray-300" />
            </div>
            <p className="text-gray-500 font-medium">{t('employees.no_employees')}</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-gray-50 dark:bg-slate-800 text-[10px] font-bold text-gray-400 uppercase tracking-widest border-b dark:border-slate-800">
                    <th className="px-6 py-4">{t('employees.table_info')}</th>
                    <th className="px-6 py-4">{t('employees.table_dms')}</th>
                    <th className="px-6 py-4">{t('employees.table_house')}</th>
                    <th className="px-6 py-4">{t('employees.table_status')}</th>
                    <th className="px-6 py-4 text-right">{t('employees.table_actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y dark:divide-slate-800 text-sm">
                  {paginatedMembers.map((m) => (
                    <tr key={m.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors group">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-primary-100 dark:bg-primary-500/10 flex items-center justify-center text-primary-600 dark:text-primary-400 font-bold text-xs shadow-inner overflow-hidden shrink-0">
                            {m.user?.profile_pic ? (
                              <img src={profilePicUrl(m.user.profile_pic)!} alt="" className="w-full h-full object-cover" />
                            ) : (
                              (m.user?.name || m.dms_code).charAt(0)
                            )}
                          </div>
                          <div>
                            <p className="font-bold text-gray-900 dark:text-gray-100">{m.user?.name || m.dms_code}</p>
                            <p className="text-[10px] text-gray-500 font-medium flex items-center gap-1"><Phone className="w-3 h-3"/> {m.personal_number}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="space-y-1">
                          <p className="text-xs font-mono font-bold text-primary-600 bg-primary-50 dark:bg-primary-500/5 px-2 py-0.5 rounded-lg inline-block">{m.dms_code}</p>
                          <p className="text-[10px] text-gray-500 flex items-center gap-1 font-medium"><Smartphone className="w-3 h-3"/> {m.itop_number || "N/A"}</p>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {m.house ? (
                          <div className="flex flex-col">
                            <span className="font-bold text-gray-700 dark:text-gray-300">{m.house.name}</span>
                            <span className="text-[10px] text-gray-500 uppercase font-mono">{m.house.code}</span>
                          </div>
                        ) : (
                          <span className="text-gray-400 italic text-xs">{t('employees.no_house')}</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="relative inline-block group/status">
                          <select 
                            value={m.status}
                            onChange={(e) => handleStatusChange(m.id, e.target.value)}
                            className={cn(
                              "px-2 py-1 rounded-full text-[10px] font-bold uppercase cursor-pointer outline-none border-none appearance-none pr-6",
                              m.status === "Active" ? "bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400" : 
                              m.status === "Resigned" ? "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400" :
                              "bg-primary-50 text-primary-700 dark:bg-primary-500/10 dark:text-primary-400"
                            )}
                          >
                            <option value="Active">Active</option>
                            <option value="Resigned">Resigned</option>
                            <option value="Suspended">Suspended</option>
                          </select>
                          <ChevronDown className="absolute right-1 top-1/2 -translate-y-1/2 w-3 h-3 opacity-50 pointer-events-none" />
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-1">
                          <button onClick={() => openViewModal(m)} className="p-2 hover:bg-blue-50 dark:hover:bg-blue-500/10 rounded-lg text-gray-400 hover:text-blue-600 transition-all"><Eye className="w-4 h-4"/></button>
                          <button onClick={() => {setDeletingId(m.id); setIsConfirmOpen(true);}} className="p-2 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg text-gray-400 hover:text-red-600 transition-all"><Trash2 className="w-4 h-4"/></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-4 border-t dark:border-slate-800 flex items-center justify-between bg-gray-50/30 dark:bg-slate-900/30">
              <p className="text-xs text-gray-500 font-medium">
                {t('employees.showing_results', { start: filteredMembers.length > 0 ? page * limit + 1 : 0, end: Math.min((page + 1) * limit, filteredMembers.length), total: filteredMembers.length })}
              </p>
              <div className="flex gap-2">
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="p-1.5 border dark:border-slate-800 rounded-lg hover:bg-white dark:hover:bg-slate-800 disabled:opacity-50 transition-all shadow-sm active:scale-95"><ChevronLeft className="w-4 h-4"/></button>
                <button onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1} className="p-1.5 border dark:border-slate-800 rounded-lg hover:bg-white dark:hover:bg-slate-800 disabled:opacity-50 transition-all shadow-sm active:scale-95"><ChevronRight className="w-4 h-4"/></button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* View Modal */}
      {isViewModalOpen && viewingMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setIsViewModalOpen(false)}>
          <div className="bg-white dark:bg-slate-900 w-full max-w-3xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[95vh] border dark:border-slate-800 animate-in fade-in zoom-in duration-200" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="relative shrink-0">
              <div className="absolute inset-0 bg-gradient-to-br from-primary-500 to-primary-700 opacity-95 rounded-t-2xl" />
              <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2" />
              <div className="absolute bottom-0 left-0 w-48 h-48 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2" />
              <div className="relative px-6 py-5 flex items-start gap-4">
                <div className="w-16 h-16 shrink-0 rounded-2xl bg-white/20 flex items-center justify-center text-white text-2xl font-black shadow-lg backdrop-blur-sm border border-white/20 overflow-hidden">
                  {viewingMember.user?.profile_pic ? (
                    <img src={profilePicUrl(viewingMember.user.profile_pic)!} alt="" className="w-full h-full object-cover" />
                  ) : (
                    (viewingMember.user?.name || viewingMember.dms_code).charAt(0)
                  )}
                </div>
                <div className="flex-1 text-white min-w-0">
                  <h2 className="text-xl font-bold truncate">{viewingMember.user?.name || "Unnamed"}</h2>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                    <span className="text-[11px] font-mono bg-white/15 px-2 py-0.5 rounded-lg whitespace-nowrap">{viewingMember.dms_code}</span>
                    {viewingMember.house && (
                      <span className="text-[11px] bg-white/15 px-2 py-0.5 rounded-lg truncate max-w-[200px]">{viewingMember.house.name}</span>
                    )}
                    <span className={cn(
                      "text-[10px] font-bold px-2 py-0.5 rounded-full uppercase whitespace-nowrap",
                      viewingMember.status === "Active" ? "bg-green-400/20 text-green-200" :
                      viewingMember.status === "Resigned" ? "bg-red-400/20 text-red-200" :
                      "bg-primary-400/20 text-primary-200"
                    )}>{viewingMember.status}</span>
                  </div>
                </div>
                <button onClick={() => setIsViewModalOpen(false)} className="p-2 shrink-0 bg-white/10 hover:bg-white/20 rounded-xl transition-all text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Scrollable content */}
            <div className="p-6 overflow-y-auto space-y-5 scrollbar-hide">
              {/* Contact Info — inline badges */}
              <div className="flex flex-wrap gap-2">
                <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-slate-800 rounded-xl text-sm">
                  <Phone className="w-3.5 h-3.5 text-primary-500" />
                  <span className="font-bold dark:text-gray-200">{viewingMember.personal_number || "—"}</span>
                </div>
                <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-slate-800 rounded-xl text-sm">
                  <Smartphone className="w-3.5 h-3.5 text-blue-500" />
                  <span className="font-bold dark:text-gray-200">{viewingMember.itop_number || "—"}</span>
                </div>
                <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-slate-800 rounded-xl text-sm">
                  <Calendar className="w-3.5 h-3.5 text-purple-500" />
                  <span className="font-bold dark:text-gray-200">{viewingMember.joining_date || "—"}</span>
                </div>
              </div>

              {/* Professional Details */}
              <div>
                <div className="flex items-center gap-2 pb-2 mb-3 border-b dark:border-slate-800">
                  <Briefcase className="w-4 h-4 text-blue-500" />
                  <h4 className="text-[11px] font-bold text-gray-900 dark:text-gray-100 uppercase tracking-widest">{t('employees.section_professional')}</h4>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2.5 text-sm">
                  <FieldRow label="Salary" value={viewingMember.salary} />
                  <FieldRow label="Market Type" value={viewingMember.market_type} />
                  <FieldRow label="Retailer Code" value={viewingMember.assisted_retailer_code} />
                  <FieldRow label="Agency ID" value={viewingMember.agency_id} />
                </div>
              </div>

              {/* Personal Information */}
              <div>
                <div className="flex items-center gap-2 pb-2 mb-3 border-b dark:border-slate-800">
                  <User className="w-4 h-4 text-purple-500" />
                  <h4 className="text-[11px] font-bold text-gray-900 dark:text-gray-100 uppercase tracking-widest">{t('employees.section_personal')}</h4>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2.5 text-sm">
                  <FieldRow label="NID" value={viewingMember.nid} />
                  <FieldRow label="Date of Birth" value={viewingMember.dob} />
                  <FieldRow label="Blood Group" value={viewingMember.blood_group} />
                  <FieldRow label="Religion" value={viewingMember.religion} />
                  <FieldRow label="Father's Name" value={viewingMember.fathers_name} />
                  <FieldRow label="Mother's Name" value={viewingMember.mothers_name} />
                  <FieldRow label="Last Education" value={viewingMember.last_education} />
                  <FieldRow label="Institution" value={viewingMember.institution_name} />
                  <div className="md:col-span-2"><FieldRow label="Present Address" value={viewingMember.present_address} /></div>
                  <div className="md:col-span-2"><FieldRow label="Permanent Address" value={viewingMember.permanent_address} /></div>
                </div>
              </div>

              {/* Bank Details */}
              <div>
                <div className="flex items-center gap-2 pb-2 mb-3 border-b dark:border-slate-800">
                  <CreditCard className="w-4 h-4 text-emerald-500" />
                  <h4 className="text-[11px] font-bold text-gray-900 dark:text-gray-100 uppercase tracking-widest">{t('employees.section_bank')}</h4>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2.5 text-sm">
                  <FieldRow label="Bank Name" value={viewingMember.bank_name} />
                  <FieldRow label="Account No" value={viewingMember.bank_account} />
                  <FieldRow label="Branch" value={viewingMember.branch_name} />
                  <FieldRow label="Routing No" value={viewingMember.routing_number} />
                </div>
              </div>

              {/* Emergency Contact */}
              <div>
                <div className="flex items-center gap-2 pb-2 mb-3 border-b dark:border-slate-800">
                  <Shield className="w-4 h-4 text-red-500" />
                  <h4 className="text-[11px] font-bold text-gray-900 dark:text-gray-100 uppercase tracking-widest">{t('employees.section_emergency')}</h4>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2.5 text-sm">
                  <FieldRow label="Contact Person" value={viewingMember.emergency_contact_person_name} />
                  <FieldRow label="Phone" value={viewingMember.emergency_contact_person_number} />
                  <FieldRow label="Relationship" value={viewingMember.emergency_person_relationship} />
                </div>
              </div>

              {/* Experience & Assets */}
              <div>
                <div className="flex items-center gap-2 pb-2 mb-3 border-b dark:border-slate-800">
                  <Briefcase className="w-4 h-4 text-amber-500" />
                  <h4 className="text-[11px] font-bold text-gray-900 dark:text-gray-100 uppercase tracking-widest">{t('employees.section_experience')}</h4>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2.5 text-sm">
                  <FieldRow label="Prev Company" value={viewingMember.previous_company_name} />
                  <FieldRow label="Prev Salary" value={viewingMember.previous_company_salary} />
                  <FieldRow label="Motor Bike" value={viewingMember.motor_bike} />
                  <FieldRow label="Bicycle" value={viewingMember.bicyle} />
                  <FieldRow label="Driving License" value={viewingMember.driving_license} />
                </div>
              </div>
            </div>

            {/* Footer with actions */}
            <div className="p-4 border-t dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900/50 flex justify-end gap-2">
              <button onClick={() => { setIsViewModalOpen(false); openEditModal(viewingMember); }} className="px-5 py-2.5 bg-primary-500 hover:bg-primary-600 text-white rounded-xl font-bold text-sm flex items-center gap-2 transition-all active:scale-95 shadow-lg shadow-primary-200 dark:shadow-none">
                <Edit2 className="w-4 h-4" /> Edit
              </button>
              <button onClick={() => { setIsViewModalOpen(false); setDeletingId(viewingMember.id); setIsConfirmOpen(true); }} className="px-5 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-xl font-bold text-sm flex items-center gap-2 transition-all active:scale-95">
                <Trash2 className="w-4 h-4" /> Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Form Modal */}
      {isFormModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 w-full max-w-4xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[95vh] border dark:border-slate-800 animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b dark:border-slate-800 flex items-center justify-between bg-gray-50/50 dark:bg-slate-900/50">
              <div>
                <h3 className="text-lg font-bold dark:text-gray-100 flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-primary-500 flex items-center justify-center">
                    {editingMember ? <Edit2 className="w-4 h-4 text-white"/> : <Plus className="w-4 h-4 text-white"/>}
                  </div>
                  {editingMember ? t('employees.modal_edit_title') : t('employees.modal_create_title')}
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">{t('employees.modal_subtitle')}</p>
              </div>
              <button onClick={() => setIsFormModalOpen(false)} className="p-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl transition-all active:scale-90"><X className="w-5 h-5"/></button>
            </div>
            <form onSubmit={handleFormSubmit} className="p-6 overflow-y-auto space-y-8 scrollbar-hide">
              {/* Section 1: Basic Information */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b dark:border-slate-800">
                  <User className="w-4 h-4 text-primary-500" />
                  <h4 className="text-[11px] font-bold text-gray-900 dark:text-gray-100 uppercase tracking-widest">{t('employees.section_basic')}</h4>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-gray-500 uppercase">{t('employees.field_house')} *</label>
                    <div className="relative group">
                      <div className={cn(
                        "absolute left-3 top-1/2 -translate-y-1/2 transition-colors pointer-events-none",
                        formErrors.house_id ? "text-red-500" : "text-gray-400 group-focus-within:text-primary-500"
                      )}>
                        <Home className="w-4 h-4" />
                      </div>
                      <select 
                        className={cn(
                          "w-full p-2.5 pl-10 bg-gray-50 dark:bg-slate-800 border rounded-xl text-sm dark:text-gray-100 outline-none transition-all appearance-none",
                          formErrors.house_id ? "border-red-500/50 ring-1 ring-red-500/10" : "border-transparent focus:ring-1 focus:ring-primary-500 focus:bg-white dark:focus:bg-slate-800"
                        )}
                        value={formData.house_id || ""}
                        onChange={e => setFormData({...formData, house_id: e.target.value ? parseInt(e.target.value) : undefined})}
                        required
                      >
                        <option value="">{t('employees.field_house_placeholder')}</option>
                        {houses.map(h => <option key={h.id} value={h.id}>{h.name} ({h.code})</option>)}
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                    </div>
                    {formErrors.house_id && <p className="text-[11px] text-red-500 mt-0.5">{formErrors.house_id}</p>}
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-gray-500 uppercase">{t('employees.field_tagged_user')}</label>
                    <div className="relative group">
                      <div className={cn(
                        "absolute left-3 top-1/2 -translate-y-1/2 transition-colors pointer-events-none",
                        formErrors.user_id ? "text-red-500" : "text-gray-400 group-focus-within:text-primary-500"
                      )}>
                        <Shield className="w-4 h-4" />
                      </div>
                      <select 
                        className={cn(
                          "w-full p-2.5 pl-10 bg-gray-50 dark:bg-slate-800 border rounded-xl text-sm dark:text-gray-100 outline-none transition-all appearance-none",
                          formErrors.user_id ? "border-red-500/50 ring-1 ring-red-500/10" : "border-transparent focus:ring-1 focus:ring-primary-500 focus:bg-white dark:focus:bg-slate-800"
                        )}
                        value={formData.user_id || ""}
                        onChange={e => setFormData({...formData, user_id: e.target.value ? parseInt(e.target.value) : undefined})}
                      >
                        <option value="">{t('employees.field_tagged_user_placeholder')}</option>
                        {users.filter(u => {
                          if (editingMember?.user_id === u.id) return true;
                          return !members.some(m => m.user_id === u.id && m.id !== editingMember?.id);
                        }).map(u => <option key={u.id} value={u.id}>{u.name} (@{u.username})</option>)}
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                    </div>
                    {formErrors.user_id && <p className="text-[11px] text-red-500 mt-0.5">{formErrors.user_id}</p>}
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-gray-500 uppercase">{t('employees.field_status')}</label>
                    <div className="relative group">
                      <div className={cn(
                        "absolute left-3 top-1/2 -translate-y-1/2 transition-colors pointer-events-none",
                        formErrors.status ? "text-red-500" : "text-gray-400 group-focus-within:text-primary-500"
                      )}>
                        <Activity className="w-4 h-4" />
                      </div>
                      <select 
                        className={cn(
                          "w-full p-2.5 pl-10 bg-gray-50 dark:bg-slate-800 border rounded-xl text-sm dark:text-gray-100 outline-none transition-all appearance-none",
                          formErrors.status ? "border-red-500/50 ring-1 ring-red-500/10" : "border-transparent focus:ring-1 focus:ring-primary-500 focus:bg-white dark:focus:bg-slate-800"
                        )}
                        value={formData.status}
                        onChange={e => setFormData({...formData, status: e.target.value})}
                      >
                        <option value="Active">{t('common.active')}</option>
                        <option value="Resigned">{t('common.resigned')}</option>
                        <option value="Suspended">{t('common.suspended')}</option>
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                    </div>
                    {formErrors.status && <p className="text-[11px] text-red-500 mt-0.5">{formErrors.status}</p>}
                  </div>

                  <InputField label={t('employees.field_dms_code')} icon={Smartphone} value={formData.dms_code} onChange={(v: string) => setFormData({...formData, dms_code: v})} required error={formErrors.dms_code} />
                  <InputField label={t('employees.field_itop')} type="tel" icon={SmartphoneNfc} value={formData.itop_number} onChange={(v: string) => setFormData({...formData, itop_number: v})} error={formErrors.itop_number} />
                  <InputField label={t('employees.field_personal_number')} type="tel" icon={Phone} value={formData.personal_number} onChange={(v: string) => setFormData({...formData, personal_number: v})} error={formErrors.personal_number} />
                </div>
              </div>

              {/* Section 2: Professional Details */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b dark:border-slate-800">
                  <Briefcase className="w-4 h-4 text-blue-500" />
                  <h4 className="text-[11px] font-bold text-gray-900 dark:text-gray-100 uppercase tracking-widest">{t('employees.section_professional')}</h4>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  <InputField label={t('employees.field_joining_date')} icon={Calendar} type="date" value={formData.joining_date} onChange={(v: string) => setFormData({...formData, joining_date: v})} error={formErrors.joining_date} />
                  <InputField label={t('employees.field_resigned_date')} icon={Calendar} type="date" value={formData.resigned_date} onChange={(v: string) => setFormData({...formData, resigned_date: v})} error={formErrors.resigned_date} />
                  <InputField label={t('employees.field_salary')} type="number" icon={Banknote} value={formData.salary} onChange={(v: string) => setFormData({...formData, salary: v})} error={formErrors.salary} />
                  
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-gray-500 uppercase">{t('employees.field_market_type')}</label>
                    <div className="relative group">
                      <div className={cn(
                        "absolute left-3 top-1/2 -translate-y-1/2 transition-colors pointer-events-none",
                        formErrors.market_type ? "text-red-500" : "text-gray-400 group-focus-within:text-primary-500"
                      )}>
                        <MapPin className="w-4 h-4" />
                      </div>
                      <select 
                        className={cn(
                          "w-full p-2.5 pl-10 bg-gray-50 dark:bg-slate-800 border rounded-xl text-sm dark:text-gray-100 outline-none transition-all appearance-none",
                          formErrors.market_type ? "border-red-500/50 ring-1 ring-red-500/10" : "border-transparent focus:ring-1 focus:ring-primary-500 focus:bg-white dark:focus:bg-slate-800"
                        )}
                        value={formData.market_type}
                        onChange={e => setFormData({...formData, market_type: e.target.value})}
                      >
                        <option value="Urban">Urban</option>
                        <option value="Rural">Rural</option>
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                    </div>
                    {formErrors.market_type && <p className="text-[11px] text-red-500 mt-0.5">{formErrors.market_type}</p>}
                  </div>

                  <InputField label={t('employees.field_assisted_retailer')} icon={Store} value={formData.assisted_retailer_code} onChange={(v: string) => setFormData({...formData, assisted_retailer_code: v})} />
                  <InputField label={t('employees.field_agency_id')} icon={Shield} value={formData.agency_id} onChange={(v: string) => setFormData({...formData, agency_id: v})} />
                  <InputField label={t('employees.field_pool_number')} type="tel" icon={Smartphone} value={formData.pool_number} onChange={(v: string) => setFormData({...formData, pool_number: v})} error={formErrors.pool_number} />
                </div>
              </div>

              {/* Section 3: Personal Information */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b dark:border-slate-800">
                  <MapPin className="w-4 h-4 text-purple-500" />
                  <h4 className="text-[11px] font-bold text-gray-900 dark:text-gray-100 uppercase tracking-widest">{t('employees.section_personal')}</h4>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  <InputField label={t('employees.field_nid')} icon={CreditCard} value={formData.nid} onChange={(v: string) => setFormData({...formData, nid: v})} />
                  <InputField label={t('employees.field_dob')} icon={Calendar} type="date" value={formData.dob} onChange={(v: string) => setFormData({...formData, dob: v})} error={formErrors.dob} />
                  <InputField label={t('employees.field_blood_group')} icon={Activity} value={formData.blood_group} onChange={(v: string) => setFormData({...formData, blood_group: v})} />
                  <InputField label={t('employees.field_religion')} icon={User} value={formData.religion} onChange={(v: string) => setFormData({...formData, religion: v})} />
                  <InputField label={t('employees.field_home_town')} icon={Home} value={formData.home_town} onChange={(v: string) => setFormData({...formData, home_town: v})} />
                  <InputField label={t('employees.field_father_name')} icon={User} value={formData.fathers_name} onChange={(v: string) => setFormData({...formData, fathers_name: v})} />
                  <InputField label={t('employees.field_mother_name')} icon={User} value={formData.mothers_name} onChange={(v: string) => setFormData({...formData, mothers_name: v})} />
                  <InputField label={t('employees.field_education')} icon={Briefcase} value={formData.last_education} onChange={(v: string) => setFormData({...formData, last_education: v})} />
                  <InputField label={t('employees.field_institution')} icon={Store} value={formData.institution_name} onChange={(v: string) => setFormData({...formData, institution_name: v})} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <InputField label={t('employees.field_present_address')} icon={MapPin} value={formData.present_address} onChange={(v: string) => setFormData({...formData, present_address: v})} />
                  <InputField label={t('employees.field_permanent_address')} icon={MapPin} value={formData.permanent_address} onChange={(v: string) => setFormData({...formData, permanent_address: v})} />
                </div>
              </div>

              {/* Section 4: Bank Details */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b dark:border-slate-800">
                  <CreditCard className="w-4 h-4 text-green-500" />
                  <h4 className="text-[11px] font-bold text-gray-900 dark:text-gray-100 uppercase tracking-widest">{t('employees.section_bank')}</h4>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                  <InputField label={t('employees.field_bank_name')} icon={Store} value={formData.bank_name} onChange={(v: string) => setFormData({...formData, bank_name: v})} />
                  <InputField label={t('employees.field_account_number')} icon={CreditCard} value={formData.bank_account} onChange={(v: string) => setFormData({...formData, bank_account: v})} />
                  <InputField label={t('employees.field_branch_name')} icon={MapPin} value={formData.branch_name} onChange={(v: string) => setFormData({...formData, branch_name: v})} />
                  <InputField label={t('employees.field_routing_number')} icon={Network} value={formData.routing_number} onChange={(v: string) => setFormData({...formData, routing_number: v})} />
                </div>
              </div>

              {/* Section 5: Emergency Contact */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b dark:border-slate-800">
                  <Shield className="w-4 h-4 text-red-500" />
                  <h4 className="text-[11px] font-bold text-gray-900 dark:text-gray-100 uppercase tracking-widest">{t('employees.section_emergency')}</h4>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  <InputField label={t('employees.field_emergency_contact')} icon={User} value={formData.emergency_contact_person_name} onChange={(v: string) => setFormData({...formData, emergency_contact_person_name: v})} />
                  <InputField label={t('employees.field_emergency_phone')} type="tel" icon={Phone} value={formData.emergency_contact_person_number} onChange={(v: string) => setFormData({...formData, emergency_contact_person_number: v})} error={formErrors.emergency_contact_person_number} />
                  <InputField label={t('employees.field_emergency_relation')} icon={Users2} value={formData.emergency_person_relationship} onChange={(v: string) => setFormData({...formData, emergency_person_relationship: v})} />
                </div>
              </div>

              {/* Section 6: Previous Experience & Assets */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b dark:border-slate-800">
                  <Activity className="w-4 h-4 text-cyan-500" />
                  <h4 className="text-[11px] font-bold text-gray-900 dark:text-gray-100 uppercase tracking-widest">{t('employees.section_experience')}</h4>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  <InputField label={t('employees.field_prev_company')} icon={Briefcase} value={formData.previous_company_name} onChange={(v: string) => setFormData({...formData, previous_company_name: v})} />
                  <InputField label={t('employees.field_prev_salary')} type="number" icon={Banknote} value={formData.previous_company_salary} onChange={(v: string) => setFormData({...formData, previous_company_salary: v})} error={formErrors.previous_company_salary} />
                  
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-gray-500 uppercase">{t('employees.field_motor_bike')}</label>
                    <div className="relative group">
                      <div className={cn(
                        "absolute left-3 top-1/2 -translate-y-1/2 transition-colors pointer-events-none",
                        formErrors.motor_bike ? "text-red-500" : "text-gray-400 group-focus-within:text-primary-500"
                      )}>
                        <Smartphone className="w-4 h-4" />
                      </div>
                      <select 
                        className={cn(
                          "w-full p-2.5 pl-10 bg-gray-50 dark:bg-slate-800 border rounded-xl text-sm dark:text-gray-100 outline-none transition-all appearance-none",
                          formErrors.motor_bike ? "border-red-500/50 ring-1 ring-red-500/10" : "border-transparent focus:ring-1 focus:ring-primary-500 focus:bg-white dark:focus:bg-slate-800"
                        )}
                        value={formData.motor_bike}
                        onChange={e => setFormData({...formData, motor_bike: e.target.value})}
                      >
                        <option value="Yes">Yes</option>
                        <option value="No">No</option>
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                    </div>
                    {formErrors.motor_bike && <p className="text-[11px] text-red-500 mt-0.5">{formErrors.motor_bike}</p>}
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-gray-500 uppercase">{t('employees.field_bicycle')}</label>
                    <div className="relative group">
                      <div className={cn(
                        "absolute left-3 top-1/2 -translate-y-1/2 transition-colors pointer-events-none",
                        formErrors.bicyle ? "text-red-500" : "text-gray-400 group-focus-within:text-primary-500"
                      )}>
                        <Activity className="w-4 h-4" />
                      </div>
                      <select 
                        className={cn(
                          "w-full p-2.5 pl-10 bg-gray-50 dark:bg-slate-800 border rounded-xl text-sm dark:text-gray-100 outline-none transition-all appearance-none",
                          formErrors.bicyle ? "border-red-500/50 ring-1 ring-red-500/10" : "border-transparent focus:ring-1 focus:ring-primary-500 focus:bg-white dark:focus:bg-slate-800"
                        )}
                        value={formData.bicyle}
                        onChange={e => setFormData({...formData, bicyle: e.target.value})}
                      >
                        <option value="Yes">Yes</option>
                        <option value="No">No</option>
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                    </div>
                    {formErrors.bicyle && <p className="text-[11px] text-red-500 mt-0.5">{formErrors.bicyle}</p>}
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-gray-500 uppercase">{t('employees.field_driving_license')}</label>
                    <div className="relative group">
                      <div className={cn(
                        "absolute left-3 top-1/2 -translate-y-1/2 transition-colors pointer-events-none",
                        formErrors.driving_license ? "text-red-500" : "text-gray-400 group-focus-within:text-primary-500"
                      )}>
                        <ClipboardList className="w-4 h-4" />
                      </div>
                      <select 
                        className={cn(
                          "w-full p-2.5 pl-10 bg-gray-50 dark:bg-slate-800 border rounded-xl text-sm dark:text-gray-100 outline-none transition-all appearance-none",
                          formErrors.driving_license ? "border-red-500/50 ring-1 ring-red-500/10" : "border-transparent focus:ring-1 focus:ring-primary-500 focus:bg-white dark:focus:bg-slate-800"
                        )}
                        value={formData.driving_license}
                        onChange={e => setFormData({...formData, driving_license: e.target.value})}
                      >
                        <option value="Yes">Yes</option>
                        <option value="No">No</option>
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                    </div>
                    {formErrors.driving_license && <p className="text-[11px] text-red-500 mt-0.5">{formErrors.driving_license}</p>}
                  </div>
                </div>
              </div>

              <div className="flex gap-4 pt-6 bg-white dark:bg-slate-900 border-t dark:border-slate-800 py-4 z-10">
                <button type="button" onClick={() => setIsFormModalOpen(false)} className="flex-1 py-3 text-sm font-bold text-gray-500 hover:bg-gray-100 rounded-xl transition-all active:scale-95">{t('employees.btn_cancel')}</button>
                <button type="submit" disabled={formLoading} className="flex-[2] py-3 bg-primary-600 text-white rounded-xl text-sm font-bold hover:bg-primary-700 disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-primary-200 dark:shadow-none transition-all active:scale-95">
                  {formLoading ? <Loader2 className="w-5 h-5 animate-spin"/> : <Check className="w-5 h-5"/>}
                  {editingMember ? t('employees.btn_save') : t('employees.btn_register')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmationModal
        isOpen={isConfirmOpen}
        onClose={() => setIsConfirmOpen(false)}
        onConfirm={handleConfirmDelete}
        title={t('employees.delete_title')}
        message={t('employees.delete_message')}
        type="danger"
        loading={formLoading}
      />
    </div>
  );
}
