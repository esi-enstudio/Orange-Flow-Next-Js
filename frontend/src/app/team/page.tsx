"use client";

import { useEffect, useState } from "react";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Users, Phone, Shield, Loader2 } from "lucide-react";
import { useLanguage } from "@/i18n/useLanguage";
import Link from "next/link";

interface TeamMember {
  user_id: number;
  name: string;
  username: string;
  phone: string;
  employee_id: string;
  dms_code: string;
  status: string;
}

export default function TeamPage() {
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const { user, loading: authLoading, hasPermission } = useAuth();
  const { t } = useLanguage();

  useEffect(() => {
    if (authLoading || !user) return;
    if (!hasPermission("employees.view")) { setLoading(false); return; }
    setLoading(true);
    apiClient.get(`employees/supervisor-team/${user.id}`)
      .then(res => setTeam(res.data?.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [authLoading, user]);

  if (authLoading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="w-8 h-8 animate-spin text-primary-500" /></div>;
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">My Team</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {team.length} RSO{team.length !== 1 ? 's' : ''} assigned to you
          </p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 bg-gray-100 dark:bg-slate-800 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : team.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Users className="w-16 h-16 text-gray-300 dark:text-gray-600 mb-4" />
          <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300">No RSOs assigned yet</h3>
          <p className="text-sm text-gray-500 mt-2">Contact your administrator to assign RSOs to you.</p>
          <Link href="/assign" className="mt-4 px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 transition-colors">
            Assign RSOs
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {team.map((member) => (
            <div key={member.user_id} className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm p-5 flex items-center gap-4 hover:shadow-md transition-shadow">
              <div className="w-10 h-10 rounded-full bg-primary-100 dark:bg-primary-500/20 flex items-center justify-center text-primary-600 dark:text-primary-400 font-bold text-sm flex-shrink-0">
                {member.name?.charAt(0) || "R"}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{member.name || member.username}</p>
                <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {member.employee_id && <span>{member.employee_id}</span>}
                  {member.dms_code && <span>{member.dms_code}</span>}
                </div>
              </div>
              <div className="flex items-center gap-3 text-xs text-gray-400">
                {member.phone && (
                  <a href={`tel:${member.phone}`} className="flex items-center gap-1 hover:text-primary-500">
                    <Phone className="w-3.5 h-3.5" /> {member.phone}
                  </a>
                )}
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                  member.status === "Active"
                    ? "bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-400"
                    : "bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400"
                }`}>
                  {member.status || "Unknown"}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
