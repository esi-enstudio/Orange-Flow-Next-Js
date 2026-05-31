"use client";

import React, { useState } from "react";
import Link from "next/link";
import apiClient from "@/lib/api";
import { Mail, ArrowLeft, Loader2, CheckCircle, AlertCircle } from "lucide-react";
import { useLanguage } from "@/i18n/useLanguage";

export default function ForgotPasswordPage() {
  const { t } = useLanguage();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      await apiClient.post("auth/forgot-password", { email });
      setSent(true);
    } catch {
      setError(t("forgot_password.error"));
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] dark:bg-slate-950 p-4">
        <div className="max-w-md w-full bg-white dark:bg-slate-900 p-8 rounded-2xl shadow-xl border border-gray-100 dark:border-slate-800 text-center">
          <div className="mx-auto h-14 w-14 bg-green-100 dark:bg-green-500/10 rounded-full flex items-center justify-center mb-4">
            <CheckCircle className="h-7 w-7 text-green-600 dark:text-green-400" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">{t("forgot_password.check_email")}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">{t("forgot_password.sent_desc")}</p>
          <Link
            href="/login"
            className="inline-flex items-center gap-2 text-sm font-medium text-primary-600 hover:text-primary-500"
          >
            <ArrowLeft className="h-4 w-4" /> {t("forgot_password.back_to_login")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] dark:bg-slate-950 p-4">
      <div className="max-w-md w-full bg-white dark:bg-slate-900 p-8 rounded-2xl shadow-xl border border-gray-100 dark:border-slate-800">
        <div className="text-center mb-6">
          <div className="mx-auto h-12 w-12 bg-primary-500 rounded-xl flex items-center justify-center mb-4">
            <Mail className="text-white h-6 w-6" />
          </div>
          <h2 className="text-3xl font-extrabold text-gray-900 dark:text-gray-100">{t("forgot_password.title")}</h2>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{t("forgot_password.subtitle")}</p>
        </div>

        {error && (
          <div className="bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 text-red-600 dark:text-red-400 p-3 rounded-lg flex items-center gap-2 text-sm mb-4">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t("forgot_password.email_label")}</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="appearance-none block w-full px-4 py-2.5 border border-gray-200 dark:border-slate-800 rounded-lg bg-gray-50 dark:bg-slate-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 transition-all text-sm"
              placeholder={t("forgot_password.email_placeholder")}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex justify-center py-2.5 px-4 border border-transparent text-sm font-bold rounded-lg text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 transition-all disabled:opacity-50"
          >
            {loading ? <Loader2 className="animate-spin h-5 w-5" /> : t("forgot_password.send")}
          </button>
        </form>

        <div className="mt-6 text-center">
          <Link
            href="/login"
            className="inline-flex items-center gap-2 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-primary-600 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" /> {t("forgot_password.back_to_login")}
          </Link>
        </div>
      </div>
    </div>
  );
}
