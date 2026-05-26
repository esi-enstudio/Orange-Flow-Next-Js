"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import apiClient from "@/lib/api";
import { Rocket, ShieldCheck, Database, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";

export default function SetupWizard() {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { refreshStatus } = useAuth();

  const handleInitialize = async () => {
    setStatus("loading");
    setError(null);
    try {
      await apiClient.post("/admin/setup/initialize-system");
      setStatus("success");
      
      // Update global status
      await refreshStatus();
      
      // Redirect to login after 2 seconds
      setTimeout(() => {
        router.push("/login");
      }, 2000);
    } catch (err: any) {
      console.error("Initialization failed", err);
      setStatus("error");
      setError(err.response?.data?.detail || "System initialization failed. Please try again.");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-3xl shadow-xl shadow-slate-200/50 dark:shadow-none border border-slate-100 dark:border-slate-800 p-8 md:p-10 transition-all duration-300">
        <div className="text-center space-y-4">
          <div className="w-20 h-20 bg-orange-100 dark:bg-orange-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6 animate-bounce">
            <Rocket className="w-10 h-10 text-orange-600 dark:text-orange-400" />
          </div>
          
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white">Welcome to OrangeFlow</h1>
          <p className="text-slate-500 dark:text-slate-400">
            System initialization is required before you can start managing your distribution house.
          </p>
        </div>

        <div className="mt-10 space-y-4">
          <div className="flex items-start gap-4 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
            <ShieldCheck className="w-5 h-5 text-green-600 mt-1 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-white">Create Permissions & Roles</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Set up standard roles like Manager, Supervisor, and RSO.</p>
            </div>
          </div>

          <div className="flex items-start gap-4 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
            <Database className="w-5 h-5 text-blue-600 mt-1 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-white">Initialize Super Admin</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Create the primary administrator account for the system.</p>
            </div>
          </div>
        </div>

        <div className="mt-10">
          {status === "idle" || status === "error" ? (
            <button
              onClick={handleInitialize}
              className="w-full py-4 bg-orange-600 hover:bg-orange-700 text-white rounded-2xl font-bold shadow-lg shadow-orange-200 dark:shadow-none transition-all duration-300 flex items-center justify-center gap-2 group"
            >
              Initialize System
              <Rocket className="w-5 h-5 group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
            </button>
          ) : status === "loading" ? (
            <div className="w-full py-4 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-2xl font-bold flex items-center justify-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              Initializing...
            </div>
          ) : (
            <div className="w-full py-4 bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-400 rounded-2xl font-bold flex items-center justify-center gap-2">
              <CheckCircle2 className="w-5 h-5" />
              System Ready!
            </div>
          )}

          {status === "error" && error && (
            <div className="mt-4 p-4 rounded-xl bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 text-sm flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}
        </div>

        <p className="text-center text-xs text-slate-400 mt-8">
          OrangeFlow Management System v2.0
        </p>
      </div>
    </div>
  );
}
