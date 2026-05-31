"use client";

import { useEffect, useState, useCallback } from "react";
import apiClient from "@/lib/api";
import { useLanguage } from "@/i18n/useLanguage";
import {
  Plus,
  Search,
  ListTodo,
  Loader2,
  Circle,
  CheckCircle2,
  Trash2,
  Edit3,
  X,
  ChevronDown,
  Calendar,
  AlertCircle,
  Clock,
  Flag,
} from "lucide-react";
import { toast } from "react-hot-toast";
import { cn } from "@/lib/utils";

interface Todo {
  id: number;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  due_date: string | null;
  created_at: string | null;
}

export default function TodosPage() {
  const { t } = useLanguage();
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "pending" | "completed">("all");
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");
  const [dueDate, setDueDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  const fetchTodos = useCallback(async () => {
    try {
      const res = await apiClient.get("todos");
      setTodos(res.data);
    } catch {
      console.error("Failed to fetch todos");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTodos();
  }, [fetchTodos]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        title: title.trim(),
        description: description.trim() || null,
        priority,
        due_date: dueDate ? new Date(dueDate).toISOString() : null,
      };
      if (editingId) {
        await apiClient.put(`todos/${editingId}`, payload);
        toast.success(t("todos.updated"));
      } else {
        await apiClient.post("todos", payload);
        toast.success(t("todos.created"));
      }
      setTitle("");
      setDescription("");
      setPriority("medium");
      setDueDate("");
      setEditingId(null);
      setShowForm(false);
      await fetchTodos();
    } catch {
      console.error("Failed to save todo");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleTodo = async (todo: Todo) => {
    const newStatus = todo.status === "completed" ? "pending" : "completed";
    try {
      await apiClient.put(`todos/${todo.id}`, { status: newStatus });
      setTodos(prev =>
        prev.map(t => (t.id === todo.id ? { ...t, status: newStatus } : t))
      );
      toast(newStatus === "completed" ? t("todos.completed_toast") : t("todos.uncompleted_toast"), { icon: newStatus === "completed" ? "✅" : "↩️" });
    } catch {
      console.error("Failed to toggle todo");
    }
  };

  const confirmDelete = async () => {
    if (!deleteConfirm) return;
    try {
      await apiClient.delete(`todos/${deleteConfirm}`);
      setTodos(prev => prev.filter(t => t.id !== deleteConfirm));
      toast.success(t("todos.deleted"));
    } catch {
      console.error("Failed to delete todo");
    } finally {
      setDeleteConfirm(null);
    }
  };

  const editTodo = (todo: Todo) => {
    setTitle(todo.title);
    setDescription(todo.description || "");
    setPriority(todo.priority);
    setDueDate(
      todo.due_date ? new Date(todo.due_date).toISOString().slice(0, 16) : ""
    );
    setEditingId(todo.id);
    setShowForm(true);
  };

  const filteredTodos = todos.filter(t => {
    if (filter === "pending" && t.status === "completed") return false;
    if (filter === "completed" && t.status === "pending") return false;
    if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const pendingCount = todos.filter(t => t.status === "pending").length;
  const completedCount = todos.filter(t => t.status === "completed").length;

  const priorityLabel = (p: string) => {
    switch (p) {
      case "high": return t("todos.priority_high");
      case "low": return t("todos.priority_low");
      default: return t("todos.priority_medium");
    }
  };

  const priorityColor = (p: string) => {
    switch (p) {
      case "high": return "text-red-600 bg-red-50 dark:bg-red-500/10";
      case "low": return "text-gray-500 bg-gray-50 dark:bg-gray-500/10";
      default: return "text-amber-600 bg-amber-50 dark:bg-amber-500/10";
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100 flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-primary-500 text-white shadow-lg shadow-primary-200 dark:shadow-none">
              <ListTodo className="w-5 h-5" />
            </div>
            {t("todos.title")}
          </h1>
          <div className="flex items-center gap-3 mt-1 ml-12">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
              {t("todos.total")}: <strong className="text-gray-900 dark:text-gray-100">{todos.length}</strong>
            </span>
            <span className="w-1 h-1 rounded-full bg-gray-300 dark:bg-gray-600" />
            <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
              {t("todos.pending")}: <strong>{pendingCount}</strong>
            </span>
            <span className="w-1 h-1 rounded-full bg-gray-300 dark:bg-gray-600" />
            <span className="text-xs font-medium text-green-600 dark:text-green-400">
              {t("todos.completed")}: <strong>{completedCount}</strong>
            </span>
          </div>
        </div>
        <button
          onClick={() => {
            setShowForm(true);
            setEditingId(null);
            setTitle("");
            setDescription("");
            setPriority("medium");
            setDueDate("");
          }}
          className="px-4 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-bold hover:bg-primary-700 transition-all shadow-lg shadow-primary-200 dark:shadow-none flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          {t("todos.add_task")}
        </button>
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-gray-100 dark:border-slate-800 w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-gray-50 dark:border-slate-800 flex items-center justify-between">
              <h3 className="font-bold text-lg dark:text-gray-100">
                {editingId ? t("todos.edit_task") : t("todos.new_task")}
              </h3>
              <button
                onClick={() => setShowForm(false)}
                className="p-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg text-gray-400 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t("todos.title_label")}
                </label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-200 dark:border-slate-800 rounded-xl bg-gray-50 dark:bg-slate-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
                  placeholder={t("todos.title_placeholder")}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t("todos.description_label")}
                </label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  rows={3}
                  className="w-full px-4 py-2.5 border border-gray-200 dark:border-slate-800 rounded-xl bg-gray-50 dark:bg-slate-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm resize-none"
                  placeholder={t("todos.description_placeholder")}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t("todos.priority_label")}
                  </label>
                  <div className="relative">
                    <select
                      value={priority}
                      onChange={e => setPriority(e.target.value)}
                      className="w-full px-4 py-2.5 border border-gray-200 dark:border-slate-800 rounded-xl bg-gray-50 dark:bg-slate-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm appearance-none"
                    >
                      <option value="low">{t("todos.priority_low")}</option>
                      <option value="medium">{t("todos.priority_medium")}</option>
                      <option value="high">{t("todos.priority_high")}</option>
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t("todos.due_date_label")}
                  </label>
                  <input
                    type="datetime-local"
                    value={dueDate}
                    onChange={e => setDueDate(e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-200 dark:border-slate-800 rounded-xl bg-gray-50 dark:bg-slate-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
                  />
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="flex-1 py-2.5 border border-gray-200 dark:border-slate-800 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={submitting || !title.trim()}
                  className="flex-1 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-bold hover:bg-primary-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {submitting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : editingId ? (
                    t("todos.save_changes")
                  ) : (
                    t("todos.add_task")
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Search + Filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t("todos.search")}
            className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 transition-all"
          />
        </div>
        <div className="flex gap-1.5 p-1 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl">
          {(["all", "pending", "completed"] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "px-4 py-1.5 text-xs font-bold rounded-lg transition-all",
                filter === f
                  ? "bg-primary-500 text-white shadow-sm"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              )}
            >
              {f === "all" && <>{t("todos.filter_all")} <span className="ml-1 opacity-70">({todos.length})</span></>}
              {f === "pending" && <>{t("todos.filter_pending")} <span className="ml-1 opacity-70">({pendingCount})</span></>}
              {f === "completed" && <>{t("todos.filter_completed")} <span className="ml-1 opacity-70">({completedCount})</span></>}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        </div>
      ) : filteredTodos.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 p-12 text-center">
          <div className="mx-auto w-16 h-16 bg-gray-50 dark:bg-slate-800 rounded-2xl flex items-center justify-center mb-4">
            <ListTodo className="w-8 h-8 text-gray-300 dark:text-gray-600" />
          </div>
          <p className="text-gray-500 dark:text-gray-400 font-medium">{t("todos.no_tasks")}</p>
          {search && (
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">{t("todos.no_search_results")}</p>
          )}
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden divide-y divide-gray-50 dark:divide-slate-800">
          {filteredTodos.map(todo => (
            <div
              key={todo.id}
              className="flex items-start gap-4 px-6 py-4 hover:bg-gray-50/50 dark:hover:bg-slate-800/50 transition-colors group"
            >
              <button
                onClick={() => toggleTodo(todo)}
                className={cn(
                  "flex-shrink-0 mt-0.5 transition-colors",
                  todo.status === "completed"
                    ? "text-green-500 hover:text-green-600"
                    : "text-gray-300 dark:text-gray-600 hover:text-primary-500"
                )}
              >
                {todo.status === "completed" ? (
                  <CheckCircle2 className="w-5 h-5" />
                ) : (
                  <Circle className="w-5 h-5" />
                )}
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p
                    className={cn(
                      "text-sm font-semibold",
                      todo.status === "completed"
                        ? "text-gray-400 line-through"
                        : "text-gray-900 dark:text-gray-100"
                    )}
                  >
                    {todo.title}
                  </p>
                  <span
                    className={cn(
                      "text-[10px] font-bold px-2 py-0.5 rounded-full inline-flex items-center gap-1",
                      priorityColor(todo.priority)
                    )}
                  >
                    <Flag className="w-3 h-3" />
                    {priorityLabel(todo.priority)}
                  </span>
                </div>
                {todo.description && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
                    {todo.description}
                  </p>
                )}
                <div className="flex items-center gap-3 mt-1.5">
                  {todo.due_date && (
                    <span className="text-[10px] text-gray-400 dark:text-gray-500 flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {new Date(todo.due_date).toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  )}
                  <span className="text-[10px] text-gray-400 dark:text-gray-500 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {new Date(todo.created_at!).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => editTodo(todo)}
                  className="p-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg text-gray-400 hover:text-primary-500 transition-colors"
                >
                  <Edit3 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setDeleteConfirm(todo.id)}
                  className="p-2 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg text-gray-400 hover:text-red-500 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete Confirmation */}
      {deleteConfirm !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-gray-100 dark:border-slate-800 w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6">
              <div className="mx-auto w-12 h-12 bg-red-100 dark:bg-red-500/10 rounded-2xl flex items-center justify-center mb-4">
                <AlertCircle className="w-6 h-6 text-red-600 dark:text-red-400" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 text-center mb-2">
                {t("common.confirm_delete_title")}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 text-center mb-6">
                {t("common.confirm_delete_desc")}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="flex-1 py-2.5 border border-gray-200 dark:border-slate-800 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
                >
                  {t("common.cancel")}
                </button>
                <button
                  onClick={confirmDelete}
                  className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-sm font-bold hover:bg-red-700 transition-colors"
                >
                  {t("common.delete")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
