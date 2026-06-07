import { LucideIcon } from "lucide-react";
import {
  FileSpreadsheet,
  Wallet,
  SmartphoneNfc,
  ClipboardList,
  Database,
  Activity,
  Crosshair,
  UserCheck,
  Upload,
  Tag,
  ListTodo,
  ScrollText,
  LayoutDashboard,
  Users2,
  Banknote,
  Zap,
  BarChart3,
  Shield,
  ShieldCheck,
} from "lucide-react";

export interface NavItem {
  title: string;
  translationKey?: string;
  href?: string;
  icon: LucideIcon;
  color?: string;
  permission?: string;
  children?: {
    title: string;
    translationKey?: string;
    href: string;
    icon?: LucideIcon;
    permission?: string;
  }[];
}

export const navItems: NavItem[] = [
  {
    title: "Dashboard",
    translationKey: "nav.dashboard",
    href: "/",
    icon: LayoutDashboard,
    color: "text-blue-500",
  },
  {
    title: "To-Do List",
    translationKey: "nav.todos",
    href: "/todos",
    icon: ListTodo,
    color: "text-primary-500",
  },
  {
    title: "Data Import",
    translationKey: "nav.data_import",
    icon: Upload,
    color: "text-emerald-500",
    children: [
      { title: "Houses", translationKey: "nav.houses", href: "/houses", permission: "view_houses" },
      { title: "Retailers", translationKey: "nav.retailers", href: "/retailers", permission: "view_retailers" },
      { title: "BTS", translationKey: "nav.bts", href: "/bts", permission: "view_bts" },
      { title: "Activations", translationKey: "nav.import_activations", href: "/import/activations", permission: "import_data" },
      { title: "iTopUp Details", translationKey: "nav.import_itopup", href: "/import/itopup-details", permission: "import_data" },
      { title: "Live Activations", translationKey: "nav.import_live_activations", href: "/import/live-activations", permission: "import_data" },
      { title: "Scratch Card", translationKey: "nav.import_scratch_card", href: "/import/scratch-card", permission: "import_data" },
      { title: "SIM Issues", translationKey: "nav.import_sim_issue", href: "/import/sim-issues", permission: "import_data" },
    ]
  },
  {
    title: "Employee Hub",
    translationKey: "nav.employee_hub",
    icon: Users2,
    color: "text-purple-500",
    children: [
      { title: "Employee Management", translationKey: "nav.employees", href: "/employees", permission: "view_employees" },
      { title: "KPI Reports (GA/C2C)", translationKey: "nav.reports", href: "/reports/kpi", permission: "view_reports" },
      { title: "Attendance", translationKey: "nav.attendance", href: "/attendance", permission: "view_attendance" },
    ]
  },
  {
    title: "Commercial & Sales",
    translationKey: "nav.sales",
    icon: Banknote,
    color: "text-green-500",
    children: [
      { title: "GA Live Report", translationKey: "nav.reports", href: "/reports/ga-live", permission: "view_reports" },
      { title: "Lifting & Commission", translationKey: "nav.lifting", href: "/commercial/lifting", permission: "view_lifting" },
      { title: "Daily Expenses", translationKey: "nav.expenses", href: "/commercial/expenses", permission: "view_expenses" },
    ]
  },
  {
    title: "DMS Automation",
    translationKey: "nav.dms",
    icon: Zap,
    color: "text-yellow-500",
    children: [
      { title: "SIM Issue", translationKey: "nav.sim_issue", href: "/dms/sim-issue", permission: "view_sim_issue" },
      { title: "SIM Status Check", translationKey: "nav.sim_status", href: "/dms/sim-status", permission: "view_sim_status" },
      { title: "SIM Return", translationKey: "nav.sim_return", href: "/dms/sim-return", permission: "view_sim_return" },
      { title: "Scratch Card Issue", translationKey: "nav.scratch_card", href: "/dms/scratch-card", permission: "view_scratch_card" },
    ]
  },
  {
    title: "Reports",
    translationKey: "nav.reports_center",
    icon: BarChart3,
    color: "text-primary-500",
    children: [
      { title: "Activations", translationKey: "nav.report_activations", href: "/reports/activations", permission: "view_reports" },
      { title: "iTopUp Details", translationKey: "nav.report_itopup", href: "/reports/itopup-details", permission: "view_reports" },
      { title: "Live Activations", translationKey: "nav.report_live_activations", href: "/reports/live-activations", permission: "view_reports" },
      { title: "Scratch Card Issues", translationKey: "nav.report_scratch_card", href: "/reports/scratch-card", permission: "view_reports" },
      { title: "SIM Issues", translationKey: "nav.report_sim_issue", href: "/reports/sim-issues", permission: "view_reports" },
    ]
  },
  {
    title: "Targets",
    translationKey: "nav.targets",
    icon: Crosshair,
    color: "text-rose-500",
    children: [
      { title: "House Targets", translationKey: "nav.house_targets", href: "/targets/house", permission: "view_targets" },
      { title: "Supervisor Targets", translationKey: "nav.supervisor_targets", href: "/targets/supervisor", permission: "view_targets" },
      { title: "RSO Targets", translationKey: "nav.rso_targets", href: "/targets/rso", permission: "view_targets" },
    ]
  },
  {
    title: "Roles & Permissions",
    translationKey: "nav.roles",
    icon: Shield,
    color: "text-red-500",
    children: [
      { title: "Roles", translationKey: "nav.roles", href: "/roles", permission: "view_roles" },
      { title: "Permissions", translationKey: "nav.permissions", href: "/permissions", permission: "view_permissions" },
    ]
  },
  {
    title: "Administration",
    translationKey: "nav.administration",
    icon: ShieldCheck,
    color: "text-cyan-500",
    children: [
      { title: "User Management", translationKey: "nav.users", href: "/users", permission: "view_users" },
      { title: "Retailer Marking", translationKey: "nav.retailer_marking", href: "/retailer-marking", permission: "view_retailers" },
                      { title: "Product Exclusions", translationKey: "nav.product_exclusions", href: "/product-exclusions", permission: "view_reports" },
                      { title: "System Settings", translationKey: "nav.settings", href: "/settings", permission: "view_settings" },
    ]
  },
];
