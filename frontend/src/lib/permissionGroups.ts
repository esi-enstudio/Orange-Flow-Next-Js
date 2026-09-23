import { navItems } from "@/lib/constants";

export interface PermissionItem {
  id: number;
  name: string;
}

export interface PagePermissionGroup {
  key: string;
  title: string;
  translationKey?: string;
  href: string;
  parentTitle?: string;
  parentTranslationKey?: string;
  perms: PermissionItem[];
}

const ACRONYM_WORDS = new Set(["ga", "dms", "sim", "otp", "ev", "bp", "sc", "lso", "sso"]);

export function moduleKeyOfPermission(name: string): string {
  const dot = name.indexOf(".");
  return dot === -1 ? "__default__" : name.slice(0, dot);
}

export function actionOfPermission(name: string): string {
  const dot = name.indexOf(".");
  return dot === -1 ? name : name.slice(dot + 1);
}

export function titleCaseWords(input: string): string {
  return input
    .split(/[._\-\s]+/)
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLowerCase();
      if (lower === "itopup") return "iTopUp";
      if (ACRONYM_WORDS.has(lower)) return lower.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

export interface PermissionLabels {
  moduleKey: string;
  action: string;
  kind: "view" | "create" | "edit" | "delete" | "import" | "export" | "manage" | "other";
}

export function permissionLabels(name: string): PermissionLabels {
  return {
    moduleKey: moduleKeyOfPermission(name),
    action: actionOfPermission(name),
    kind: actionKindOf(actionOfPermission(name)),
  };
}

export const ACTION_CHIP_STYLES: Record<PermissionLabels["kind"], string> = {
  view: "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400",
  create: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
  edit: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  delete: "bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-400",
  import: "bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-400",
  export: "bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400",
  manage: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  other: "bg-gray-100 text-gray-600 dark:bg-slate-800/70 dark:text-gray-400",
};

export function actionKindOf(action: string): PermissionLabels["kind"] {
  const a = action.toLowerCase();
  if (a === "view" || a.startsWith("view")) return "view";
  if (a === "create" || a.startsWith("create") || a === "add") return "create";
  if (
    a.startsWith("edit") ||
    a.startsWith("update") ||
    a.startsWith("config") ||
    a.startsWith("settings") ||
    a.startsWith("transfer") ||
    a.startsWith("adjust") ||
    a.startsWith("assign") ||
    a.startsWith("approve") ||
    a.startsWith("issue") ||
    a.startsWith("activate") ||
    a.startsWith("allocate") ||
    a.startsWith("marking")
  )
    return "edit";
  if (a.startsWith("delete")) return "delete";
  if (a.startsWith("import")) return "import";
  if (
    a.startsWith("export") ||
    a.startsWith("download") ||
    a.startsWith("print") ||
    a.startsWith("send") ||
    a.startsWith("share")
  )
    return "export";
  return "manage";
}

export function permissionLabel(name: string): string {
  const moduleKey = moduleKeyOfPermission(name);
  const action = actionOfPermission(name);
  if (moduleKey === "__default__") return titleCaseWords(action);
  return `${titleCaseWords(action)} ${titleCaseWords(moduleKey)}`;
}

export const MODULE_DISPLAY_OVERRIDES: Record<string, string> = {
  houses: "Houses",
  users: "Users",
  roles: "Roles",
  permissions: "Permissions",
  retailers: "Retailers",
  employees: "Employees",
  bts: "BTS",
  lifting: "Lifting",
  reports: "Reports",
  live_monitor: "Live Monitor",
  products: "Products",
  commission: "Commission",
  sim_status: "SIM Status Check",
  activations: "Activations",
  itopup: "iTopUp Details",
  live_activations: "Live Activations",
  scratch_card: "Scratch Card Issues",
  scratch_card_serials: "SC Serial Management",
  sim_issues: "SIM Issues",
  targets: "Targets",
  bp_targets: "BP Targets",
  dms: "DMS Automation",
  app_settings: "App Settings",
  bp_retailer_codes: "BP Retailer Codes",
  rule_config: "Rule Config",
  filters: "Filters",
  automation: "Automation",
  shifts: "Shifts",
  mela: "Mela",
  navigation: "Navigation",
  zoom_in: "Zoom In",
  cv: "CV Management",
  recharge_dashboard: "Recharge Dashboard",
  sim_replacement: "SIM Replacement",
  sim_inventory: "SIM Inventory",
  ev_kit: "EV Kit Inventory",
  sales: "Sales",
  stock: "Stock",
  itopup_balance: "iTopUp Balance",
  active_lso: "Active LSO Report",
  active_sso: "Active SSO Report",
  transactions: "Transactions",
  ga_report_builder: "GA Report Builder",
  whatsapp: "WhatsApp Gateway",
  telegram: "Telegram Bots",
  otp: "OTP Monitor",
  system_logs: "System Logs",
  subscription: "Subscription",
  billing: "Billing",
  plans: "Plans",
  payments: "Payments",
  webhooks: "Webhook Events",
  deploy: "Deploy",
  imports: "Imports",
  settings: "Settings",
  expenses: "Expenses",
};

export function displayNameForModule(key: string): string {
  if (key === "__default__") return "";
  return MODULE_DISPLAY_OVERRIDES[key] || titleCaseWords(key);
}

interface LeafRef {
  title: string;
  translationKey?: string;
  href: string;
  parentTitle?: string;
  parentTranslationKey?: string;
  gates: string[];
}

function collectLeafPages(): LeafRef[] {
  const leaves: LeafRef[] = [];
  for (const item of navItems) {
    if (item.href) {
      leaves.push({
        title: item.title,
        translationKey: item.translationKey,
        href: item.href,
        gates: item.permissions ?? (item.permission ? [item.permission] : []),
      });
      continue;
    }
    if (item.children) {
      for (const child of item.children) {
        if (child.href) {
          leaves.push({
            title: child.title,
            translationKey: child.translationKey,
            href: child.href,
            parentTitle: item.title,
            parentTranslationKey: item.translationKey,
            gates: child.permissions ?? (child.permission ? [child.permission] : []),
          });
        } else if (child.children) {
          for (const grand of child.children) {
            if (!grand.href) continue;
            leaves.push({
              title: grand.title,
              translationKey: grand.translationKey,
              href: grand.href,
              parentTitle: item.title,
              parentTranslationKey: item.translationKey,
              gates: grand.permissions ?? (grand.permission ? [grand.permission] : []),
            });
          }
        }
      }
    }
  }
  return leaves;
}

export function buildPermissionGroups(allPerms: PermissionItem[]): PagePermissionGroup[] {
  const moduleMap: Record<string, PermissionItem[]> = {};
  for (const perm of allPerms) {
    const key = moduleKeyOfPermission(perm.name);
    (moduleMap[key] = moduleMap[key] || []).push(perm);
  }
  const nameToId = new Map<string, number>();
  for (const perm of allPerms) nameToId.set(perm.name, perm.id);

  const groups: PagePermissionGroup[] = [];

  for (const leaf of collectLeafPages()) {
    const gateMods = [...new Set(leaf.gates.map(moduleKeyOfPermission))];
    const available = gateMods.filter((m) => (moduleMap[m]?.length ?? 0) > 0);
    const specific = available.filter((m) => m !== "reports");
    const chosen = specific.length >= 1 ? specific : available;

    const perms: PermissionItem[] = [];
    for (const m of chosen) {
      for (const p of moduleMap[m] || []) perms.push(p);
    }
    for (const g of leaf.gates) {
      if (!perms.some((p) => p.name === g)) {
        const id = nameToId.get(g);
        if (id != null) perms.push({ id, name: g });
      }
    }

    const seen = new Set<number>();
    const unique: PermissionItem[] = [];
    for (const p of perms) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      unique.push(p);
    }
    unique.sort((a, b) => a.name.localeCompare(b.name));

    groups.push({
      key: leaf.href,
      title: leaf.title,
      translationKey: leaf.translationKey,
      href: leaf.href,
      parentTitle: leaf.parentTitle,
      parentTranslationKey: leaf.parentTranslationKey,
      perms: unique,
    });
  }

  return groups;
}