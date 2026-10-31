import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const APP_ICON_FILES = new Set([
  "favicon.ico",
  "icon-192.png",
  "icon-512.png",
  "icon-512-maskable.png",
  "apple-touch-icon.png",
]);
function getBackendOrigin() {
  const configuredOrigin =
    process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || "";
  if (!configuredOrigin.startsWith("http://") && !configuredOrigin.startsWith("https://")) {
    return "http://127.0.0.1:8000";
  }
  return configuredOrigin.replace(/\/api\/?$/, "").replace(/\/$/, "");
}

async function replacePublicFiles(files: Record<string, string>) {
  const publicDirectory = path.join(process.cwd(), "public");
  const staged: Array<{ temporary: string; destination: string }> = [];
  const backups: Array<{ backup: string; destination: string }> = [];
  const installed: string[] = [];
  let committed = false;

  try {
    for (const [filename, encoded] of Object.entries(files)) {
      const destination =
        filename === "favicon.ico"
          ? path.join(publicDirectory, filename)
          : path.join(publicDirectory, "icons", filename);
      const data = Buffer.from(encoded, "base64");
      if (data.length === 0 || data.toString("base64") !== encoded) {
        throw new Error(`The processed ${filename} file is invalid.`);
      }

      await mkdir(path.dirname(destination), { recursive: true });
      const temporary = `${destination}.${randomUUID()}.tmp`;
      await writeFile(temporary, data, { flag: "wx" });
      staged.push({ temporary, destination });
    }

    for (const file of staged) {
      const backup = `${file.destination}.${randomUUID()}.bak`;
      try {
        await rename(file.destination, backup);
        backups.push({ backup, destination: file.destination });
      } catch (error) {
        if (
          typeof error !== "object" ||
          error === null ||
          !("code" in error) ||
          error.code !== "ENOENT"
        ) {
          throw error;
        }
      }
      await rename(file.temporary, file.destination);
      installed.push(file.destination);
    }
    committed = true;
  } catch (error) {
    await Promise.all(installed.map((destination) => rm(destination, { force: true })));
    for (const { backup, destination } of backups.reverse()) {
      await rename(backup, destination);
    }
    throw error;
  } finally {
    await Promise.all(
      staged.map(({ temporary }) => rm(temporary, { force: true })),
    );
    if (committed) {
      await Promise.all(backups.map(({ backup }) => rm(backup, { force: true })));
    }
  }
}

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization) {
    return NextResponse.json(
      { detail: "Authentication is required to update app icons." },
      { status: 401 },
    );
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > 6 * 1024 * 1024) {
    return NextResponse.json(
      { detail: "The uploaded file exceeds the maximum allowed size." },
      { status: 413 },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { detail: "A multipart image upload is required." },
      { status: 400 },
    );
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { detail: "Choose an app icon image to upload." },
      { status: 400 },
    );
  }
  const maxFileSize = 5 * 1024 * 1024;
  if (file.size > maxFileSize) {
    return NextResponse.json(
      { detail: "The uploaded file exceeds the maximum allowed size." },
      { status: 413 },
    );
  }

  const backendForm = new FormData();
  backendForm.set("file", file, file.name);

  let backendResponse: Response;
  try {
    backendResponse = await fetch(`${getBackendOrigin()}/api/settings/brand/icons`, {
      method: "POST",
      headers: { authorization },
      body: backendForm,
      cache: "no-store",
    });
  } catch (error) {
    console.error("Could not validate uploaded app icons:", error);
    return NextResponse.json(
      { detail: "The settings service is unavailable. Please try again." },
      { status: 502 },
    );
  }

  let result: unknown;
  try {
    result = await backendResponse.json();
  } catch {
    return NextResponse.json(
      { detail: "The settings service returned an invalid response." },
      { status: 502 },
    );
  }

  if (!backendResponse.ok) {
    return NextResponse.json(result, { status: backendResponse.status });
  }

  const responseFiles =
    typeof result === "object" &&
    result !== null &&
    "files" in result &&
    typeof result.files === "object" &&
    result.files !== null
      ? result.files
      : null;
  if (
    !responseFiles ||
    Object.keys(responseFiles).length !== APP_ICON_FILES.size
  ) {
    return NextResponse.json(
      { detail: "The settings service returned invalid icon files." },
      { status: 502 },
    );
  }

  const files: Record<string, string> = {};
  for (const [filename, encoded] of Object.entries(responseFiles)) {
    if (
      !APP_ICON_FILES.has(filename) ||
      typeof encoded !== "string" ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        encoded,
      )
    ) {
      return NextResponse.json(
        { detail: "The settings service returned invalid icon files." },
        { status: 502 },
      );
    }
    files[filename] = encoded;
  }

  try {
    await replacePublicFiles(files);
  } catch (error) {
    console.error("Could not replace the public app icon files:", error);
    return NextResponse.json(
      { detail: "The icon files could not be saved. Check frontend file permissions." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    updated: Object.keys(files),
    version: Date.now(),
  });
}
