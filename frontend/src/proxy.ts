import { NextRequest, NextResponse } from "next/server";

/**
 * Server-side maintenance gate.
 *
 * When maintenance is ENFORCED (grace countdown elapsed), anonymous/tokenless
 * page loads are redirected to /maintenance. Super Admin sessions pass through
 * (verified server-side against /api/auth/me — never trusts a client flag).
 * During the grace phase everyone passes; the client MaintenanceContext shows
 * the countdown banner.
 *
 * Fail-open by design: if the backend is unreachable the app shell is served
 * (the client guard falls back to the last-known localStorage state).
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000/api";

type Phase = "off" | "grace" | "enforced";

const STATUS_TTL_MS = 10_000;
const ME_TTL_MS = 30_000;

let statusCache: { at: number; phase: Phase } | null = null;
let saCache: { at: number; token: string; superAdmin: boolean } | null = null;

async function fetchPhase(): Promise<Phase | null> {
  if (statusCache && Date.now() - statusCache.at < STATUS_TTL_MS) return statusCache.phase;
  try {
    const res = await fetch(`${API_BASE}/settings/maintenance`, {
      signal: AbortSignal.timeout(2500),
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (res.ok) {
      const data = await res.json();
      const phase: Phase =
        data.phase === "grace" || data.phase === "enforced" ? data.phase : "off";
      statusCache = { at: Date.now(), phase };
      return phase;
    }
    return statusCache?.phase ?? null;
  } catch {
    return statusCache?.phase ?? null;
  }
}

async function isSuperAdmin(token: string): Promise<boolean> {
  if (saCache && saCache.token === token && Date.now() - saCache.at < ME_TTL_MS) {
    return saCache.superAdmin;
  }
  try {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(2500),
      cache: "no-store",
    });
    let superAdmin = false;
    if (res.ok) {
      const user = await res.json();
      superAdmin = Array.isArray(user?.roles)
        ? user.roles.some((r: { name?: string }) =>
            ["super admin", "super_admin"].includes((r?.name || "").toLowerCase())
          )
        : false;
    }
    saCache = { at: Date.now(), token, superAdmin };
    return superAdmin;
  } catch {
    return false;
  }
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname === "/maintenance") return NextResponse.next();

  // Deploy verify probes (deploy.sh curls localhost:3000 for the <body check)
  // and health checks must never be redirected while maintenance is enforced.
  // Matched via User-Agent only — a Host-header bypass would be spoofable and
  // would also disable the gate for anyone browsing from the server itself.
  const ua = req.headers.get("user-agent") || "";
  if (
    /\b(curl|wget|python-requests|python-urllib|node-fetch|undici|healthcheck)\b/i.test(ua)
  ) {
    return NextResponse.next();
  }

  const phase = await fetchPhase();
  if (phase !== "enforced") return NextResponse.next();

  const token = req.cookies.get("token")?.value;
  if (token && (await isSuperAdmin(token))) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/maintenance";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // Skip static assets; everything else (pages) goes through the gate.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|uploads/).*)"],
};
