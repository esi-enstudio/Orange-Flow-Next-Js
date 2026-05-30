"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export const PRIMARY_COLORS = [
  { id: "violet", label: "Violet", hex: "#7c3aed" },
  { id: "blue", label: "Blue", hex: "#2563eb" },
  { id: "emerald", label: "Emerald", hex: "#059669" },
  { id: "orange", label: "Orange", hex: "#ea580c" },
  { id: "rose", label: "Rose", hex: "#e11d48" },
  { id: "amber", label: "Amber", hex: "#d97706" },
] as const;

export type PrimaryColor = (typeof PRIMARY_COLORS)[number]["id"];

interface ColorContextValue {
  primaryColor: PrimaryColor;
  setPrimaryColor: (color: PrimaryColor) => void;
}

const ColorContext = createContext<ColorContextValue | undefined>(undefined);

export function ColorProvider({ children }: { children: ReactNode }) {
  const [primaryColor, setPrimaryColorState] = useState<PrimaryColor>("violet");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("primary-color") as PrimaryColor | null;
    if (stored && PRIMARY_COLORS.some((c) => c.id === stored)) {
      setPrimaryColorState(stored);
    }
    setMounted(true);
  }, []);

  const setPrimaryColor = (color: PrimaryColor) => {
    setPrimaryColorState(color);
    localStorage.setItem("primary-color", color);
  };

  useEffect(() => {
    document.documentElement.setAttribute("data-primary", primaryColor);
  }, [primaryColor]);

  if (!mounted) return <>{children}</>;

  return (
    <ColorContext.Provider value={{ primaryColor, setPrimaryColor }}>
      {children}
    </ColorContext.Provider>
  );
}

export function usePrimaryColor() {
  const ctx = useContext(ColorContext);
  if (!ctx) throw new Error("usePrimaryColor must be used within a ColorProvider");
  return ctx;
}
