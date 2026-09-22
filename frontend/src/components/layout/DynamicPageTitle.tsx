"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useLanguage } from "@/i18n/useLanguage";
import { navItems } from "@/lib/constants";

const ROUTE_TITLE_MAP: Record<string, { en: string; bn: string }> = {
  "/": { en: "Dashboard", bn: "ড্যাশবোর্ড" },
  "/login": { en: "Sign In", bn: "সাইন ইন" },
  "/register": { en: "Register", bn: "রেজিস্টার" },
  "/setup": { en: "System Setup", bn: "সিস্টেম সেটআপ" },
  "/forgot-password": { en: "Forgot Password", bn: "পাসওয়ার্ড ভুলে গেছেন" },
  "/reset-password": { en: "Reset Password", bn: "পাসওয়ার্ড রিসেট" },
  "/profile": { en: "User Profile", bn: "ব্যবহারকারীর প্রোফাইল" },
  "/settings": { en: "Settings", bn: "সেটিংস" },
  "/deploy": { en: "Deploy & Updates", bn: "ডিপ্লয় ও আপডেট" },
  "/pricing": { en: "Pricing Plans", bn: "মূল্য পরিকল্পনা" },
  "/billing": { en: "Billing & Subscriptions", bn: "বিলিং ও সাবস্ক্রিপশন" },
  "/admin/plans": { en: "Plan Management", bn: "প্ল্যান ব্যবস্থাপনা" },
  "/admin/subscriptions": { en: "Subscription Management", bn: "সাবস্ক্রিপশন ব্যবস্থাপনা" },
  "/zoom-in/create": { en: "Create Zoom-In Event", bn: "নতুন জুম-ইন ইভেন্ট" },
  "/zoom-in/allocation": { en: "Zoom-In Allocation", bn: "জুম-ইন বরাদ্দ" },
  "/zoom-in/eligible-bts": { en: "Eligible BTS", bn: "যোগ্য বিটিএস" },
  "/zoom-in/event-types": { en: "Zoom-In Event Types", bn: "জুম-ইন ইভেন্টের ধরন" },
  "/zoom-in/activity": { en: "Zoom-In Activity", bn: "জুম-ইন অ্যাক্টিভিটি" },
  "/cv/create": { en: "Create Digital CV", bn: "নতুন ডিজিটাল সিভি" },
  "/liftings/create": { en: "Create Lifting", bn: "নতুন লিফটিং" },
  "/liftings/products": { en: "Products", bn: "পণ্য তালিকা" },
  "/retailers/assign-marking": { en: "Assign Markings", bn: "মার্কিং বরাদ্দ" },
  "/retailers/import-marking": { en: "Import Markings", bn: "মার্কিং ইম্পোর্ট" },
  "/retailers/marking-history": { en: "Marking History", bn: "মার্কিং ইতিহাস" },
  "/import/house-targets": { en: "Import House Targets", bn: "হাউস টার্গেট ইম্পোর্ট" },
  "/import/rso-targets": { en: "Import RSO Targets", bn: "আরএসও টার্গেট ইম্পোর্ট" },
  "/import/supervisor-targets": { en: "Import Supervisor Targets", bn: "সুপারভাইজার টার্গেট ইম্পোর্ট" },
  "/database-backups": { en: "Database Backups", bn: "ডাটাবেস ব্যাকআপ" },
  "/bp-retailer-codes": { en: "BP Retailer Codes", bn: "বিপি রিটেইলার কোড" },
};

const PATTERN_TITLES: { match: (p: string) => boolean; en: string; bn: string }[] = [
  { match: (p) => /^\/zoom-in\/\d+/.test(p), en: "Zoom-In Event Details", bn: "জুম-ইন ইভেন্ট বিবরণ" },
  { match: (p) => /^\/cv\/.+\/edit$/.test(p), en: "Edit Digital CV", bn: "সিভি সম্পাদনা" },
  { match: (p) => /^\/cv\/.+/.test(p), en: "Digital CV", bn: "ডিজিটাল সিভি" },
  { match: (p) => /^\/dashboard\//.test(p), en: "Dashboard", bn: "ড্যাশবোর্ড" },
];

function findNavTitle(pathname: string, t: (path: string) => string): string | null {
  for (const item of navItems) {
    if (item.href === pathname && item.translationKey) {
      return t(item.translationKey);
    }
    if (item.children) {
      for (const child of item.children) {
        if (child.href === pathname && child.translationKey) {
          return t(child.translationKey);
        }
        if (child.children) {
          for (const sub of child.children) {
            if (sub.href === pathname && sub.translationKey) {
              return t(sub.translationKey);
            }
          }
        }
      }
    }
  }
  return null;
}

export function DynamicPageTitle() {
  const pathname = usePathname();
  const language = useLanguage((s) => s.language);
  const t = useLanguage((s) => s.t);
  const observerRef = useRef<MutationObserver | null>(null);

  useEffect(() => {
    const siteBrand = "OrangeFlow";
    const resolvedLang = language === "bn" ? "bn" : "en";

    let pageTitle: string | null = null;
    pageTitle = findNavTitle(pathname, t);
    if (!pageTitle && ROUTE_TITLE_MAP[pathname]) {
      pageTitle = resolvedLang === "bn" ? ROUTE_TITLE_MAP[pathname].bn : ROUTE_TITLE_MAP[pathname].en;
    }
    if (!pageTitle) {
      for (const pattern of PATTERN_TITLES) {
        if (pattern.match(pathname)) {
          pageTitle = resolvedLang === "bn" ? pattern.bn : pattern.en;
          break;
        }
      }
    }

    const resolvedTitle = pageTitle ? `${pageTitle} | ${siteBrand}` : `${siteBrand} Management System`;

    const apply = () => {
      if (document.documentElement.lang !== resolvedLang) {
        document.documentElement.lang = resolvedLang;
      }
      if (document.title !== resolvedTitle) {
        document.title = resolvedTitle;
      }
    };

    apply();

    // Next.js metadata re-applies the layout <title> on re-renders, which can
    // clobber our dynamic title after async state settles (e.g. auth load).
    // Watch the <title> element and re-apply our resolved title whenever it changes.
    const titleEl = document.querySelector<HTMLTitleElement>("title");
    if (titleEl) {
      if (observerRef.current) observerRef.current.disconnect();
      const observer = new MutationObserver(() => {
        if (document.title !== resolvedTitle) {
          document.title = resolvedTitle;
        }
      });
      observer.observe(titleEl, { subtree: true, childList: true, characterData: true });
      observerRef.current = observer;
    } else {
      if (observerRef.current) observerRef.current.disconnect();
      observerRef.current = null;
    }

    return () => {
      if (observerRef.current) observerRef.current.disconnect();
      observerRef.current = null;
    };
  }, [pathname, language, t]);

  return null;
}