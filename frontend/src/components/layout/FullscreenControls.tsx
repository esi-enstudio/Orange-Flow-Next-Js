"use client";

import { Maximize2, Minimize2, Expand, Shrink } from "lucide-react";
import { useFullscreen } from "@/context/FullscreenContext";
import { useLanguage } from "@/i18n/useLanguage";
import { cn } from "@/lib/utils";

export function FullscreenControls() {
  const {
    isFocusMode,
    toggleFocusMode,
    isNativeFullscreen,
    nativeFullscreenSupported,
    toggleNativeFullscreen,
    shortcutLabel,
  } = useFullscreen();
  const { t } = useLanguage();

  const FocusIcon = isFocusMode ? Minimize2 : Maximize2;
  const focusLabel = isFocusMode ? t("common.fullscreen.focus_off") : t("common.fullscreen.focus_on");

  return (
    <div className="flex items-center p-1 bg-gray-100 dark:bg-slate-800 rounded-lg">
      <button
        type="button"
        onClick={toggleFocusMode}
        aria-pressed={isFocusMode}
        title={`${focusLabel} (${shortcutLabel})`}
        className={cn(
          "p-1.5 rounded-md transition-all cursor-pointer",
          isFocusMode
            ? "bg-white dark:bg-slate-700 text-primary-600 shadow-sm"
            : "text-gray-500 hover:text-gray-900 dark:hover:text-gray-100"
        )}
      >
        <FocusIcon className="w-4 h-4" />
        <span className="sr-only">{focusLabel}</span>
      </button>

      {nativeFullscreenSupported && (
        <button
          type="button"
          onClick={toggleNativeFullscreen}
          aria-pressed={isNativeFullscreen}
          title={
            isNativeFullscreen
              ? t("common.fullscreen.native_exit")
              : t("common.fullscreen.native_enter")
          }
          className={cn(
            "p-1.5 rounded-md transition-all cursor-pointer",
            isNativeFullscreen
              ? "bg-white dark:bg-slate-700 text-primary-600 shadow-sm"
              : "text-gray-500 hover:text-gray-900 dark:hover:text-gray-100"
          )}
        >
          {isNativeFullscreen ? <Shrink className="w-4 h-4" /> : <Expand className="w-4 h-4" />}
          <span className="sr-only">
            {isNativeFullscreen
              ? t("common.fullscreen.native_exit")
              : t("common.fullscreen.native_enter")}
          </span>
        </button>
      )}
    </div>
  );
}
