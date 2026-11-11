"use client";

/**
 * Reusable rich-text editor built on Tiptap.
 *
 * The HTML is stored as-is (sanitized by the backend) and rendered by the PDF
 * and the page preview. Only extensions whose output the backend allow-list
 * accepts are enabled (bold/italic/underline/strike, lists, alignment).
 *
 * Plain-text values (legacy rows written before the editor existed) are
 * converted into paragraphs on load so newlines keep their meaning; every
 * change then emits HTML.
 *
 * ```tsx
 * <RichTextEditor value={html} onChange={setHtml} />
 * ```
 */
import {
  Fragment,
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import Placeholder from "@tiptap/extension-placeholder";
import TiptapImage from "@tiptap/extension-image";
import { toast } from "react-hot-toast";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  ImagePlus,
  Italic,
  List,
  ListOrdered,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  Underline,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { useLanguage } from "@/i18n/useLanguage";
import { cn } from "@/lib/utils";

export interface RichTextEditorHandle {
  /** Insert plain text (or a `{{placeholder}}` token) at the caret. */
  insertText: (text: string) => void;
  /** Put the caret back into the editor. */
  focus: () => void;
}

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Editable area height in pixels. */
  minHeight?: number;
  maxHeight?: number;
  className?: string;
  ariaLabel?: string;
}

const HTML_TAG_RE = /<\/?[a-z][^>]*>/i;

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return text.replace(/[&<>"']/g, (char) => map[char]);
}

/** Plain-text values become paragraphs so their newlines survive in Tiptap. */
function toEditorHtml(value: string): string {
  if (!value) return "";
  if (HTML_TAG_RE.test(value)) return value;
  return value
    .split("\n")
    .map((line) => `<p>${escapeHtml(line) || "<br>"}</p>`)
    .join("");
}

/** Image widths the operator can pick for an inserted picture (percent of block). */
const IMAGE_WIDTHS = [20, 30, 40, 50, 75, 100] as const;
const IMAGE_MAX_BYTES = 2 * 1024 * 1024;
const IMAGE_MAX_DATA_URL_CHARS = 500_000;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

/** Base64 images are allowed only for these raster types (never SVG). */
const ResizableImage = TiptapImage.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: 30,
        parseHTML: (element: HTMLElement) => {
          const match = (element.getAttribute("style") || "").match(/width:\s*(\d{1,3})%/);
          return match ? Number(match[1]) : 30;
        },
        renderHTML: (attributes: Record<string, unknown>) => ({
          style: `width:${attributes.width ?? 30}%`,
        }),
      },
    };
  },
}).configure({ allowBase64: true });

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image_load_failed"));
    image.src = src;
  });
}

