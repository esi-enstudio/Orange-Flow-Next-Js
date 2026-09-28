"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface FilterAccordionProps {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Number of active (non-empty) filters in this section, shown as a badge. */
  activeCount?: number;
  defaultOpen?: boolean;
  /** Lets the parent reopen/reset sections, e.g. from a Reset action. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

/**
 * Compact accordion used by every filter category. The header is a real button so
 * it is keyboard reachable, exposes aria-expanded, and animates height with a
 * short, fast transition so filtering never feels sluggish.
 */
export default function FilterAccordion({
  title,
  icon: Icon,
  activeCount = 0,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  children,
}: FilterAccordionProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;

  const contentId = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const [maxHeight, setMaxHeight] = useState(open ? "500px" : "0px");

  useEffect(() => {
    if (contentRef.current) {
      setMaxHeight(open ? `${contentRef.current.scrollHeight}px` : "0px");
    }
  }, [open, children]);

  const toggle = () => {
    const next = !open;
    if (isControlled) onOpenChange?.(next);
    else setUncontrolledOpen(next);
  };

  return (
    <div className="border-b border-gray-100 last:border-b-0 dark:border-slate-800">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={contentId}
        className="group flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-3 text-left transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-inset dark:hover:bg-slate-800/50"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-gray-400 transition-colors group-hover:text-primary-500" />
          <span className="truncate text-[13px] font-semibold text-gray-700 dark:text-gray-200">
            {title}
          </span>
          {activeCount > 0 && (
            <span className="inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-primary-600 px-1.5 text-[10px] font-bold text-white">
              {activeCount}
            </span>
          )}
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-gray-400 transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      </button>
      <div
        id={contentId}
        role="region"
        aria-label={title}
        className="overflow-hidden transition-all duration-200 ease-out"
        style={{ maxHeight }}
      >
        <div
          ref={contentRef}
          className="grid grid-cols-1 gap-2.5 px-3 pb-3 sm:grid-cols-2 lg:grid-cols-3"
        >
          {children}
        </div>
      </div>
    </div>
  );
}
