"use client";

import React, { useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import apiClient from "@/lib/api";
import { Lock, Loader2, CheckCircle, AlertCircle, Eye, EyeOff } from "lucide-react";
import { useLanguage } from "@/i18n/useLanguage";

function ResetForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const { t } = useLanguage();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError(t("reset_password.mismatch"));
      return;
    }
    if (password.length < 4) {
      setError(t("reset_password.too_short"));
      return;
    }

    setLoading(true);
    try {
      await apiClient.post("auth/reset-password", { token, new_password: password });
      setDone(true);
    } catch (err: unknown) {
      const detail =
        err && typeof err === "object" && "response" in err
          ? (err as any).response?.data?.detail
          : null;
      setError(detail || t("reset_password.error"));
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="text-center">
        <div className="mx-auto h-14 w-14 bg-red-100 dark:bg-red-500/10 rounded-full flex items-center justify-center mb-4">
          <AlertCircle className="h-7 w-7 text-red-600 dark:text-red-400" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">{t("reset_password.invalid_title")}</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">{t("reset_password.invalid_desc")}</p>
        <Link
          href="/forgot-password"
          className="text-sm font-medium text-primary-600 hover:text-primary-500"
        >
          {t("reset_password.request_new")}
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="text-center">
        <div className="mx-auto h-14 w-14 bg-green-100 dark:bg-green-500/10 rounded-full flex items-center justify-center mb-4">
          <CheckCircle className="h-7 w-7 text-green-600 dark:text-green-400" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">{t("reset_password.success_title")}</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">{t("reset_password.success_desc")}</p>
        <Link
          href="/login"
          className="inline-flex items-center justify-center px-6 py-2.5 bg-primary-600 text-white text-sm font-bold rounded-lg hover:bg-primary-700 transition-colors"
        >
          {t("reset_password.go_to_login")}
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="text-center mb-6">
        <div className="mx-auto h-12 w-12 bg-primary-500 rounded-xl flex items-center justify-center mb-4">
          <Lock className="text-white h-6 w-6" />
        </div>
        <h2 className="text-3xl font-extrabold text-gray-900 dark:text-gray-100">{t("reset_password.title")}</h2>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{t("reset_password.subtitle")}</p>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 text-red-600 dark:text-red-400 p-3 rounded-lg flex items-center gap-2 text-sm mb-4">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t("reset_password.new_label")}</label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Lock className="h-4 w-4 text-gray-400" />
            </div>
            <input
              type={showPassword ? "text" : "password"}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="appearance-none block w-full pl-10 pr-10 py-2.5 border border-gray-200 dark:border-slate-800 rounded-lg bg-gray-50 dark:bg-slate-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 transition-all text-sm"
              placeholder={t("reset_password.new_placeholder")}
            />
            <button
              type="button"
              className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-primary-500 transition-colors"
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t("reset_password.confirm_label")}</label>
          <input
            type="password"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="appearance-none block w-full px-4 py-2.5 border border-gray-200 dark:border-slate-800 rounded-lg bg-gray-50 dark:bg-slate-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 transition-all text-sm"
            placeholder={t("reset_password.confirm_placeholder")}
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full flex justify-center py-2.5 px-4 border border-transparent text-sm font-bold rounded-lg text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 transition-all disabled:opacity-50"
        >
          {loading ? <Loader2 className="animate-spin h-5 w-5" /> : t("reset_password.submit")}
        </button>
      </form>
    </>
  );
}

export default function ResetPasswordPage() {
  const { t } = useLanguage();

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] dark:bg-slate-950 p-4">
      <div className="max-w-md w-full bg-white dark:bg-slate-900 p-8 rounded-2xl shadow-xl border border-gray-100 dark:border-slate-800">
        <Suspense fallback={
          <div className="flex items-center justify-center py-12">
            <Loader2 className="animate-spin h-6 w-6 text-gray-400" />
          </div>
        }>
          <ResetForm />
        </Suspense>
      </div>
    </div>
  );
}
