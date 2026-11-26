"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useLanguage } from "@/i18n/useLanguage";
import {
  AST_V2,
  makeBlock,
  makeBlockId,
  splitPages,
  type AstBlock,
  type DocumentAst,
} from "./editorTypes";

interface PageListProps {
  blocks: AstBlock[];
  selectedPage: number;
  onSelectPage: (index: number) => void;
  onAstChange: (updater: (current: DocumentAst) => DocumentAst) => void;
  editable: boolean;
  saving: boolean;
}

/**
 * Keep exactly one separator between pages and none after the last page.
 * `page_break` carries no data, so ids may be regenerated on reorder.
 */
function normalizePages(pages: AstBlock[][]): AstBlock[][] {
  const stripped = pages.map((page) => page.filter((block) => block.type !== "page_break"));
  if (stripped.length === 0) return [[]];
  return stripped.map((page, index) => index < stripped.length - 1
    ? [...page, { id: makeBlockId(), type: "page_break" }]
    : page);
}

export default function PageList({
  blocks, selectedPage, onSelectPage, onAstChange, editable, saving,
}: PageListProps) {
  const { t } = useLanguage();
  const pages = splitPages(blocks);
  const disabled = !editable || saving;

  const addPage = () => {
    if (disabled) return;
    const base = [...blocks];
    while (base.length > 0 && base[base.length - 1].type === "page_break") base.pop();
    const newPageIndex = splitPages(base).length;
    onAstChange((current) => ({
      ...current,
      schema_version: AST_V2,
      blocks: [...base, makeBlock("page_break"), makeBlock("image")],
    }));
    onSelectPage(newPageIndex);
  };

  const movePage = (index: number, direction: -1 | 1) => {
    if (disabled) return;
    const target = index + direction;
    if (target < 0 || target >= pages.length) return;
    const next = [...pages];
    [next[index], next[target]] = [next[target], next[index]];
    onAstChange((current) => ({
      ...current,
      blocks: normalizePages(next).flat(),
    }));
    onSelectPage(target);
  };

  const removePage = (index: number) => {
    if (disabled) return;
    const next = normalizePages(pages.filter((_, pageIndex) => pageIndex !== index));
    onAstChange((current) => ({ ...current, blocks: next.flat() }));
    onSelectPage(Math.max(0, Math.min(index, next.length - 1)));
  };

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">
          {t("document_template_editor.pages")}
        </h3>
        <button
          type="button"
          onClick={addPage}
          disabled={disabled}
          className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-primary-200 bg-primary-50 px-3 text-xs font-semibold text-primary-700 hover:bg-primary-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-primary-900 dark:bg-primary-950/40 dark:text-primary-200"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          {t("document_template_editor.add_page")}
        </button>
      </div>
      <ul className="space-y-1.5">
        {pages.map((page, index) => {
          const isSelected = selectedPage === index;
          const body = page.filter((block) => block.type !== "page_break");
          return (
            <li
              key={`page-${index}`}
              className={`flex items-center gap-1 rounded-xl border p-1.5 ${
                isSelected
                  ? "border-primary-400 bg-primary-50/70 dark:bg-primary-950/20"
                  : "border-gray-200 dark:border-slate-700"
              }`}
            >
              <button
                type="button"
                onClick={() => onSelectPage(index)}
                aria-current={isSelected ? "true" : undefined}
                className="min-h-11 min-w-0 flex-1 cursor-pointer rounded-lg px-2 text-left"
              >
                <span className="block text-xs font-semibold text-gray-800 dark:text-gray-200">
                  {t("document_template_editor.page", { page: index + 1 })}
                </span>
                <span className="block truncate text-[11px] text-gray-500 dark:text-gray-400">
                  {body.length
                    ? body.map((block) => t(`document_template_editor.${block.type}`)).join(" · ")
                    : t("document_template_editor.page_empty")}
                </span>
              </button>
              <button
                type="button"
                aria-label={t("document_template_editor.move_page_up")}
                title={t("document_template_editor.move_page_up")}
                disabled={disabled || index === 0}
                onClick={() => movePage(index, -1)}
                className="min-h-11 min-w-11 cursor-pointer rounded-lg text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-300 dark:hover:bg-slate-800"
              >
                <ArrowUp className="mx-auto h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={t("document_template_editor.move_page_down")}
                title={t("document_template_editor.move_page_down")}
                disabled={disabled || index === pages.length - 1}
                onClick={() => movePage(index, 1)}
                className="min-h-11 min-w-11 cursor-pointer rounded-lg text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-300 dark:hover:bg-slate-800"
              >
                <ArrowDown className="mx-auto h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={t("document_template_editor.remove_page")}
                title={t("document_template_editor.remove_page")}
                disabled={disabled || pages.length === 1}
                onClick={() => removePage(index)}
                className="min-h-11 min-w-11 cursor-pointer rounded-lg text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-red-950/30"
              >
                <Trash2 className="mx-auto h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
