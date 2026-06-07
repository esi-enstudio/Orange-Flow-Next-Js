"use client";

import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import apiClient from "@/lib/api";
import {
  Rocket, ShieldCheck, Database, Loader2, CheckCircle2, AlertCircle,
  Upload, Building2, Radio, Users, Store, ChevronRight, ChevronLeft,
  Check, FileSpreadsheet, BarChart3, ArrowRight, Sparkles, Server,
  Globe, Eye, EyeOff, RefreshCw, UserPlus,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import { cn } from "@/lib/utils";

const STEPS = [
  { key: "welcome",      icon: Rocket,         title: "Welcome",         desc: "System Introduction" },
  { key: "initialize",   icon: Server,          title: "System Init",     desc: "Permissions & Admin" },
  { key: "houses",       icon: Building2,       title: "Houses",          desc: "Step 1 — Import Houses (no dependencies)" },
  { key: "bts",          icon: Radio,           title: "BTS Codes",       desc: "Step 2 — Import BTS (depends on houses)" },
  { key: "users",        icon: UserPlus,        title: "Users",           desc: "Step 3 — Import Users (independent)" },
  { key: "employees",    icon: Users,           title: "Employees",       desc: "Step 4 — Import Employees (depends on houses + users)" },
  { key: "retailers",    icon: Store,           title: "Retailers",       desc: "Step 5 — Import Retailers (depends on houses + employees)" },
  { key: "complete",     icon: Sparkles,        title: "Complete",       desc: "All Set!" },
];

type StepKey = typeof STEPS[number]["key"];
type ImportStatus = "idle" | "uploading" | "success" | "error";

interface ImportState {
  status: ImportStatus;
  progress: string;
  count: number;
  fileName: string;
}

const INIT_IMPORT: ImportState = { status: "idle", progress: "", count: 0, fileName: "" };

export default function SetupWizard() {
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(0);
  const router = useRouter();
  const { refreshStatus } = useAuth();
  const { t } = useLanguage();

  const [initStatus, setInitStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [initError, setInitError] = useState<string | null>(null);
  const [showPwd, setShowPwd] = useState(false);

  const [houses, setHouses] = useState<ImportState>(INIT_IMPORT);
  const [bts, setBts] = useState<ImportState>(INIT_IMPORT);
  const [users, setUsers] = useState<ImportState>(INIT_IMPORT);
  const [employees, setEmployees] = useState<ImportState>(INIT_IMPORT);
  const [retailers, setRetailers] = useState<ImportState>(INIT_IMPORT);
  const [dragOver, setDragOver] = useState(false);
  const dragCounter = useRef(0);

  const houseInput = useRef<HTMLInputElement>(null);
  const btsInput = useRef<HTMLInputElement>(null);
  const usersInput = useRef<HTMLInputElement>(null);
  const empInput = useRef<HTMLInputElement>(null);
  const retInput = useRef<HTMLInputElement>(null);

  const nextStep = () => { setDirection(1); setStep(s => Math.min(s + 1, STEPS.length - 1)); };
  const prevStep = () => { setDirection(-1); setStep(s => Math.max(s - 1, 0)); };
  const isLast = step === STEPS.length - 1;

  const handleInitialize = async () => {
    setInitStatus("loading");
    setInitError(null);
    try {
      await apiClient.post("admin/setup/initialize-system");
      setInitStatus("success");
    } catch (err: any) {
      setInitStatus("error");
      setInitError(err?.response?.data?.detail || "Initialization failed");
    }
  };

  const uploadFile = useCallback(async (file: File, endpoint: string, setter: (value: ImportState | ((prev: ImportState) => ImportState)) => void) => {
    setter({ status: "uploading", progress: "Starting upload...", count: 0, fileName: file.name });
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch(`${apiClient.defaults.baseURL}/admin/setup/import/${endpoint}`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        setter({ status: "error", progress: "Upload failed", count: 0, fileName: file.name });
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const lines = chunk.split("\n").filter(l => l.startsWith("data: "));
        for (const line of lines) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "progress") {
              setter((s: ImportState) => ({ ...s, progress: data.message }));
            } else if (data.type === "complete") {
              setter({ status: "success", progress: "", count: data.count, fileName: file.name });
            } else if (data.type === "error") {
              setter({ status: "error", progress: data.message, count: 0, fileName: file.name });
            }
          } catch { }
        }
      }
    } catch {
      setter({ status: "error", progress: "Network error", count: 0, fileName: file.name });
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (dragCounter.current === 1) setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) setDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, setter: (value: ImportState | ((prev: ImportState) => ImportState)) => void, endpoint: string) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) uploadFile(f, endpoint, setter);
  }, [uploadFile]);

  const handleFinish = async () => {
    await refreshStatus();
    router.push("/login");
  };

  const STEP_IMPORTS = [
    { key: "houses",    state: houses,    setter: setHouses,    inputRef: houseInput, label: "Houses / Distributors" },
    { key: "bts",       state: bts,       setter: setBts,       inputRef: btsInput,   label: "BTS Codes" },
    { key: "users",     state: users,     setter: setUsers,     inputRef: usersInput, label: "Users" },
    { key: "employees", state: employees,  setter: setEmployees,  inputRef: empInput,   label: "Employees" },
    { key: "retailers", state: retailers,  setter: setRetailers,  inputRef: retInput,   label: "Retailers" },
  ];

  const imp = STEP_IMPORTS[step - 2];

  const variants = {
    enter: (d: number) => ({ x: d > 0 ? 300 : -300, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (d: number) => ({ x: d > 0 ? -300 : 300, opacity: 0 }),
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 flex items-center justify-center p-4 overflow-hidden">
      {/* Bg decorative blobs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-32 -right-32 w-96 h-96 bg-primary-500/5 dark:bg-primary-500/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-32 -left-32 w-80 h-80 bg-blue-500/5 dark:bg-blue-500/5 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/3 w-64 h-64 bg-violet-500/5 dark:bg-violet-500/5 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-3xl relative z-10">
        {/* Step indicator */}
        <div className="mb-8">
          <div className="flex items-center justify-center gap-1">
            {STEPS.map((s, i) => (
              <div key={s.key} className="flex items-center">
                <div className={cn(
                  "flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold transition-all duration-300 shrink-0",
                  i < step ? "bg-primary-500 text-white shadow-md shadow-primary-500/30" :
                  i === step ? "bg-primary-500 text-white ring-2 ring-primary-200 dark:ring-primary-500/40 shadow-lg shadow-primary-500/30 scale-110" :
                  "bg-gray-100 dark:bg-slate-800 text-gray-400 dark:text-gray-500"
                )}>
                  {i < step ? <Check className="w-3.5 h-3.5" /> : i + 1}
                </div>
                {i < STEPS.length - 1 && (
                  <div className={cn(
                    "w-8 sm:w-12 h-0.5 mx-1 transition-all duration-500",
                    i < step ? "bg-primary-400" : "bg-gray-200 dark:bg-slate-700"
                  )} />
                )}
              </div>
            ))}
          </div>
          <p className="text-center text-xs text-gray-400 dark:text-gray-500 mt-2 font-medium">
            Step {step + 1} of {STEPS.length} — {STEPS[step].desc}
          </p>
        </div>

        {/* Main card */}
        <div className="relative">
          <div className="absolute inset-0 bg-gradient-to-br from-primary-500/5 to-violet-600/5 dark:from-primary-500/10 dark:to-violet-600/10 rounded-3xl blur-sm" />
          <div className="relative bg-white/80 dark:bg-slate-900/90 backdrop-blur-xl rounded-3xl border border-gray-200/50 dark:border-slate-700/50 shadow-2xl shadow-slate-200/50 dark:shadow-none p-8 md:p-10">
            <AnimatePresence mode="wait" custom={direction}>
              <motion.div
                key={step}
                custom={direction}
                variants={variants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              >
                {/* ─── STEP 0: WELCOME ─── */}
                {step === 0 && (
                  <div className="text-center space-y-6">
                    <div className="inline-flex items-center justify-center w-24 h-24 rounded-3xl bg-gradient-to-br from-primary-500 to-violet-600 text-white shadow-xl shadow-primary-500/30 mb-2">
                      <Rocket className="w-12 h-12" />
                    </div>
                    <div>
                      <h1 className="text-3xl md:text-4xl font-extrabold text-gray-900 dark:text-gray-100 tracking-tight">
                        OrangeFlow
                      </h1>
                      <p className="text-lg text-gray-500 dark:text-gray-400 mt-2 max-w-md mx-auto">
                        Distribution House Management System
                      </p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-lg mx-auto">
                      {[
                        { icon: ShieldCheck, label: "Role-based Access", color: "text-blue-500" },
                        { icon: Globe, label: "Multi-house Support", color: "text-emerald-500" },
                        { icon: BarChart3, label: "Real-time Reports", color: "text-amber-500" },
                      ].map((f, i) => (
                        <div key={i} className="flex items-center gap-2 p-3 rounded-xl bg-gray-50 dark:bg-slate-800/50 border border-gray-100 dark:border-slate-700/50">
                          <f.icon className={cn("w-4 h-4 shrink-0", f.color)} />
                          <span className="text-xs font-medium text-gray-600 dark:text-gray-400">{f.label}</span>
                        </div>
                      ))}
                    </div>
                    <p className="text-sm text-gray-400 dark:text-gray-500 max-w-md mx-auto leading-relaxed">
                      Welcome! Let us set up your system in a few simple steps.
                      You can import your existing data from Excel files.
                    </p>
                    <button
                      onClick={nextStep}
                      className="inline-flex items-center gap-2 px-8 py-3.5 bg-primary-600 hover:bg-primary-700 text-white rounded-2xl font-bold shadow-lg shadow-primary-500/25 hover:shadow-primary-500/40 transition-all active:scale-[0.98]"
                    >
                      Get Started
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {/* ─── STEP 1: INITIALIZE ─── */}
                {step === 1 && (
                  <div className="space-y-6">
                    <div className="flex items-center gap-4 mb-2">
                      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-lg shadow-blue-500/30 flex items-center justify-center">
                        <Server className="w-7 h-7" />
                      </div>
                      <div>
                        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">System Initialization</h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Set up permissions, roles, and the Super Admin account</p>
                      </div>
                    </div>

                    <div className="grid gap-3">
                      {[
                        { icon: ShieldCheck, label: "Create Permissions & Roles", desc: "Admin, Manager, Supervisor, RSO, BP, CC roles", done: initStatus === "success" },
                        { icon: Database, label: "Create Super Admin Account", desc: 'Username: "neelemil" / Password: "Admin#123456"', done: initStatus === "success" },
                      ].map((item, i) => (
                        <div key={i} className={cn(
                          "flex items-start gap-4 p-4 rounded-2xl border transition-all",
                          item.done
                            ? "bg-green-50/50 dark:bg-green-500/5 border-green-200 dark:border-green-500/20"
                            : initStatus === "loading"
                              ? "bg-blue-50/50 dark:bg-blue-500/5 border-blue-200 dark:border-blue-500/20"
                              : "bg-gray-50 dark:bg-slate-800/30 border-gray-100 dark:border-slate-700/50"
                        )}>
                          <div className={cn(
                            "w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-all",
                            item.done ? "bg-green-100 dark:bg-green-500/20 text-green-600 dark:text-green-400" :
                            initStatus === "loading" ? "bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400" :
                            "bg-gray-100 dark:bg-slate-700 text-gray-400"
                          )}>
                            {item.done ? <Check className="w-4.5 h-4.5" /> : <item.icon className="w-4.5 h-4.5" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={cn("text-sm font-semibold", item.done ? "text-green-700 dark:text-green-300" : "text-gray-900 dark:text-gray-100")}>
                              {item.label}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{item.desc}</p>
                          </div>
                          {item.done && <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />}
                        </div>
                      ))}
                    </div>

                    {initStatus === "success" && (
                      <div className="p-4 rounded-2xl bg-gradient-to-r from-amber-50 to-yellow-50 dark:from-amber-500/10 dark:to-yellow-500/5 border border-amber-200 dark:border-amber-500/20">
                        <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-2 uppercase tracking-wider">Super Admin Credentials</p>
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-gray-500 w-20">Username:</span>
                            <code className="text-sm font-bold text-gray-900 dark:text-gray-100 bg-white/50 dark:bg-slate-800/50 px-3 py-1 rounded-lg border border-amber-200/50 dark:border-amber-500/20 font-mono">neelemil</code>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-gray-500 w-20">Password:</span>
                            <code className="text-sm font-bold text-gray-900 dark:text-gray-100 bg-white/50 dark:bg-slate-800/50 px-3 py-1 rounded-lg border border-amber-200/50 dark:border-amber-500/20 font-mono">
                              {showPwd ? "Admin#123456" : "••••••••••••"}
                            </code>
                            <button onClick={() => setShowPwd(!showPwd)} className="p-1.5 rounded-lg hover:bg-white/50 dark:hover:bg-slate-800/50 text-gray-400 transition-colors">
                              {showPwd ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {initStatus === "error" && initError && (
                      <div className="p-4 rounded-2xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 flex items-start gap-3">
                        <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                        <p className="text-sm text-red-600 dark:text-red-400">{initError}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* ─── STEPS 2-6: IMPORTS ─── */}
                {step >= 2 && step <= 6 && imp && (
                  <div className="space-y-6">
                    <div className="flex items-center gap-4 mb-2">
                      <div className={cn(
                        "w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg",
                        imp.state.status === "success" ? "bg-gradient-to-br from-green-500 to-emerald-600 shadow-green-500/30" :
                        imp.state.status === "uploading" ? "bg-gradient-to-br from-primary-500 to-violet-600 shadow-primary-500/30" :
                        "bg-gradient-to-br from-primary-500 to-violet-600 shadow-primary-500/30"
                      )}>
                        {imp.state.status === "success" ? <CheckCircle2 className="w-7 h-7 text-white" /> :
                         imp.state.status === "uploading" ? <Loader2 className="w-7 h-7 text-white animate-spin" /> :
                         <Upload className="w-7 h-7 text-white" />}
                      </div>
                      <div>
                        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Import {imp.label}</h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          {imp.state.status === "idle" && "Upload an Excel file with your data"}
                          {imp.state.status === "uploading" && "Processing your file..."}
                          {imp.state.status === "success" && `Successfully imported ${imp.state.count} records`}
                          {imp.state.status === "error" && imp.state.progress}
                        </p>
                      </div>
                    </div>

                    {/* Drop zone */}
                    <div
                      onClick={() => imp.inputRef.current?.click()}
                      onDragOver={handleDragOver}
                      onDragEnter={handleDragEnter}
                      onDragLeave={handleDragLeave}
                      onDrop={e => handleDrop(e, imp.setter, imp.key)}
                      className={cn(
                        "relative border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all duration-300",
                        dragOver
                          ? "border-primary-400 dark:border-primary-400 bg-primary-50 dark:bg-primary-500/10 scale-[1.02]"
                          : imp.state.status === "success"
                          ? "border-green-300 dark:border-green-500/30 bg-green-50/50 dark:bg-green-500/5"
                          : imp.state.status === "uploading"
                            ? "border-primary-300 dark:border-primary-500/30 bg-primary-50/50 dark:bg-primary-500/5"
                            : imp.state.status === "error"
                              ? "border-red-300 dark:border-red-500/30 bg-red-50/50 dark:bg-red-500/5"
                              : "border-gray-300 dark:border-slate-600 hover:border-primary-400 dark:hover:border-primary-500 bg-gray-50/50 dark:bg-slate-800/30 hover:bg-primary-50/30 dark:hover:bg-primary-500/5"
                      )}
                    >
                      <input
                        ref={imp.inputRef}
                        type="file"
                        accept=".xlsx,.xls"
                        className="hidden"
                        onChange={e => {
                          const f = e.target.files?.[0];
                          if (f) uploadFile(f, imp.key, imp.setter);
                        }}
                      />
                      {imp.state.status === "idle" && (
                        <div className="space-y-3">
                          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gray-100 dark:bg-slate-700 text-gray-400 dark:text-gray-500">
                            <Upload className="w-8 h-8" />
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                              Drop your Excel file here or <span className="text-primary-600 dark:text-primary-400 underline underline-offset-2">browse</span>
                            </p>
                            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">.xlsx or .xls format</p>
                          </div>
                        </div>
                      )}
                      {imp.state.status === "uploading" && (
                        <div className="space-y-3">
                          <Loader2 className="w-10 h-10 animate-spin text-primary-500 mx-auto" />
                          <div className="flex items-center justify-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                            <FileSpreadsheet className="w-4 h-4" />
                            {imp.state.fileName}
                          </div>
                          <div className="max-w-xs mx-auto bg-gray-200 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden">
                            <motion.div
                              initial={{ width: "0%" }}
                              animate={{ width: "100%" }}
                              transition={{ duration: 3, repeat: Infinity }}
                              className="h-full bg-gradient-to-r from-primary-500 to-violet-500 rounded-full"
                            />
                          </div>
                          <p className="text-xs text-gray-400 dark:text-gray-500">{imp.state.progress}</p>
                        </div>
                      )}
                      {imp.state.status === "success" && (
                        <div className="space-y-2">
                          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-green-100 dark:bg-green-500/20 text-green-600 dark:text-green-400">
                            <CheckCircle2 className="w-8 h-8" />
                          </div>
                          <p className="text-sm font-semibold text-green-700 dark:text-green-300">
                            {imp.state.count} records imported successfully
                          </p>
                        </div>
                      )}
                      {imp.state.status === "error" && (
                        <div className="space-y-2">
                          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400">
                            <AlertCircle className="w-8 h-8" />
                          </div>
                          <p className="text-sm text-red-600 dark:text-red-400">{imp.state.progress}</p>
                          <button
                            onClick={(e) => { e.stopPropagation(); imp.inputRef.current?.click(); }}
                            className="inline-flex items-center gap-1.5 text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline"
                          >
                            <RefreshCw className="w-3 h-3" /> Try again
                          </button>
                        </div>
                      )}
                    </div>

                    {imp.state.status !== "success" && imp.state.status !== "uploading" && (
                      <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
                        You can skip this step and import data later from the dashboard
                      </p>
                    )}
                  </div>
                )}

                {/* ─── STEP 7: COMPLETE ─── */}
                {step === 7 && (
                  <div className="text-center space-y-6">
                    <div className="inline-flex items-center justify-center w-24 h-24 rounded-3xl bg-gradient-to-br from-green-500 to-emerald-600 text-white shadow-xl shadow-green-500/30 mb-2">
                      <Sparkles className="w-12 h-12" />
                    </div>
                    <div>
                      <h1 className="text-3xl font-extrabold text-gray-900 dark:text-gray-100">
                        All Set!
                      </h1>
                      <p className="text-gray-500 dark:text-gray-400 mt-2 max-w-sm mx-auto">
                        Your system is ready. Here is what we have set up:
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3 max-w-sm mx-auto">
                      {[
                        { icon: ShieldCheck, label: "Permissions & Roles", done: true },
                        { icon: Database, label: "Super Admin", done: true },
                        { icon: Building2, label: "Houses", done: houses.status === "success", count: houses.count },
                        { icon: Radio, label: "BTS Codes", done: bts.status === "success", count: bts.count },
                        { icon: UserPlus, label: "Users", done: users.status === "success", count: users.count },
                        { icon: Users, label: "Employees", done: employees.status === "success", count: employees.count },
                        { icon: Store, label: "Retailers", done: retailers.status === "success", count: retailers.count },
                      ].map((item, i) => (
                        <div key={i} className={cn(
                          "flex items-center gap-2.5 p-3 rounded-xl border transition-all",
                          item.done
                            ? "bg-green-50/50 dark:bg-green-500/5 border-green-200 dark:border-green-500/20"
                            : "bg-gray-50 dark:bg-slate-800/30 border-gray-100 dark:border-slate-700/50"
                        )}>
                          <div className={cn(
                            "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                            item.done ? "bg-green-100 dark:bg-green-500/20 text-green-600 dark:text-green-400" : "bg-gray-100 dark:bg-slate-700 text-gray-400"
                          )}>
                            {item.done ? <Check className="w-4 h-4" /> : <item.icon className="w-4 h-4" />}
                          </div>
                          <div className="text-left min-w-0">
                            <p className={cn("text-xs font-semibold truncate", item.done ? "text-green-700 dark:text-green-300" : "text-gray-500 dark:text-gray-400")}>
                              {item.label}
                            </p>
                            {item.done && item.count !== undefined && item.count > 0 && (
                              <p className="text-[10px] text-gray-400">{item.count} records</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="p-4 rounded-2xl bg-gradient-to-r from-amber-50 to-yellow-50 dark:from-amber-500/10 dark:to-yellow-500/5 border border-amber-200 dark:border-amber-500/20 max-w-sm mx-auto">
                      <p className="text-xs text-amber-700 dark:text-amber-400 font-semibold">Login Credentials</p>
                      <p className="text-sm text-gray-900 dark:text-gray-100 mt-1 font-mono">
                        neelemil / Admin#123456
                      </p>
                    </div>

                    <button
                      onClick={handleFinish}
                      className="inline-flex items-center gap-2 px-8 py-3.5 bg-primary-600 hover:bg-primary-700 text-white rounded-2xl font-bold shadow-lg shadow-primary-500/25 hover:shadow-primary-500/40 transition-all active:scale-[0.98]"
                    >
                      Go to Login
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>

            {/* Navigation buttons */}
            <div className="flex items-center justify-between mt-8 pt-6 border-t border-gray-100 dark:border-slate-700/50">
              <button
                onClick={prevStep}
                disabled={step === 0}
                className={cn(
                  "inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-sm font-medium transition-all",
                  step === 0
                    ? "text-gray-300 dark:text-gray-600 cursor-not-allowed"
                    : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800"
                )}
              >
                <ChevronLeft className="w-4 h-4" /> Back
              </button>

              <div className="flex items-center gap-3">
                {/* Step 1: Init button */}
                {step === 1 && initStatus !== "success" && (
                  <button
                    onClick={handleInitialize}
                    disabled={initStatus === "loading"}
                    className="px-6 py-2.5 rounded-xl text-sm font-bold text-white bg-primary-600 hover:bg-primary-700 shadow-lg shadow-primary-500/20 disabled:opacity-60 disabled:cursor-not-allowed transition-all inline-flex items-center gap-2"
                  >
                    {initStatus === "loading" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
                    Initialize System
                  </button>
                )}
                {step === 1 && initStatus === "success" && (
                  <button
                    onClick={nextStep}
                    className="px-6 py-2.5 rounded-xl text-sm font-bold text-white bg-green-600 hover:bg-green-700 shadow-lg shadow-green-500/20 transition-all inline-flex items-center gap-2"
                  >
                    Continue <ChevronRight className="w-4 h-4" />
                  </button>
                )}

                {/* Steps 2-6: Skip / Next */}
                {step >= 2 && step <= 6 && (
                  <>
                    {imp.state.status === "success" ? (
                      <button
                        onClick={nextStep}
                        className="px-6 py-2.5 rounded-xl text-sm font-bold text-white bg-green-600 hover:bg-green-700 shadow-lg shadow-green-500/20 transition-all inline-flex items-center gap-2"
                      >
                        Next Step <ChevronRight className="w-4 h-4" />
                      </button>
                    ) : (
                      <button
                        onClick={nextStep}
                        className="px-5 py-2.5 rounded-xl text-sm font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 transition-all"
                      >
                        Skip for now
                      </button>
                    )}
                  </>
                )}

                {/* Last step */}
                {isLast && (
                  <button
                    onClick={handleFinish}
                    className="px-6 py-2.5 rounded-xl text-sm font-bold text-white bg-primary-600 hover:bg-primary-700 shadow-lg shadow-primary-500/20 transition-all inline-flex items-center gap-2"
                  >
                    Go to Login <ArrowRight className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-gray-400 dark:text-gray-600 mt-6">
          OrangeFlow Management System v2.0
        </p>
      </div>
    </div>
  );
}

