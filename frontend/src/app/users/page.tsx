"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { 
  Users, 
  Shield, 
  UserCheck, 
  UserMinus, 
  MoreVertical,
  Mail,
  Search,
  Plus,
  ChevronLeft,
  ChevronRight,
  X,
  User as UserIcon,
  Lock,
  Loader2,
  AlertCircle,
  Check,
  Phone,
  Hash,
  Trash2,
  Edit2,
  Building2,
  Briefcase,
  Eye,
  EyeOff
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "react-hot-toast";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";

interface Role {
  id: number;
  name: string;
}

interface House {
  id: number;
  name: string;
  code: string;
}

interface User {
  id: number;
  username: string;
  name: string;
  email: string;
  phone_number?: string;
  status: string;
  roles?: Role[];
  houses?: House[];
  parent_id?: number;
}

export default function UsersPage() {
  const { selectedHouse, hasPermission, loading: authLoading } = useAuth();
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [houses, setHouses] = useState<House[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  
  // Modal States
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const limit = 5;

  const [formData, setFormData] = useState({
    username: "",
    name: "",
    email: "",
    password: "",
    phone_number: "",
    telegram_id: "",
    status: "Active",
    role_ids: [] as number[],
    house_ids: [] as number[],
    parent_id: "" as string | number,
  });

  // Permission Check
  useEffect(() => {
    if (!authLoading && !hasPermission("view_users")) {
      router.push("/");
    }
  }, [authLoading, hasPermission, router]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [usersRes, rolesRes, housesRes] = await Promise.all([
        apiClient.get("/users"),
        apiClient.get("/roles"),
        apiClient.get("/houses")
      ]);
      setUsers(usersRes.data);
      setRoles(rolesRes.data);
      setHouses(housesRes.data);
    } catch (err) {
      console.error("Failed to fetch data", err);
      toast.error("Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [selectedHouse]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
  };

  const handleMultiSelect = (name: "role_ids" | "house_ids", id: number) => {
    setFormData(prev => {
      const current = prev[name];
      const updated = current.includes(id) 
        ? current.filter(item => item !== id)
        : [...current, id];
      return { ...prev, [name]: updated };
    });
  };

  const openAddModal = () => {
    setEditingUser(null);
    setFormData({
      username: "",
      name: "",
      email: "",
      password: "",
      phone_number: "",
      telegram_id: "",
      status: "Active",
      role_ids: [],
      house_ids: [],
      parent_id: "",
    });
    setFormError("");
    setFieldErrors({});
    setIsFormModalOpen(true);
  };

  const openEditModal = (user: User) => {
    setEditingUser(user);
    setFormData({
      username: user.username || "",
      name: user.name || "",
      email: user.email || "",
      password: "", // Leave blank for security, only change if provided
      phone_number: user.phone_number || "",
      telegram_id: user.telegram_id?.toString() || "",
      status: user.status || "Active",
      role_ids: user.roles?.map(r => r.id) || [],
      house_ids: user.houses?.map(h => h.id) || [],
      parent_id: user.parent_id || "",
    });
    setFormError("");
    setFieldErrors({});
    setIsFormModalOpen(true);
  };

  const validateForm = () => {
    const errors: Record<string, string> = {};
    if (!formData.name.trim()) errors.name = "Name is required";
    if (!formData.username.trim()) errors.username = "Username is required";
    if (!formData.email.trim()) errors.email = "Email is required";
    if (!editingUser && !formData.password.trim()) errors.password = "Password is required";
    
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;
    
    setFormLoading(true);
    setFormError("");
    
    const payload = {
      ...formData,
      telegram_id: formData.telegram_id ? Number(formData.telegram_id) : null,
      parent_id: formData.parent_id === "" ? null : Number(formData.parent_id)
    };

    try {
      if (editingUser) {
        // Assume PUT /users/:id exists
        await apiClient.put(`/users/${editingUser.id}`, payload);
        toast.success("User updated successfully!");
      } else {
        await apiClient.post("/auth/register", payload);
        toast.success("User created successfully!");
      }
      setIsFormModalOpen(false);
      fetchData();
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      const errorMsg = typeof detail === "string" ? detail : "Action failed";
      setFormError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setFormLoading(false);
    }
  };

  const handleDeleteClick = (id: number) => {
    setDeletingId(id);
    setIsConfirmOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!deletingId) return;
    setFormLoading(true);
    try {
      await apiClient.delete(`/users/${deletingId}`);
      toast.success("User deleted successfully!");
      setIsConfirmOpen(false);
      fetchData();
    } catch (err) {
      toast.error("Failed to delete user");
    } finally {
      setFormLoading(false);
      setDeletingId(null);
    }
  };

  const filteredUsers = users.filter(u => 
    u.name?.toLowerCase().includes(search.toLowerCase()) || 
    u.username?.toLowerCase().includes(search.toLowerCase()) ||
    u.email?.toLowerCase().includes(search.toLowerCase())
  );

  const paginatedUsers = filteredUsers.slice(page * limit, (page + 1) * limit);
  const totalPages = Math.ceil(filteredUsers.length / limit);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">User Management</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 transition-colors">Manage system access, roles and reporting lines.</p>
        </div>
        <button 
          onClick={openAddModal}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg text-sm font-bold hover:bg-orange-700 transition-colors shadow-lg shadow-orange-200 dark:shadow-none"
        >
          <Plus className="w-4 h-4" />
          Add New User
        </button>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 md:gap-6">
        <StatCard title="Total Users" value={users.length} icon={Users} color="bg-blue-500" />
        <StatCard title="Active Users" value={users.filter(u => u.status === "Active").length} icon={UserCheck} color="bg-green-500" />
        <StatCard title="System Roles" value={roles.length} icon={Shield} color="bg-purple-500" />
      </div>

      {/* DataTable Container */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden transition-colors duration-300">
        <div className="p-4 border-b border-gray-50 dark:border-slate-800">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
            <input 
              type="text" 
              placeholder="Search by name, username or email..." 
              className="w-full pl-10 pr-4 py-2.5 bg-gray-50 dark:bg-slate-800 border-none rounded-xl text-sm focus:ring-2 focus:ring-orange-500 transition-all dark:text-gray-100 outline-none"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
          </div>
        </div>

        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center gap-4">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-orange-500"></div>
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="py-20 text-center">
            <Users className="w-12 h-12 text-gray-200 dark:text-gray-700 mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400 font-medium">No users found</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left min-w-[800px]">
                <thead>
                  <tr className="bg-gray-50/50 dark:bg-slate-800/50 text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest border-b border-gray-50 dark:border-slate-800">
                    <th className="px-6 py-4">User Profile</th>
                    <th className="px-6 py-4">Roles & Houses</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                  {paginatedUsers.map((u) => (
                    <tr key={u.id} className="hover:bg-gray-50/30 dark:hover:bg-slate-800/30 transition-colors group">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-orange-100 dark:bg-orange-500/20 flex items-center justify-center text-orange-700 dark:text-orange-400 font-bold shadow-sm">
                            {u.name?.charAt(0) || "U"}
                          </div>
                          <div>
                            <p className="font-bold text-gray-900 dark:text-gray-100 text-sm">{u.name}</p>
                            <p className="text-[10px] text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                                <Hash className="w-2.5 h-2.5" /> @{u.username} <Mail className="w-2.5 h-2.5 ml-1" /> {u.email}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-1.5">
                          {u.roles?.map(r => (
                            <span key={r.id} className="px-2 py-0.5 bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 text-[9px] font-bold uppercase rounded-full border border-blue-100 dark:border-blue-500/20">
                              {r.name}
                            </span>
                          ))}
                          {u.houses?.length ? (
                            <span className="px-2 py-0.5 bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-400 text-[9px] font-bold uppercase rounded-full border border-purple-100 dark:border-purple-500/20">
                              {u.houses.length} Houses
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={cn(
                          "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider transition-all",
                          u.status === "Active" 
                            ? "bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400"
                            : "bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400"
                        )}>
                          <span className={cn("w-1 h-1 rounded-full", u.status === "Active" ? "bg-green-500" : "bg-red-500")}></span>
                          {u.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-2">
                          <button 
                            onClick={() => openEditModal(u)}
                            className="p-2 hover:bg-orange-50 dark:hover:bg-orange-500/10 rounded-xl text-gray-400 hover:text-orange-600 transition-all"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => handleDeleteClick(u.id)}
                            className="p-2 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-xl text-gray-400 hover:text-red-600 transition-all"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="p-4 border-t border-gray-50 dark:border-slate-800 flex items-center justify-between">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Showing result {filteredUsers.length === 0 ? 0 : (page * limit) + 1} to {Math.min((page + 1) * limit, filteredUsers.length)} of {filteredUsers.length}
              </p>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="p-2 border rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50"><ChevronLeft className="w-4 h-4"/></button>
                <button onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1} className="p-2 border rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50"><ChevronRight className="w-4 h-4"/></button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* User Add/Edit Modal */}
      {isFormModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-0 md:p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white dark:bg-slate-900 w-full max-w-4xl h-full md:h-auto md:max-h-[95vh] md:rounded-3xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-gray-50 dark:border-slate-800 flex items-center justify-between flex-shrink-0">
              <div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">{editingUser ? "Edit User Profile" : "Create New User"}</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Control system access, roles and distribution context.</p>
              </div>
              <button onClick={() => setIsFormModalOpen(false)} className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-xl bg-gray-50 dark:bg-slate-800 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleFormSubmit} className="flex-1 overflow-y-auto p-6 md:p-8 scrollbar-hide">
              {formError && (
                <div className="mb-6 bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 text-red-600 dark:text-red-400 p-4 rounded-2xl flex items-center gap-3 text-sm animate-shake">
                  <AlertCircle className="h-5 w-5 shrink-0" />
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Section 1: Identity & Security */}
                <div className="space-y-5">
                  <h4 className="text-xs font-bold text-orange-600 uppercase tracking-widest flex items-center gap-2"><UserIcon className="w-4 h-4"/> Account Identity</h4>
                  <div className="space-y-4">
                    <InputField label="Full Name" required value={formData.name} onChange={(v: string) => setFormData({...formData, name: v})} placeholder="e.g. John Doe" leftIcon={UserIcon} error={fieldErrors.name} />
                    <div className="grid grid-cols-2 gap-4">
                      <InputField label="Username" required value={formData.username} onChange={(v: string) => setFormData({...formData, username: v.toLowerCase()})} placeholder="johndoe" leftIcon={Hash} error={fieldErrors.username} />
                      <InputField label="Phone" type="number" value={formData.phone_number} onChange={(v: string) => setFormData({...formData, phone_number: v})} placeholder="017xxxxxxxx" leftIcon={Phone} />
                    </div>
                    <InputField label="Email Address" required type="email" value={formData.email} onChange={(v: string) => setFormData({...formData, email: v})} placeholder="john@example.com" leftIcon={Mail} error={fieldErrors.email} />
                    <InputField label="Password" required={!editingUser} type="password" value={formData.password} onChange={(v: string) => setFormData({...formData, password: v})} placeholder="••••••••" leftIcon={Lock} error={fieldErrors.password} />
                    
                    <div className="grid grid-cols-2 gap-4">
                      <InputField label="Telegram ID" value={formData.telegram_id} onChange={(v: string) => setFormData({...formData, telegram_id: v})} placeholder="Optional" leftIcon={Hash} />
                      <div className="space-y-1.5">
                        <label className="block text-[11px] font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-0.5 ml-1">Status</label>
                        <select
                          name="status"
                          className="w-full py-3 px-4 bg-gray-50 dark:bg-slate-800/50 border border-transparent focus:border-orange-500/30 rounded-2xl text-sm outline-none transition-all dark:text-gray-100"
                          value={formData.status}
                          onChange={handleInputChange}
                        >
                          <option value="Active">Active</option>
                          <option value="Inactive">Inactive</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Section 2: Roles & Permissions */}
                <div className="space-y-5">
                  <h4 className="text-xs font-bold text-blue-600 uppercase tracking-widest flex items-center gap-2"><Shield className="w-4 h-4"/> Access Control</h4>
                  <div className="space-y-6">
                    <div>
                      <label className="block text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2.5 ml-1">Reporting Line</label>
                      <select
                        name="parent_id"
                        className="w-full py-3 px-4 bg-gray-50 dark:bg-slate-800/50 border border-transparent focus:border-orange-500/30 rounded-2xl text-sm outline-none transition-all dark:text-gray-100 appearance-none"
                        value={formData.parent_id}
                        onChange={handleInputChange}
                      >
                        <option value="">No Parent (Top Level)</option>
                        {users.filter(u => u.id !== editingUser?.id).map(u => (
                          <option key={u.id} value={u.id}>{u.name} (@{u.username})</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2.5 ml-1">System Roles</label>
                      <div className="flex flex-wrap gap-2 p-3 bg-gray-50 dark:bg-slate-800/50 rounded-2xl border border-dashed border-gray-200 dark:border-slate-700">
                        {roles.map(role => {
                          const isSelected = formData.role_ids.includes(role.id);
                          return (
                            <button
                              key={role.id}
                              type="button"
                              onClick={() => handleMultiSelect("role_ids", role.id)}
                              className={cn(
                                "px-3 py-1.5 rounded-xl text-[10px] font-bold transition-all border",
                                isSelected 
                                  ? "bg-orange-500 border-orange-500 text-white shadow-lg shadow-orange-200 dark:shadow-none" 
                                  : "bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-700 text-gray-500 hover:border-orange-300"
                              )}
                            >
                              {role.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2.5 ml-1">Assigned Houses</label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3 bg-gray-50 dark:bg-slate-800/50 rounded-2xl border border-dashed border-gray-200 dark:border-slate-700 max-h-[160px] overflow-y-auto custom-scrollbar">
                        {houses.map(house => {
                          const isSelected = formData.house_ids.includes(house.id);
                          return (
                            <button
                              key={house.id}
                              type="button"
                              onClick={() => handleMultiSelect("house_ids", house.id)}
                              className={cn(
                                "flex items-center justify-between px-3 py-2.5 rounded-xl text-[10px] font-bold transition-all border text-left",
                                isSelected 
                                  ? "bg-blue-500 border-blue-500 text-white shadow-lg shadow-blue-200 dark:shadow-none" 
                                  : "bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-700 text-gray-500 hover:border-blue-300"
                              )}
                            >
                              <span className="truncate">{house.name}</span>
                              {isSelected && <Check className="w-3 h-3 shrink-0" />}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="mt-10 pt-6 border-t border-gray-50 dark:border-slate-800 flex gap-4">
                <button type="button" onClick={() => setIsFormModalOpen(false)} className="flex-1 py-3 text-sm font-bold text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800 rounded-2xl transition-all">Cancel</button>
                <button type="submit" disabled={formLoading} className="flex-[2] py-3 bg-orange-600 text-white rounded-2xl text-sm font-bold hover:bg-orange-700 transition-all shadow-xl shadow-orange-200 dark:shadow-none flex items-center justify-center gap-2 group">
                  {formLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {editingUser ? "Update Account" : "Create Account"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={isConfirmOpen}
        onClose={() => setIsConfirmOpen(false)}
        onConfirm={handleConfirmDelete}
        type="danger"
        title="Delete User Account?"
        message="Are you sure you want to remove this user? They will lose all access to the system immediately."
        confirmText="Yes, Delete User"
        loading={formLoading}
      />
    </div>
  );
}

// Stats Card Component
function StatCard({ title, value, icon: Icon, color }: any) {
  return (
    <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm flex items-center gap-4 transition-all hover:shadow-md">
      <div className={cn("p-3 rounded-xl text-white shadow-lg", color)}>
        <Icon className="w-6 h-6" />
      </div>
      <div>
        <p className="text-xs text-gray-500 dark:text-gray-400 font-bold uppercase tracking-widest">{title}</p>
        <p className="text-2xl font-black text-gray-900 dark:text-gray-100">{value}</p>
      </div>
    </div>
  );
}

// Reusable Input Field Component
function InputField({ label, value, onChange, placeholder, required = false, type = "text", disabled = false, leftIcon: Icon, error }: any) {
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === "password";
  const inputType = isPassword ? (showPassword ? "text" : "password") : type;

  return (
    <div className="space-y-1.5 text-left">
      <label className="block text-[11px] font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-0.5 ml-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <div className="relative group/input">
        {Icon && (
          <div className={cn(
            "absolute left-4 top-1/2 -translate-y-1/2 transition-colors z-10",
            error ? "text-red-500" : "text-gray-400 group-focus-within/input:text-orange-500"
          )}>
            <Icon className="w-4 h-4" />
          </div>
        )}
        <input
          type={inputType}
          required={required}
          disabled={disabled}
          className={cn(
            "w-full py-3 bg-gray-50 dark:bg-slate-800/50 border transition-all dark:text-gray-100 outline-none disabled:opacity-50 rounded-2xl text-sm",
            Icon ? "pl-11" : "pl-4",
            isPassword ? "pr-12" : "pr-4",
            error 
              ? "border-red-500/50 focus:border-red-500 ring-1 ring-red-500/10" 
              : "border-transparent focus:border-orange-500/30"
          )}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-orange-500 transition-colors"
          >
            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        )}
      </div>
      {error && <p className="text-[10px] text-red-500 font-bold ml-1 animate-in slide-in-from-top-1 duration-200">{error}</p>}
    </div>
  );
}
