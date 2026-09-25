import { navItems, NavItem } from "@/lib/constants";

/** Modules automatically included in every plan (never selectable off). */
export const BASE_MODULES = new Set(["dashboard", "todos", "administration"]);

/** Home page route for the billing group (always reachable — platform). */
const ALWAYS_REACHABLE_MODULES = new Set(["billing_group"]);

export interface PlanModuleLeaf {
  key: string;
  translationKey?: string;
  href: string;
  permission?: string;
  permissions?: string[];
}

export interface PlanModuleGroup {
  moduleKey: string;
  title: string;
  translationKey?: string;
  href?: string;
  iconKey?: string;
  children: PlanModuleLeaf[];
}

export function moduleKeyOf(item: Pick<NavItem, "moduleKey" | "translationKey" | "href">): string {
  if (item.moduleKey) return item.moduleKey;
  const fromTranslation = item.translationKey?.replace(/^nav\./, "");
  if (fromTranslation) return fromTranslation;
  const href = item.href || "";
  return href.replace(/^\/+/, "").split(/[/?#]/)[0] || "unknown";
}

function leafRefs(item: NavItem): { title: string; translationKey?: string; href: string; permission?: string; permissions?: string[] }[] {
  if (item.href) return [{ title: item.title, translationKey: item.translationKey, href: item.href, permission: item.permission, permissions: item.permissions }];
  const leaves: { title: string; translationKey?: string; href: string; permission?: string; permissions?: string[] }[] = [];
  for (const child of item.children || []) {
    if (child.href) {
      leaves.push({ title: child.title, translationKey: child.translationKey, href: child.href, permission: child.permission, permissions: child.permissions });
    } else if (child.children) {
      for (const grand of child.children) {
        if (!grand.href) continue;
        leaves.push({ title: grand.title, translationKey: grand.translationKey, href: grand.href, permission: grand.permission, permissions: grand.permissions });
      }
    }
  }
  return leaves;
}

/** Full module tree derived from navItems — new pages/modules appear automatically. */
export function buildPlanModuleTree(): PlanModuleGroup[] {
  return navItems.map((item) => ({
    moduleKey: moduleKeyOf(item),
    title: item.title,
    translationKey: item.translationKey,
    href: item.href,
    iconKey: item.translationKey,
    children: leafRefs(item).map((leaf, i) => ({
      key: `${moduleKeyOf(item)}-${i}-${leaf.href}`,
      translationKey: leaf.translationKey,
      href: leaf.href,
      permission: leaf.permission,
      permissions: leaf.permissions,
    })),
  }));
}

/** All module keys offered by the system (groups), excluding base modules. */
export function allSelectableModuleKeys(): string[] {
  return buildPlanModuleTree()
    .filter((g) => !BASE_MODULES.has(g.moduleKey))
    .map((g) => g.moduleKey);
}

export function isBaseModule(key: string): boolean {
  return BASE_MODULES.has(key);
}

export function isAlwaysReachable(key: string): boolean {
  return ALWAYS_REACHABLE_MODULES.has(key);
}

/** Resolve a route pathname to its top-level module key (e.g. "/dms/sim-issue" → "dms"). */
export function moduleForKeyPath(pathname: string): string | null {
  const path = pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  for (const group of buildPlanModuleTree()) {
    const href = (group.href || "").replace(/^\/+/, "").replace(/\/+$/, "");
    if (href && path === href) return group.moduleKey;
    for (const child of group.children) {
      const c = child.href.replace(/^\/+/, "").replace(/\/+$/, "");
      if (path === c || path.startsWith(`${c}/`)) return group.moduleKey;
    }
  }
  return null;
}

/**
 * Grantable page-level leaf routes for a module (children hrefs). Always-reachable
 * (platform) and base modules return [] — they are never individually chosen.
 */
export function moduleLeaves(moduleKey: string): string[] {
  if (BASE_MODULES.has(moduleKey) || isAlwaysReachable(moduleKey)) return [];
  const group = buildPlanModuleTree().find((g) => g.moduleKey === moduleKey);
  return group ? group.children.map((c) => c.href) : [];
}

/** Every page route across all selectable modules (excluding base + platform). */
export function allLeafKeys(): string[] {
  return buildPlanModuleTree()
    .filter((g) => !BASE_MODULES.has(g.moduleKey) && !isAlwaysReachable(g.moduleKey))
    .flatMap((g) => g.children.map((c) => c.href));
}

/** Resolve an exact leaf route or a sub-route (e.g. "/retailers/markings/123") to its leaf. */
export function leafForRoute(route: string): string | null {
  const path = route.replace(/^\/+/, "").replace(/\/+$/, "");
  for (const group of buildPlanModuleTree()) {
    if (BASE_MODULES.has(group.moduleKey) || isAlwaysReachable(group.moduleKey)) continue;
    for (const child of group.children) {
      const leaf = child.href.replace(/^\/+/, "").replace(/\/+$/, "");
      if (path === leaf || path.startsWith(`${leaf}/`)) return child.href;
    }
  }
  return null;
}

/** Resolve an allowed key (module key or leaf route) to its top-level module. */
export function moduleForGrant(key: string): string | null {
  if (isAlwaysReachable(key) || BASE_MODULES.has(key)) return null;
  const group = buildPlanModuleTree().find((g) => g.moduleKey === key);
  if (group) return group.moduleKey;
  return moduleForKeyPath(key) || null;
}

/** Whether a module is enabled given a granted key set (module key OR any leaf). */
export function moduleEnabledForKeys(moduleKey: string, keys: Iterable<string>): boolean {
  if (BASE_MODULES.has(moduleKey)) return true;
  const set = new Set(keys);
  if (set.has(moduleKey)) return true;
  return moduleLeaves(moduleKey).some((leaf) => set.has(leaf));
}

/** Whether a leaf page is enabled given a granted set (leaf itself OR whole module). */
export function leafEnabledForKey(leafHref: string, keys: Iterable<string>): boolean {
  const set = new Set(keys);
  if (set.has(leafHref)) return true;
  const moduleKey = moduleForKeyPath(leafHref);
  return !!moduleKey && set.has(moduleKey);
}

/** Expand module keys into their leaf routes (leaves pass through); drops base/platform. */
export function expandGrantsToLeaves(keys: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const key of keys) {
    if (isBaseModule(key) || isAlwaysReachable(key)) continue;
    const leaves = moduleLeaves(key);
    if (leaves.length > 0) {
      for (const leaf of leaves) out.add(leaf);
    } else {
      out.add(key);
    }
  }
  return Array.from(out);
}

export interface PlanModuleSummary {
  moduleKey: string;
  total: number;
  granted: number;
  whole: boolean;
}

/** Summarize a granted key set (module keys + leaves) per module, for plan chips. */
export function summarizeGrants(keys: Iterable<string>): PlanModuleSummary[] {
  const set = new Set(keys);
  const byModule = new Map<string, { granted: string[]; whole: boolean }>();
  for (const key of set) {
    const moduleKey = moduleForGrant(key);
    if (!moduleKey) continue;
    const entry = byModule.get(moduleKey) || { granted: [], whole: false };
    if (key === moduleKey) entry.whole = true;
    else entry.granted.push(key);
    byModule.set(moduleKey, entry);
  }
  return Array.from(byModule.entries()).map(([moduleKey, e]) => {
    const total = moduleLeaves(moduleKey).length;
    const granted = e.whole ? total : e.granted.length;
    return { moduleKey, total, granted, whole: e.whole || granted >= total };
  });
}