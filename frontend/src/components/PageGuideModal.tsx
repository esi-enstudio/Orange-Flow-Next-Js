"use client";

import { useEffect, useMemo, useRef, useState, type ElementType } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { HelpCircle, Info, Lightbulb, ListChecks, ListOrdered, X } from "lucide-react";
import { useLanguage } from "@/i18n/useLanguage";

interface GuideItem {
  title: string;
  desc: string;
}

interface GuideSection {
  id: string;
  label: string;
  icon: ElementType;
  items: GuideItem[];
}

const MAX_ITEMS = 25;

export default function PageGuideModal({ pageKey }: { pageKey: string }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const guide = useMemo(() => {
    const collect = (section: string): GuideItem[] => {
      const prefix = section.charAt(0);
      const items: GuideItem[] = [];
      for (let i = 1; i <= MAX_ITEMS; i++) {
        const titlePath = `${pageKey}.guide.${section}.${prefix}${i}.title`;
        const title = t(titlePath);
        if (title === titlePath) break;
        const descPath = `${pageKey}.guide.${section}.${prefix}${i}.desc`;
        const descRaw = t(descPath);
        items.push({ title, desc: descRaw === descPath ? "" : descRaw });
      }
      return items;
    };

    const overview = t(`${pageKey}.guide.overview`);
    if (overview === `${pageKey}.guide.overview`) return null;

    const rawTitle = t(`${pageKey}.guide.title`);
    const title = rawTitle === `${pageKey}.guide.title` ? t("common.page_guide") : rawTitle;

    const features = collect("features");
    const steps = collect("steps");
    const notes = collect("notes");

    const sections: GuideSection[] = [];
    if (features.length > 0)
      sections.push({ id: "features", label: t(`${pageKey}.guide.features_title`), icon: ListChecks, items: features });
    if (steps.length > 0)
      sections.push({ id: "steps", label: t(`${pageKey}.guide.steps_title`), icon: ListOrdered, items: steps });
    if (notes.length > 0)
      sections.push({ id: "notes", label: t(`${pageKey}.guide.notes_title`), icon: Lightbulb, items: notes });

    return { title, overview, sections };
  }, [pageKey, t]);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const scrollTo = (id: string) => {
    const el = contentRef.current?.querySelector(`#pg-${id}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (!guide) return null;

  const sideNav = [
    { id: "overview", label: t("common.overview") },
    ...guide.sections.map((s) => ({ id: s.id, label: s.label })),
  ];

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={t("common.page_guide_tooltip")}
        aria-label={t("common.page_guide")}
        className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 sm:py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
      >
        <HelpCircle className="w-4 h-4" />
        {t("common.page_guide")}
      </button>

      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {open && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                onClick={() => setOpen(false)}
                className="fixed inset-0 z-[200] flex items-start md:items-center justify-center p-3 sm:p-6 bg-black/60 backdrop-blur-sm"
              >
                <motion.div
                  onClick={(e) => e.stopPropagation()}
                  initial={{ scale: 0.96, opacity: 0, y: 12 }}
                  animate={{ scale: 1, opacity: 1, y: 0 }}
                  exit={{ scale: 0.96, opacity: 0, y: 12 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  className="w-full md:max-w-3xl my-auto bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-gray-100 dark:border-slate-800 flex flex-col overflow-hidden max-h-[92vh]"
                >
                  <div className="flex items-start justify-between gap-4 px-5 sm:px-6 py-4 border-b border-gray-100 dark:border-slate-800 shrink-0">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-500/15 flex items-center justify-center shrink-0">
                        <HelpCircle className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                      </div>
                      <div>
                        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{guide.title}</h2>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{t("common.page_guide_tooltip")}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => setOpen(false)}
                      className="w-11 h-11 rounded-xl flex items-center justify-center text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 transition-all"
                      aria-label={t("common.close")}
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  <div className="flex flex-col md:flex-row overflow-hidden">
                    {sideNav.length > 0 && (
                      <aside className="hidden md:block w-48 shrink-0 border-r border-gray-100 dark:border-slate-800 p-4">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-3">
                          {t("common.page_guide")}
                        </p>
                        <nav className="space-y-1">
                          {sideNav.map((item) => (
                            <button
                              key={item.id}
                              onClick={() => scrollTo(item.id)}
                              className="block w-full text-left px-3 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
                            >
                              {item.label}
                            </button>
                          ))}
                        </nav>
                      </aside>
                    )}

                    <div ref={contentRef} className="flex-1 overflow-y-auto max-h-[calc(92vh-73px)] p-5 sm:p-6 space-y-8">
                      <section id="pg-overview" className="scroll-mt-4">
                        <div className="flex items-center gap-2 mb-3">
                          <Info className="w-4 h-4 text-blue-500" />
                          <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">{t("common.overview")}</h3>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{guide.overview}</p>
                      </section>

                      {guide.sections.map((section) => {
                        const Icon = section.icon;
                        return (
                          <section key={section.id} id={`pg-${section.id}`} className="scroll-mt-4">
                            <div className="flex items-center gap-2 mb-4">
                              <Icon className="w-4 h-4 text-blue-500" />
                              <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">{section.label}</h3>
                            </div>
                            <div className="space-y-4">
                              {section.items.map((item, i) => (
                                <div key={i} className="flex gap-3">
                                  <div className="w-6 h-6 rounded-full bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                                    {i + 1}
                                  </div>
                                  <div>
                                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{item.title}</p>
                                    {item.desc && (
                                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">
                                        {item.desc}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </section>
                        );
                      })}
                    </div>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </>
  );
}