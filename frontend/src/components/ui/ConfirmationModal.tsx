"use client";

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, Trash2, X, AlertCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";

export type ConfirmType = "warning" | "danger" | "info";

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: ConfirmType;
  loading?: boolean;
}

export function ConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  type = "warning",
  loading = false,
}: ConfirmationModalProps) {
  
  const config = {
    warning: {
      icon: AlertTriangle,
      iconBg: "bg-yellow-100 dark:bg-yellow-500/20",
      iconColor: "text-yellow-600 dark:text-yellow-400",
      btnBg: "bg-yellow-600 hover:bg-yellow-700",
      borderColor: "border-yellow-200 dark:border-yellow-500/20"
    },
    danger: {
      icon: Trash2,
      iconBg: "bg-red-100 dark:bg-red-500/20",
      iconColor: "text-red-600 dark:text-red-400",
      btnBg: "bg-red-600 hover:bg-red-700",
      borderColor: "border-red-200 dark:border-red-500/20"
    },
    info: {
      icon: Info,
      iconBg: "bg-blue-100 dark:bg-blue-500/20",
      iconColor: "text-blue-600 dark:text-blue-400",
      btnBg: "bg-blue-600 hover:bg-blue-700",
      borderColor: "border-blue-200 dark:border-blue-500/20"
    }
  };

  const current = config[type];
  const Icon = current.icon;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
      <motion.div 
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-3xl shadow-2xl border border-gray-100 dark:border-slate-800 overflow-hidden"
      >
        <div className="p-8 flex flex-col items-center text-center">
          <div className={cn("w-20 h-20 rounded-full flex items-center justify-center mb-6", current.iconBg)}>
            <Icon className={cn("w-10 h-10", current.iconColor)} />
          </div>
          
          <h3 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            {title}
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
            {message}
          </p>
        </div>

        <div className="p-6 pt-0 flex flex-col gap-3">
          <button
            onClick={onConfirm}
            disabled={loading}
            className={cn(
              "w-full py-4 rounded-2xl text-white font-bold transition-all shadow-lg active:scale-[0.98] disabled:opacity-50",
              current.btnBg
            )}
          >
            {loading ? "Processing..." : confirmText}
          </button>
          <button
            onClick={onClose}
            disabled={loading}
            className="w-full py-4 rounded-2xl text-gray-500 dark:text-gray-400 font-bold hover:bg-gray-50 dark:hover:bg-slate-800 transition-all"
          >
            {cancelText}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
