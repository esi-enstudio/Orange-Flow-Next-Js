import { LucideIcon } from "lucide-react";
import {
  FileSpreadsheet,
  Wallet,
  SmartphoneNfc,
  ClipboardList,
  Database,
  Activity,
  Crosshair,
  Target,
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
  Search,
  FileText,
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
    children?: {
      title: string;
      translationKey?: string;
      href: string;
      icon?: LucideIcon;
      permission?: string;
    }[];
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
      { title: "Activations", translationKey: "nav.import_activations", href: "/import/activations", permission: "imports.view" },
      { title: "iTopUp Details", translationKey: "nav.import_itopup", href: "/import/itopup-details", permission: "imports.view" },
      { title: "Live Activations", translationKey: "nav.import_live_activations", href: "/import/live-activations", permission: "imports.view" },
      { title: "Scratch Card", translationKey: "nav.import_scratch_card", href: "/import/scratch-card", permission: "imports.view" },
      { title: "SIM Issues", translationKey: "nav.import_sim_issue", href: "/import/sim-issues", permission: "imports.view" },
      { title: "SC Serials", translationKey: "nav.import_sc_serials", href: "/import/sc-serials", permission: "scratch_card_serials.view" },
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
      { title: "DMS Sync", translationKey: "nav.dms_sync", href: "/sync", permission: "automation.dms_sync" },
    ]
  },
  {
    title: "Reports",
    translationKey: "nav.reports_center",
    icon: BarChart3,
    color: "text-primary-500",
    children: [
      { title: "Activations", translationKey: "nav.report_activations", href: "/reports/activations", permission: "reports.view" },
      { title: "Recharge", translationKey: "nav.report_recharge", href: "/reports/recharge", permission: "reports.view" },

      { title: "Live Activations", translationKey: "nav.report_live_activations", href: "/reports/live-activations", permission: "reports.view" },
      { title: "Scratch Card Issues", translationKey: "nav.report_scratch_card", href: "/reports/scratch-card", permission: "reports.view" },
      { title: "SIM Issues", translationKey: "nav.report_sim_issue", href: "/reports/sim-issues", permission: "reports.view" },
      { title: "Retailer Visits", translationKey: "nav.visits", href: "/visit", permission: "visits.view" },
      { title: "Orders", translationKey: "nav.orders", href: "/orders", permission: "orders.view" },
    ]
  },
  {
    title: "Performance",
    translationKey: "nav.performance",
    icon: Target,
    color: "text-rose-500",
    children: [
      { title: "Manager Dashboard", translationKey: "nav.manager_dashboard", href: "/dashboard/manager", permission: "reports.target_achievement" },
      { title: "Supervisor Dashboard", translationKey: "nav.supervisor_dashboard", href: "/dashboard/supervisor", permission: "reports.target_achievement" },
      { title: "RSO Dashboard", translationKey: "nav.rso_dashboard", href: "/dashboard/rso", permission: "reports.target_achievement" },
      { title: "My Team", translationKey: "nav.my_team", href: "/team", permission: "employees.view" },
      { title: "Assign RSOs", translationKey: "nav.assign_rsos", href: "/assign", permission: "employees.assign" },
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
      { title: "BP Targets", translationKey: "nav.bp_targets", href: "/targets/bp", permission: "bp_targets.view" },
    ]
  },
  {
    title: "Roles & Permissions",
    translationKey: "nav.roles_permissions",
    icon: Shield,
    color: "text-red-500",
    children: [
      { title: "Roles", translationKey: "nav.roles", href: "/roles", permission: "roles.view" },
      { title: "Permissions", translationKey: "nav.permissions", href: "/permissions", permission: "permissions.view" },
    ]
  },
  {
    title: "Zoom In",
    translationKey: "nav.zoom_in",
    icon: Search,
    color: "text-rose-500",
    permission: "zoom_in.view",
    children: [
      { title: "Zoom In Events", translationKey: "nav.zoom_in_events", href: "/zoom-in", permission: "zoom_in.view" },
      { title: "Event Types", translationKey: "nav.zoom_in_event_types", href: "/zoom-in/event-types", permission: "zoom_in.view" },
      { title: "Activity", translationKey: "nav.zoom_in_activity", href: "/zoom-in/activity", permission: "zoom_in.view" },
      { title: "Allocation", translationKey: "nav.zoom_in_allocation", href: "/zoom-in/allocation", permission: "zoom_in.view" },
      { title: "Eligible BTS", translationKey: "nav.zoom_in_eligible_bts", href: "/zoom-in/eligible-bts", permission: "zoom_in.view" },
    ],
  },
  {
    title: "Administration",
    translationKey: "nav.administration",
    icon: ShieldCheck,
    color: "text-cyan-500",
    children: [
      { title: "User Management", translationKey: "nav.users", href: "/users", permission: "users.view" },
      { title: "CV Management", translationKey: "nav.cv", href: "/cv", permission: "cv.view" },
      { title: "Retailer Marking", translationKey: "nav.retailer_marking", href: "/retailer-marking", permission: "retailers.view" },
      { title: "BP Retailer Codes", translationKey: "nav.bp_retailer_codes", href: "/bp-retailer-codes", permission: "reports.view" },
      { title: "Product Exclusions", translationKey: "nav.product_exclusions", href: "/product-exclusions", permission: "reports.view" },
      { title: "System Settings", translationKey: "nav.settings", href: "/settings", permission: "app_settings.manage" },
    ]
  },
];
