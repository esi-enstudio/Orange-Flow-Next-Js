"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

export default function PageProgressIndicator() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(0);
  const elRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const startProgress = useCallback(() => {
    setVisible(true);
    setProgress(10);
  }, []);

  const completeProgress = useCallback(() => {
    setProgress(100);
    setTimeout(() => {
      setVisible(false);
      setProgress(0);
    }, 350);
  }, []);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (visible && progress < 90) {
      interval = setInterval(() => {
        setProgress((prev) => {
          if (prev >= 90) return prev;
          const diff = (90 - prev) / 20;
          return prev + diff;
        });
      }, 200);
    }
    return () => clearInterval(interval);
  }, [visible, progress]);

  useEffect(() => {
    if (visible) completeProgress();
  }, [pathname, searchParams]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const anchor = target.closest("a");
      if (
        anchor &&
        anchor.href &&
        anchor.href.startsWith(window.location.origin) &&
        !anchor.href.includes("#") &&
        anchor.target !== "_blank" &&
        !e.ctrlKey && !e.shiftKey && !e.metaKey && !e.altKey &&
        anchor.getAttribute("href") !== pathname
      ) {
        startProgress();
      }
    };
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [pathname, startProgress]);

  return (
    <div
      ref={elRef}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: "4px",
        zIndex: 99999,
        pointerEvents: "none",
        opacity: visible ? 1 : 0,
        transition: "opacity 0.2s ease",
      }}
    >
      <div
        ref={barRef}
        style={{
          height: "100%",
          width: `${progress}%`,
          background: "linear-gradient(90deg, #f97316, #ea580c, #f97316)",
          boxShadow: "0 0 12px rgba(249, 115, 22, 0.6)",
          transition: "width 0.3s ease",
          borderRadius: "0 2px 2px 0",
        }}
      />
    </div>
  );
}
