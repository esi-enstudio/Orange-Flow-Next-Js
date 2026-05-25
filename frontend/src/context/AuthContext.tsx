"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Cookies from "js-cookie";
import apiClient from "@/lib/api";

interface User {
  id: number;
  username: string;
  name: string;
  email: string;
  status: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (token: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  const fetchUser = async () => {
    const token = Cookies.get("token");
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }

    try {
      apiClient.defaults.headers.common["Authorization"] = `Bearer ${token}`;
      const response = await apiClient.get("/auth/me");
      setUser(response.data);
    } catch (error) {
      console.error("Failed to fetch user", error);
      logout();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUser();
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
    if (!loading) {
      const isPublicPage = pathname === "/login" || pathname === "/register";
      if (!user && !isPublicPage) {
        router.push("/login");
      } else if (user && isPublicPage) {
        router.push("/");
      }
    }
  }, [user, loading, pathname]);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
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
