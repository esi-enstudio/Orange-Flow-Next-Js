const EXTENSIONS_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "application/pdf": "pdf",
};

const KNOWN_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif", "svg", "pdf"]);

/** Pick the file extension from a data URL MIME type or a file URL. */
export function extensionForSource(src: string): string {
  const dataMime = /^data:([^;,]+)/i.exec(src)?.[1]?.toLowerCase();
  if (dataMime && EXTENSIONS_BY_MIME[dataMime]) {
    return EXTENSIONS_BY_MIME[dataMime];
  }
  const urlExt = /\.([a-z0-9]{2,5})(?:[?#]|$)/i.exec(src)?.[1]?.toLowerCase();
  if (urlExt && KNOWN_EXTENSIONS.has(urlExt)) {
    return urlExt === "jpeg" ? "jpg" : urlExt;
  }
  return "png";
}

/** Download an in-memory data URL or a same-origin file URL. */
export function downloadFromSource(src: string, filename?: string): void {
  const a = document.createElement("a");
  a.href = src;
  a.download = filename || `download.${extensionForSource(src)}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
