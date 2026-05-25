"use client";

import { useEffect, useState } from "react";
import apiClient from "@/lib/api";
import { 
  Users, 
  Shield, 
  UserCheck, 
  UserMinus, 
  MoreVertical,
  Mail,
  Calendar,
  Search,
  Plus,
  ChevronLeft,
  ChevronRight,
  X,
  User as UserIcon,
  Lock,
  Loader2,
  AlertCircle
} from "lucide-react";
import { cn } from "@/lib/utils";

interface User {
  id: number;
  username: string;
  name: string;
  email: string;
  status: string;
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState("");
  const [formData, setFormData] = useState({
    username: "",
    name: "",
    email: "",
    password: "",
  });

  const limit = 5;

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const response = await apiClient.get("/users");
      setUsers(response.data);
    } catch (err) {
      console.error("Failed to fetch users", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormLoading(true);
    setFormError("");
    try {
      await apiClient.post("/auth/register", formData);
      setIsModalOpen(false);
      setFormData({ username: "", name: "", email: "", password: "" });
      fetchUsers();
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      setFormError(typeof detail === "string" ? detail : "Failed to create user");
    } finally {
      setFormLoading(false);
    }
  };

  const filteredUsers = users.filter(u => 
    u.name?.toLowerCase().includes(search.toLowerCase()) || 
    u.username?.toLowerCase().includes(search.toLowerCase()) ||
    u.email?.toLowerCase().includes(search.toLowerCase())
  );

  const handleDeleteUser = async (userId: number) => {
    if (!confirm("Are you sure you want to delete this user?")) return;
    try {
      await apiClient.delete(`/users/${userId}`);
      fetchUsers();
    } catch (err) {
      alert("Failed to delete user");
    }
  };

  const paginatedUsers = filteredUsers.slice(page * limit, (page + 1) * limit);
  const totalPages = Math.ceil(filteredUsers.length / limit);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 transition-colors">User Management</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 transition-colors">Manage system access and user roles.</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700 transition-colors shadow-sm shadow-orange-100 dark:shadow-none"
        >
          <Plus className="w-4 h-4" />
          Add User
        </button>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 md:gap-6">
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-gray-100 dark:border-slate-800 shadow-sm flex items-center gap-4 transition-colors">
          <div className="p-3 bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-lg">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">Total Users</p>
            <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{users.length}</p>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-gray-100 dark:border-slate-800 shadow-sm flex items-center gap-4 transition-colors">
          <div className="p-3 bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-400 rounded-lg">
            <UserCheck className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">Active Now</p>
            <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{users.filter(u => u.status === "Active").length}</p>
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-gray-100 dark:border-slate-800 shadow-sm flex items-center gap-4 transition-colors">
          <div className="p-3 bg-orange-50 dark:bg-orange-500/10 text-orange-600 dark:text-orange-400 rounded-lg">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">Admins</p>
            <p className="text-lg font-bold text-gray-900 dark:text-gray-100">1</p>
          </div>
        </div>
      </div>

      {/* DataTable Container */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden transition-colors duration-300">
        <div className="p-4 border-b border-gray-50 dark:border-slate-800 flex items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
            <input 
              type="text" 
              placeholder="Search users..." 
              className="w-full pl-10 pr-4 py-2 bg-gray-50 dark:bg-slate-800 border-none rounded-lg text-sm focus:ring-2 focus:ring-orange-500 transition-all dark:text-gray-100 outline-none"
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
            <p className="text-sm text-gray-500 dark:text-gray-400">Loading records...</p>
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="py-20 text-center">
            <Users className="w-12 h-12 text-gray-200 dark:text-gray-700 mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400 font-medium">No users found</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-gray-50/50 dark:bg-slate-800/50 text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest border-b border-gray-50 dark:border-slate-800">
                    <th className="px-6 py-4">User</th>
                    <th className="px-6 py-4">Access Info</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                  {paginatedUsers.map((u) => (
                    <tr key={u.id} className="hover:bg-gray-50/30 dark:hover:bg-slate-800/30 transition-colors group">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-500/20 flex items-center justify-center text-blue-700 dark:text-blue-400 font-bold transition-colors">
                            {u.name?.charAt(0) || "U"}
                          </div>
                          <div>
                            <p className="font-bold text-gray-900 dark:text-gray-100 text-sm transition-colors">{u.name || "N/A"}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 transition-colors">{u.email || "N/A"}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-xs font-mono font-medium text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-500/10 px-1.5 py-0.5 rounded transition-colors">
                          @{u.username}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={cn(
                          "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold transition-colors uppercase tracking-wider",
                          u.status === "Active" 
                            ? "bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400"
                            : "bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400"
                        )}>
                          <span className={cn("w-1.5 h-1.5 rounded-full", u.status === "Active" ? "bg-green-500" : "bg-red-500")}></span>
                          {u.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-2">
                          <button 
                            onClick={() => handleDeleteUser(u.id)}
                            className="p-2 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg text-gray-400 hover:text-red-600 transition-colors"
                            title="Delete User"
                          >
                            <UserMinus className="w-4 h-4" />
                          </button>
                          <button className="p-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg text-gray-400 dark:text-gray-500 transition-colors">
                            <MoreVertical className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="p-4 border-t border-gray-50 dark:border-slate-800 flex items-center justify-between bg-white dark:bg-slate-900">
              <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                Showing <span className="text-gray-900 dark:text-gray-100">{page * limit + 1}</span> to <span className="text-gray-900 dark:text-gray-100">{Math.min((page + 1) * limit, filteredUsers.length)}</span> of {filteredUsers.length}
              </p>
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="p-2 border border-gray-200 dark:border-slate-800 rounded-lg text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => setPage(p => p + 1)}
                  disabled={page >= totalPages - 1}
                  className="p-2 border border-gray-200 dark:border-slate-800 rounded-lg text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Add User Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-2xl shadow-2xl border border-gray-100 dark:border-slate-800 overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-gray-50 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Add New User</h3>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddUser} className="p-6 space-y-4">
              {formError && (
                <div className="bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 text-red-600 dark:text-red-400 p-3 rounded-lg flex items-center gap-2 text-sm">
                  <AlertCircle className="h-4 w-4" />
                  {formError}
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Full Name</label>
                  <div className="relative">
                    <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      name="name"
                      type="text"
                      required
                      className="w-full pl-10 pr-4 py-2 bg-gray-50 dark:bg-slate-800 border-none rounded-lg text-sm focus:ring-2 focus:ring-orange-500 transition-all dark:text-gray-100 outline-none"
                      placeholder="Enter full name"
                      value={formData.name}
                      onChange={handleInputChange}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Username</label>
                  <div className="relative">
                    <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      name="username"
                      type="text"
                      required
                      className="w-full pl-10 pr-4 py-2 bg-gray-50 dark:bg-slate-800 border-none rounded-lg text-sm focus:ring-2 focus:ring-orange-500 transition-all dark:text-gray-100 outline-none"
                      placeholder="Create username"
                      value={formData.username}
                      onChange={handleInputChange}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Email</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      name="email"
                      type="email"
                      required
                      className="w-full pl-10 pr-4 py-2 bg-gray-50 dark:bg-slate-800 border-none rounded-lg text-sm focus:ring-2 focus:ring-orange-500 transition-all dark:text-gray-100 outline-none"
                      placeholder="Email address"
                      value={formData.email}
                      onChange={handleInputChange}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      name="password"
                      type="password"
                      required
                      className="w-full pl-10 pr-4 py-2 bg-gray-50 dark:bg-slate-800 border-none rounded-lg text-sm focus:ring-2 focus:ring-orange-500 transition-all dark:text-gray-100 outline-none"
                      placeholder="Set password"
                      value={formData.password}
                      onChange={handleInputChange}
                    />
                  </div>
                </div>
              </div>

              <div className="pt-4 flex gap-3">
                <button 
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 py-2 text-sm font-bold text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  disabled={formLoading}
                  className="flex-1 py-2 text-sm font-bold text-white bg-orange-600 hover:bg-orange-700 rounded-lg transition-colors shadow-lg shadow-orange-200 dark:shadow-none disabled:opacity-50"
                >
                  {formLoading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Save User"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
