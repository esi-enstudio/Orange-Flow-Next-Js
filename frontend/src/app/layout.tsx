import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AuthProvider } from "@/context/AuthContext";
import { ColorProvider } from "@/context/ColorContext";
import { BrandProvider } from "@/context/BrandContext";
import { EntitlementsProvider } from "@/context/EntitlementsContext";
import { ModuleAccessGuard } from "@/components/layout/ModuleAccessGuard";
import { FullscreenProvider } from "@/context/FullscreenContext";
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

const EXTENSION_ATTRIBUTES = ["bis_skin_checked"] as const;

const EXTENSION_CLEANUP_SCRIPT = `
(() => {
  const attributes = ${JSON.stringify(EXTENSION_ATTRIBUTES)};
  const strip = (root) => {
    if (!(root instanceof Element)) return;

    for (const attribute of attributes) {
      root.removeAttribute(attribute);
      for (const element of root.querySelectorAll("[" + attribute + "]")) {
        element.removeAttribute(attribute);
      }
    }
  };

  strip(document.documentElement);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        mutation.target.removeAttribute(mutation.attributeName);
      } else {
        for (const node of mutation.addedNodes) strip(node);
      }
    }
  });

  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [...attributes],
    childList: true,
    subtree: true,
  });

  setTimeout(() => observer.disconnect(), 10000);
})();
`;

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
        {process.env.NODE_ENV === "development" ? (
          <script
            type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
            suppressHydrationWarning
            dangerouslySetInnerHTML={{ __html: EXTENSION_CLEANUP_SCRIPT }}
          />
        ) : null}
        <Suspense fallback={null}>
          <PageProgressIndicator />
        </Suspense>
        <ThemeProvider>
          <AuthProvider>
            <ColorProvider>
              <BrandProvider>
              <EntitlementsProvider>
              <FullscreenProvider>
              <DynamicPageTitle />
              <DashboardLayout>
                <ModuleAccessGuard>
                  {children}
                </ModuleAccessGuard>
              </DashboardLayout>
              <Toaster position="top-center" reverseOrder={false} />
              </FullscreenProvider>
              </EntitlementsProvider>
              </BrandProvider>
            </ColorProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
