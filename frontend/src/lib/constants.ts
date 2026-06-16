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
  Calculator,
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
      { title: "Houses", translationKey: "nav.houses", href: "/houses", permission: "houses.view" },
      { title: "Retailers", translationKey: "nav.retailers", href: "/retailers", permission: "retailers.view" },
      { title: "BTS", translationKey: "nav.bts", href: "/bts", permission: "bts.view" },
      { title: "Activations", translationKey: "nav.import_activations", href: "/import/activations", permission: "imports.data" },
      { title: "iTopUp Details", translationKey: "nav.import_itopup", href: "/import/itopup-details", permission: "imports.data" },
      { title: "Live Activations", translationKey: "nav.import_live_activations", href: "/import/live-activations", permission: "imports.data" },
      { title: "Scratch Card", translationKey: "nav.import_scratch_card", href: "/import/scratch-card", permission: "imports.data" },
      { title: "SIM Issues", translationKey: "nav.import_sim_issue", href: "/import/sim-issues", permission: "imports.data" },
    ]
  },
  {
    title: "Employee Hub",
    translationKey: "nav.employee_hub",
    icon: Users2,
    color: "text-purple-500",
    children: [
      { title: "Employee Management", translationKey: "nav.employees", href: "/employees", permission: "employees.view" },
      { title: "KPI Reports (GA/C2C)", translationKey: "nav.reports", href: "/reports/kpi", permission: "reports.view" },
      { title: "Attendance", translationKey: "nav.attendance", href: "/attendance", permission: "attendance.view" },
    ]
  },
  {
    title: "Commercial & Sales",
    translationKey: "nav.sales",
    icon: Banknote,
    color: "text-green-500",
    children: [
      {
        title: "Lifting",
        translationKey: "nav.lifting",
        icon: Banknote,
        color: "text-green-500",
        permission: "lifting.view",
        href: "/commercial/lifting",
        children: [
          { title: "Lifting Records", translationKey: "nav.lifting_records", href: "/commercial/lifting/records", permission: "lifting.view" },
          { title: "Products", translationKey: "nav.products", href: "/commercial/lifting/products", permission: "products.view" },
        ]
      },
      {
        title: "Commission",
        translationKey: "nav.commission",
        icon: Calculator,
        color: "text-green-500",
        permission: "commission.view",
        href: "/commercial/commission",
      },
      { title: "Daily Expenses", translationKey: "nav.expenses", href: "/commercial/expenses", permission: "expenses.view" },
    ]
  },
  {
    title: "DMS Automation",
    translationKey: "nav.dms",
    icon: Zap,
    color: "text-yellow-500",
    children: [
      { title: "SIM Issue", translationKey: "nav.sim_issue", href: "/dms/sim-issue", permission: "dms.sim_issue" },
      { title: "SIM Status Check", translationKey: "nav.sim_status", href: "/dms/sim-status", permission: "dms.sim_status" },
      { title: "SIM Return", translationKey: "nav.sim_return", href: "/dms/sim-return", permission: "dms.sim_return" },
      { title: "Scratch Card Issue", translationKey: "nav.scratch_card", href: "/dms/scratch-card", permission: "scratch_card.view" },
    ]
  },
  {
    title: "Reports",
    translationKey: "nav.reports_center",
    icon: BarChart3,
    color: "text-primary-500",
    children: [
      { title: "Activations", translationKey: "nav.report_activations", href: "/reports/activations", permission: "reports.view" },
      { title: "iTopUp Details", translationKey: "nav.report_itopup", href: "/reports/itopup-details", permission: "reports.view" },
      { title: "Live Activations", translationKey: "nav.report_live_activations", href: "/reports/live-activations", permission: "reports.view" },
      { title: "Scratch Card Issues", translationKey: "nav.report_scratch_card", href: "/reports/scratch-card", permission: "reports.view" },
      { title: "SIM Issues", translationKey: "nav.report_sim_issue", href: "/reports/sim-issues", permission: "reports.view" },
      { title: "BP Retailer Codes", translationKey: "nav.bp_retailer_codes", href: "/bp-retailer-codes", permission: "reports.view" },
    ]
  },
  {
    title: "Targets",
    translationKey: "nav.targets",
    icon: Crosshair,
    color: "text-rose-500",
    children: [
      { title: "House Targets", translationKey: "nav.house_targets", href: "/targets/house", permission: "targets.view" },
      { title: "Supervisor Targets", translationKey: "nav.supervisor_targets", href: "/targets/supervisor", permission: "targets.view" },
      { title: "RSO Targets", translationKey: "nav.rso_targets", href: "/targets/rso", permission: "targets.view" },
    ]
  },
  {
    title: "Roles & Permissions",
    translationKey: "nav.roles",
    icon: Shield,
    color: "text-red-500",
    children: [
      { title: "Roles", translationKey: "nav.roles", href: "/roles", permission: "roles.view" },
      { title: "Permissions", translationKey: "nav.permissions", href: "/permissions", permission: "permissions.view" },
    ]
  },
  {
    title: "Administration",
    translationKey: "nav.administration",
    icon: ShieldCheck,
    color: "text-cyan-500",
    children: [
      { title: "User Management", translationKey: "nav.users", href: "/users", permission: "users.view" },
      { title: "Retailer Marking", translationKey: "nav.retailer_marking", href: "/retailer-marking", permission: "retailers.view" },
      { title: "Product Exclusions", translationKey: "nav.product_exclusions", href: "/product-exclusions", permission: "reports.view" },
      { title: "System Settings", translationKey: "nav.settings", href: "/settings", permission: "settings.view" },
    ]
  },
];
