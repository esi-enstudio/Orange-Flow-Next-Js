"use client";

import { useEffect, useState } from "react";
import { Rocket } from "lucide-react";
import apiClient from "@/lib/api";
import DeployModal from "./DeployModal";

interface DeployButtonProps {
  className?: string;
}

export default function DeployButton({ className }: DeployButtonProps) {
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [deployRunning, setDeployRunning] = useState(false);

  const fetchPending = async () => {
    try {
      const res = await apiClient.get("v1/deploy/pending-commits");
      setPendingCount(res.data.count);
    } catch {
      setPendingCount(null);
    }
  };

  const checkDeployStatus = async () => {
    try {
      const res = await apiClient.get("v1/deploy/status");
      setDeployRunning(res.data.state === "running");
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchPending();
    checkDeployStatus();
    const interval = setInterval(() => {
      fetchPending();
      checkDeployStatus();
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <>
      <button
        onClick={() => setModalOpen(true)}
        className={`group relative inline-flex items-center gap-2.5 px-5 py-3 bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 text-white rounded-xl text-sm font-medium transition-all duration-200 shadow-sm hover:shadow-md active:scale-[0.98] ${className ?? ""}`}
      >
        <Rocket className="w-4 h-4" />
        Deploy Now
        {pendingCount !== null && pendingCount > 0 && (
          <span className="absolute -top-2 -right-2 min-w-[20px] h-5 flex items-center justify-center px-1.5 text-[10px] font-bold bg-red-500 text-white rounded-full shadow-md animate-pulse">
            {pendingCount}
          </span>
        )}
        {deployRunning && (
          <span className="absolute -top-2 -right-2 min-w-[20px] h-5 flex items-center justify-center px-1.5 text-[10px] font-bold bg-blue-500 text-white rounded-full shadow-md">
            <span className="w-2 h-2 bg-white rounded-full animate-ping" />
          </span>
        )}
      </button>
      <DeployModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}
