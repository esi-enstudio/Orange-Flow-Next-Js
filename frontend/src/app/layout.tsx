import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AuthProvider } from "@/context/AuthContext";
import { ColorProvider } from "@/context/ColorContext";
import { BrandProvider } from "@/context/BrandContext";
import { Toaster } from "react-hot-toast";
import { Suspense } from "react";
import PageProgressIndicator from "@/components/ui/PageProgressIndicator";
import { DynamicPageTitle } from "@/components/layout/DynamicPageTitle";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "OrangeFlow Management System",
  description: "Professional management dashboard for distribution",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const lang = cookieStore.get("lang")?.value === "bn" ? "bn" : "en";

  return (
    <html lang={lang} suppressHydrationWarning>
      <body suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} antialiased text-gray-900 dark:text-gray-100`}>
        <Suspense fallback={null}>
          <PageProgressIndicator />
        </Suspense>
        <ThemeProvider>
          <AuthProvider>
            <ColorProvider>
              <BrandProvider>
              <DynamicPageTitle />
              <DashboardLayout>
                {children}
              </DashboardLayout>
              <Toaster position="top-center" reverseOrder={false} />
              </BrandProvider>
            </ColorProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
