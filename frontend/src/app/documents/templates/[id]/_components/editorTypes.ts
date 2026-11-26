"use client";

export type BlockType =
  | "heading"
  | "paragraph"
  | "spacer"
  | "divider"
  | "signature"
  | "page_break"
  | "image";
export type Orientation = "portrait" | "landscape";
export type Audience = "all" | "rso" | "bp";
export type SourceKind = "manual" | "dynamic";
export type DynamicSource = "resignation_letter" | "employee_nid";

export type AstBlock = Record<string, unknown> & {
  id: string;
  type: BlockType;
  text?: string;
  align?: string;
  size?: number;
  bold?: boolean;
  line_height?: number;
  height?: number;
  show_image?: boolean;
  fallback?: Record<string, unknown>;
  source_kind?: SourceKind;
  source?: DynamicSource | null;
  asset_id?: number | null;
  max_width_mm?: number;
  max_height_mm?: number;
  required?: boolean;
  fallback_text?: string;
};

export interface DocumentAst {
  schema_version: number;
  audience?: Audience;
  page: {
    format: "A4";
    orientation: Orientation;
    margins: { top: number; right: number; bottom: number; left: number };
    font_size: number;
    line_height: number;
  };
  blocks: AstBlock[];
}

export interface VariableField {
  key: string;
  label: string;
  label_bn: string;
  type: string;
  required: boolean;
  source: string | null;
  readonly: boolean;
  default: string;
  options: string[];
}

export interface VariableOption {
  key: string;
  label: string;
  label_bn: string;
  type: string;
  source: string | null;
  readonly: boolean;
}

export interface TemplateInfo {
  id: number;
  name: string;
  scope: "global" | "house";
  is_default: boolean;
  latest_version: { version_number: number } | null;
  content_json: DocumentAst;
}

export interface TemplateVersion {
  id: number;
  version_number: number;
  is_published: boolean;
  published_at: string | null;
  created_at: string | null;
  version_notes: string | null;
}

export interface TemplateAsset {
  id: number;
  template_id: number;
  file_name: string;
  content_type: string;
  size_bytes: number;
  created_at: string | null;
}

export const AST_V2 = 2;
export const DYNAMIC_SOURCES: DynamicSource[] = ["resignation_letter", "employee_nid"];
export const AUDIENCES: Audience[] = ["all", "rso", "bp"];

export const EMPTY_AST: DocumentAst = {
  schema_version: AST_V2,
  audience: "all",
  page: {
    format: "A4",
    orientation: "portrait",
    margins: { top: 18, right: 18, bottom: 18, left: 18 },
    font_size: 12,
    line_height: 1.7,
  },
  blocks: [],
};

export const inputClass =
  "min-h-11 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-primary-500/30 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-gray-100";

export function makeBlockId(): string {
  return `block-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function makeBlock(type: BlockType): AstBlock {
  const id = makeBlockId();
  if (type === "heading") return { id, type, text: "", align: "center", size: 14, bold: true, line_height: 1.7 };
  if (type === "paragraph") return { id, type, text: "", align: "left", size: 12, bold: false, line_height: 1.7 };
  if (type === "spacer") return { id, type, height: 8 };
  if (type === "divider") return { id, type, size: 1 };
  if (type === "signature") {
    return {
      id, type, align: "left", size: 12, show_image: true,
      fallback: { name: "", designation: "", organization: "", phone: "" },
    };
  }
  if (type === "image") {
    return {
      id, type, source_kind: "dynamic", source: "resignation_letter", asset_id: null,
      align: "center", max_width_mm: 170, max_height_mm: 240,
      required: true, fallback_text: "",
    };
  }
  return { id, type: "page_break" };
}

/**
 * Split the flat AST into visual pages. A `page_break` belongs to the page it
 * ends, so concatenating the returned groups reproduces the original block
 * list exactly — including break ids.
 */
export function splitPages(blocks: AstBlock[]): AstBlock[][] {
  const pages: AstBlock[][] = [[]];
  for (const block of blocks) {
    pages[pages.length - 1].push(block);
    if (block.type === "page_break") pages.push([]);
  }
  return pages;
}

/** Inverse of `splitPages`. */
export function joinPages(pages: AstBlock[][]): AstBlock[] {
  return pages.flat();
}
