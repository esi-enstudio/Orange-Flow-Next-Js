"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import apiClient from "@/lib/api";
import { Lock, User, Loader2, AlertCircle, Eye, EyeOff } from "lucide-react";
import { useLanguage } from "@/i18n/useLanguage";

export default function LoginPage() {
  const { login } = useAuth();
  const { t } = useLanguage();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams();
      params.append("username", username);
      params.append("password", password);

      const response = await apiClient.post("auth/login", params, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });
      await login(response.data.access_token);
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      let msg = t('login.invalid_credentials');
      if (typeof detail === "string") msg = detail;
      else if (Array.isArray(detail)) msg = detail.map((e: any) => e.msg).join(", ");
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] dark:bg-slate-950 p-4">
      <div className="max-w-md w-full space-y-8 bg-white dark:bg-slate-900 p-8 rounded-2xl shadow-xl border border-gray-100 dark:border-slate-800">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 bg-primary-500 rounded-xl flex items-center justify-center mb-4">
            <Lock className="text-white h-6 w-6" />
          </div>
          <h2 className="text-3xl font-extrabold text-gray-900 dark:text-gray-100">{t('login.title')}</h2>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            {t('login.subtitle')}
          </p>
        </div>

        {error && (
          <div className="bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 text-red-600 dark:text-red-400 p-3 rounded-lg flex items-center gap-2 text-sm">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        )}

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('login.username_label')}
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <User className="h-4 w-4 text-gray-400" />
                </div>
                <input
                  type="text"
                  required
                  className="appearance-none block w-full pl-10 pr-3 py-2 border border-gray-200 dark:border-slate-800 rounded-lg bg-gray-50 dark:bg-slate-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 transition-all text-sm"
                  placeholder={t('login.username_placeholder')}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('login.password_label')}
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="h-4 w-4 text-gray-400" />
                </div>
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  className="appearance-none block w-full pl-10 pr-10 py-2 border border-gray-200 dark:border-slate-800 rounded-lg bg-gray-50 dark:bg-slate-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 transition-all text-sm"
                  placeholder={t('login.password_placeholder')}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-primary-500 transition-colors"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 h-4" />
                  ) : (
                    <Eye className="h-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <input
                id="remember-me"
                name="remember-me"
                type="checkbox"
                className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded cursor-pointer"
              />
              <label htmlFor="remember-me" className="ml-2 block text-sm text-gray-500 dark:text-gray-400 cursor-pointer">
                {t('login.remember_me')}
              </label>
            </div>
            <div className="text-sm">
              <Link href="#" className="font-medium text-primary-600 hover:text-primary-500">
                {t('login.forgot_password')}
              </Link>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="group relative w-full flex justify-center py-2.5 px-4 border border-transparent text-sm font-bold rounded-lg text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 transition-all disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="animate-spin h-5 w-5" />
            ) : (
              t('login.sign_in')
            )}
          </button>
        </form>

        <div className="text-center mt-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('login.contact_admin')}
          </p>
        </div>
      </div>
    </div>
  );
}
