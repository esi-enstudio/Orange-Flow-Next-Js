"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Cookies from "js-cookie";
import apiClient from "@/lib/api";

interface Permission {
  id: number;
  name: string;
}

interface Role {
  id: number;
  name: string;
  permissions: Permission[];
}

interface House {
  id: number;
  name: string;
  code: string;
}

interface User {
  id: number;
  username: string;
  name: string;
  email: string;
  status: string;
  houses?: House[];
  roles?: Role[];
  selected_house_id?: number;
  phone_number?: string;
  telegram_id?: number | string;
  profile_pic?: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  initialized: boolean | null;
  login: (token: string) => Promise<void>;
  logout: () => void;
  refreshStatus: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
  selectedHouse: { id: number } | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState<boolean | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  const checkSystemStatus = async () => {
    try {
      const response = await apiClient.get("admin/setup/status");
      setInitialized(response.data.initialized);
      return response.data.initialized;
    } catch (error) {
      console.error("Failed to check system status", error);
      return true; // Default to true to avoid infinite loops if API fails
    }
  };

  const refreshStatus = async () => {
    await checkSystemStatus();
  };

  const fetchUser = async () => {
    const token = Cookies.get("token");
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }

    try {
      apiClient.defaults.headers.common["Authorization"] = `Bearer ${token}`;
      const response = await apiClient.get("auth/me");
      const userData = response.data;
      setUser(userData);
    } catch (error) {
      console.error("Failed to fetch user", error);
      logout();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      const isInitialized = await checkSystemStatus();
      if (isInitialized) {
        await fetchUser();
      } else {
        setLoading(false);
      }
    };
    init();
  }, []);

  const login = async (token: string) => {
    Cookies.set("token", token, { expires: 30 }); // 30 days
    apiClient.defaults.headers.common["Authorization"] = `Bearer ${token}`;
    await fetchUser();
    router.push("/");
  };

  const logout = () => {
    Cookies.remove("token");
    delete apiClient.defaults.headers.common["Authorization"];
    setUser(null);
    router.push("/login");
  };

  // Protected route logic
  useEffect(() => {
    if (!loading && initialized !== null) {
      if (!initialized && pathname !== "/setup") {
        router.push("/setup");
        return;
      }

      if (initialized && pathname === "/setup") {
        router.push("/login");
        return;
      }

      const isPublicPage = pathname === "/login" || pathname === "/register" || pathname === "/setup" || pathname === "/forgot-password" || pathname === "/reset-password";
      if (!user && !isPublicPage) {
        router.push("/login");
      } else if (user && isPublicPage) {
        router.push("/");
      }
    }
  }, [user, loading, initialized, pathname]);

  const hasPermission = (permission: string): boolean => {
    if (!user || !user.roles) return false;
    
    // Admin and Super Admin roles bypass permission checks
    const isAdmin = user.roles.some(role => 
      role.name.toLowerCase() === "admin" || 
      role.name.toLowerCase() === "super admin" ||
      role.name.toLowerCase() === "super_admin"
    );
    
    if (isAdmin) return true;
    
    // Check if any role contains the required permission
    return user.roles.some(role => 
      role.permissions.some(p => p.name === permission)
    );
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      loading, 
      initialized, 
      login, 
      logout, 
      refreshStatus,
      hasPermission,
      selectedHouse: user?.selected_house_id
        ? { id: user.selected_house_id }
        : user?.houses && user.houses.length > 0
          ? { id: user.houses[0].id }
          : null,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
