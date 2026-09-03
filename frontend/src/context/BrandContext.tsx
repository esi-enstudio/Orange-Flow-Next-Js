"use client";
import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import apiClient, { resolveImageUrl } from "@/lib/api";
import { useAuth } from "./AuthContext";

interface Brand {
  app_name: string;
  logo: string | null;
  favicon: string | null;
}

interface BrandContextType {
  brand: Brand;
  refreshBrand: () => void;
  updateBrand: (b: Brand) => void;
}

const BrandContext = createContext<BrandContextType>({
  brand: { app_name: "OrangeFlow", logo: null, favicon: null },
  refreshBrand: () => {},
  updateBrand: () => {},
});

export function BrandProvider({ children }: { children: ReactNode }) {
  const [brand, setBrand] = useState<Brand>({ app_name: "OrangeFlow", logo: null, favicon: null });
  const { user, loading } = useAuth();

  const fetchBrand = () => {
    apiClient.get("settings/brand").then(res => {
      setBrand({
        ...res.data,
        logo: resolveImageUrl(res.data.logo),
        favicon: resolveImageUrl(res.data.favicon),
      });
    }).catch(() => {});
  };

  useEffect(() => {
    if (!loading && user) {
      fetchBrand();
    }
  }, [loading, user]);

  useEffect(() => {
    if (!brand.favicon) return;
    let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = brand.favicon;
  }, [brand.favicon]);

  return (
    <BrandContext.Provider value={{ brand, refreshBrand: fetchBrand, updateBrand: setBrand }}>
      {children}
    </BrandContext.Provider>
  );
}

export function useBrand() {
  return useContext(BrandContext);
}