/** Downscale an upload so a phone photo does not bloat the saved layout. */
async function fileToDataUrl(file: File): Promise<string> {
  const objectUrl = window.URL.createObjectURL(file);
  try {
    const image = await loadImage(objectUrl);
    const scale = Math.min(1, 900 / (image.naturalWidth || 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas_unavailable");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return file.type === "image/png"
      ? canvas.toDataURL("image/png")
      : canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    window.URL.revokeObjectURL(objectUrl);
  }
}

interface ToolbarButtonProps {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

function ToolbarButton({ icon: Icon, label, active, disabled, onClick }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      // Keep the text selection while a toolbar button is pressed.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "p-1.5 rounded-lg transition-colors cursor-pointer",
        active
          ? "bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300"
          : "text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-700",
        "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
      )}
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}

export const RichTextEditor = forwardRef<RichTextEditorHandle, RichTextEditorProps>(
  function RichTextEditor(
    {
      value,
      onChange,
      disabled = false,
      placeholder,
      minHeight = 160,
      maxHeight = 352,
      className,
      ariaLabel,
    },
    ref
  ) {
    const { t } = useLanguage();
    const imageInputId = useId();
    const [imageWidth, setImageWidth] = useState<number>(30);
    const onChangeRef = useRef(onChange);
    useEffect(() => {
      onChangeRef.current = onChange;
    }, [onChange]);

    const extensions = useMemo(
      () => [
        StarterKit.configure({
          // The backend sanitizer strips these blocks, so never offer them.
          heading: false,
          blockquote: false,
          code: false,
          codeBlock: false,
          horizontalRule: false,
          link: false,
          trailingNode: false,
        }),
        TextAlign.configure({ types: ["paragraph"], alignments: ["left", "center", "right", "justify"] }),
        Placeholder.configure({ placeholder: () => placeholder ?? t("rich_text.placeholder") }),
        ResizableImage,
      ],
      // Placeholder text is read once at mount; a language switch remounts via key.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [placeholder]
    );

    const editor = useEditor({
      immediatelyRender: false,
      editable: !disabled,
      extensions,
      content: toEditorHtml(value),
      editorProps: {
        attributes: {
          class: cn(
            "outline-none px-3 py-2 font-bengali text-sm leading-relaxed text-gray-900 dark:text-gray-100",
            "[&_p]:m-0 [&_p+p]:mt-2",
            "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6",
            "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6",
            "[&_li]:my-0.5 [&_li_p]:m-0"
          ),
          style: `min-height:${minHeight}px;max-height:${maxHeight}px;overflow-y:auto;`,
          role: "textbox",
          "aria-multiline": "true",
          ...(ariaLabel ? { "aria-label": ariaLabel } : {}),
        },
      },
      onUpdate: ({ editor: current }) => onChangeRef.current(current.getHTML()),
    });

    // Only write when the value changed from outside (load/reset); writing on
    // every keystroke would reset the caret.
    useEffect(() => {
      if (!editor) return;
      const incoming = toEditorHtml(value);
      if (editor.getHTML() !== incoming) {
        editor.commands.setContent(incoming, { emitUpdate: false });
      }
    }, [value, editor]);

    useEffect(() => {
      editor?.setEditable(!disabled);
    }, [disabled, editor]);

    const state = useEditorState({
      editor,
      selector: ({ editor: current }) =>
        ({
          bold: current?.isActive("bold") ?? false,
          italic: current?.isActive("italic") ?? false,
          underline: current?.isActive("underline") ?? false,
          strike: current?.isActive("strike") ?? false,
          bullets: current?.isActive("bulletList") ?? false,
          numbering: current?.isActive("orderedList") ?? false,
          alignLeft: current?.isActive({ textAlign: "left" }) ?? false,
          alignCenter: current?.isActive({ textAlign: "center" }) ?? false,
          alignRight: current?.isActive({ textAlign: "right" }) ?? false,
          alignJustify: current?.isActive({ textAlign: "justify" }) ?? false,
          canUndo: current?.can().undo() ?? false,
          canRedo: current?.can().redo() ?? false,
          selectedImageWidth: current?.isActive("image")
            ? Number(current.getAttributes("image").width) || null
            : null,
        }),
    });

    const applyImageWidth = (width: number) => {
      setImageWidth(width);
      if (editor?.isActive("image")) {
        editor.chain().focus().updateAttributes("image", { width }).run();
      }
    };

    const handleImageFile = async (file: File) => {
      if (!IMAGE_TYPES.includes(file.type)) {
        toast.error(t("rich_text.image_invalid"));
        return;
      }
      if (file.size > IMAGE_MAX_BYTES) {
        toast.error(t("rich_text.image_too_large"));
        return;
      }
      try {
        const dataUrl = await fileToDataUrl(file);
        if (dataUrl.length > IMAGE_MAX_DATA_URL_CHARS) {
          toast.error(t("rich_text.image_too_large"));
          return;
        }
        editor?.chain().focus().insertContent({
          type: "image",
          attrs: { src: dataUrl, width: imageWidth },
        }).run();
      } catch {
        toast.error(t("rich_text.image_invalid"));
      }
    };

    useImperativeHandle(
      ref,
      () => ({
        insertText(text: string) {
          if (disabled || !editor) return;
          editor.chain().focus().insertContent(text).run();
        },
        focus() {
          editor?.commands.focus();
        },
      }),
      [disabled, editor]
    );

    const alignments = [
      { value: "left", icon: AlignLeft, label: t("rich_text.align_left"), active: state?.alignLeft },
      { value: "center", icon: AlignCenter, label: t("rich_text.align_center"), active: state?.alignCenter },
      { value: "right", icon: AlignRight, label: t("rich_text.align_right"), active: state?.alignRight },
      { value: "justify", icon: AlignJustify, label: t("rich_text.align_justify"), active: state?.alignJustify },
    ] as const;

    const groups: { key: string; buttons: ToolbarButtonProps[] }[] = [
      {
        key: "history",
        buttons: [
          {
            icon: Undo2,
            label: t("rich_text.undo"),
            disabled: disabled || !state?.canUndo,
            onClick: () => editor?.chain().focus().undo().run(),
          },
          {
            icon: Redo2,
            label: t("rich_text.redo"),
            disabled: disabled || !state?.canRedo,
            onClick: () => editor?.chain().focus().redo().run(),
          },
        ],
      },
      {
        key: "marks",
        buttons: [
          {
            icon: Bold,
            label: t("rich_text.bold"),
            active: state?.bold,
            onClick: () => editor?.chain().focus().toggleBold().run(),
          },
          {
            icon: Italic,
            label: t("rich_text.italic"),
            active: state?.italic,
            onClick: () => editor?.chain().focus().toggleItalic().run(),
          },
          {
            icon: Underline,
            label: t("rich_text.underline"),
            active: state?.underline,
            onClick: () => editor?.chain().focus().toggleUnderline().run(),
          },
          {
            icon: Strikethrough,
            label: t("rich_text.strike"),
            active: state?.strike,
            onClick: () => editor?.chain().focus().toggleStrike().run(),
          },
        ],
      },
      {
        key: "lists",
        buttons: [
          {
            icon: List,
            label: t("rich_text.bullets"),
            active: state?.bullets,
            onClick: () => editor?.chain().focus().toggleBulletList().run(),
          },
          {
            icon: ListOrdered,
            label: t("rich_text.numbering"),
            active: state?.numbering,
            onClick: () => editor?.chain().focus().toggleOrderedList().run(),
          },
        ],
      },
      {
        key: "align",
        buttons: alignments.map(({ value, icon, label, active }) => ({
          icon,
          label,
          active,
          onClick: () => editor?.chain().focus().setTextAlign(value).run(),
        })),
      },
      {
        key: "image",
        buttons: [
          {
            icon: ImagePlus,
            label: t("rich_text.insert_image"),
            disabled: disabled,
            onClick: () => document.getElementById(imageInputId)?.click(),
          },
        ],
      },
      {
        key: "clear",
        buttons: [
          {
            icon: RemoveFormatting,
            label: t("rich_text.clear"),
            onClick: () => editor?.chain().focus().unsetAllMarks().clearNodes().run(),
          },
        ],
      },
    ];

    return (
      <div
        className={cn(
          "rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden focus-within:ring-2 focus-within:ring-primary-500",
          // Placeholder styling for the Tiptap decoration.
          "[&_.ProseMirror_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]",
          "[&_.ProseMirror_p.is-editor-empty:first-child::before]:float-left",
          "[&_.ProseMirror_p.is-editor-empty:first-child::before]:h-0",
          "[&_.ProseMirror_p.is-editor-empty:first-child::before]:text-gray-400",
          "[&_.ProseMirror_p.is-editor-empty:first-child::before]:pointer-events-none",
          disabled && "cursor-not-allowed opacity-70",
          className
        )}
      >
        <div className="flex flex-wrap items-center gap-0.5 border-b border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/60 px-1.5 py-1.5">
          {groups.map((group, index) => (
            <Fragment key={group.key}>
              {index > 0 && (
                <span className="mx-1 h-5 w-px bg-gray-200 dark:bg-slate-700" aria-hidden="true" />
              )}
              {group.buttons.map((button, buttonIndex) => (
                <ToolbarButton key={`${group.key}-${buttonIndex}`} {...button} disabled={button.disabled || disabled} />
              ))}
            </Fragment>
          ))}
          <span className="mx-1 h-5 w-px bg-gray-200 dark:bg-slate-700" aria-hidden="true" />
          <select
            value={state?.selectedImageWidth ?? imageWidth}
            onChange={(e) => applyImageWidth(Number(e.target.value))}
            disabled={disabled}
            title={t("rich_text.image_size")}
            aria-label={t("rich_text.image_size")}
            className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-1.5 py-1 text-[11px] font-medium text-gray-600 dark:text-gray-300 outline-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
          >
            {IMAGE_WIDTHS.map((width) => (
              <option key={width} value={width}>
                {t("rich_text.image_width", { width })}
              </option>
            ))}
          </select>
          <input
            id={imageInputId}
            type="file"
            accept={IMAGE_TYPES.join(",")}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void handleImageFile(file);
            }}
          />
        </div>
        <EditorContent editor={editor} />
      </div>
    );
  }
);
