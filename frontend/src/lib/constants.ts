import { LucideIcon } from "lucide-react";
import { 
  LayoutDashboard, 
  Users2, 
  Store, 
  MapPin, 
  Settings, 
  BarChart3,
  Calendar,
  ShieldCheck,
  Shield,
  Home,
  Network,
  Banknote,
  Zap,
  TrendingUp,
  FileSpreadsheet,
  Wallet,
  SmartphoneNfc,
  ClipboardList
} from "lucide-react";

export interface NavItem {
  title: string;
  href?: string;
  icon: LucideIcon;
  color?: string;
  permission?: string;
  children?: {
    title: string;
    href: string;
    icon?: LucideIcon;
    permission?: string;
  }[];
}

export const navItems: NavItem[] = [
  {
    title: "Dashboard",
    href: "/",
    icon: LayoutDashboard,
    color: "text-blue-500",
  },
  {
    title: "Data Management",
    icon: Network,
    color: "text-orange-500",
    children: [
      { title: "Houses", href: "/houses", permission: "view_houses" },
      { title: "Employees", href: "/employees", permission: "view_employees" },
      { title: "Retailers", href: "/retailers", permission: "view_retailers" },
      { title: "BTS Management", href: "/bts", permission: "view_bts" },
    ]
  },
  {
    title: "Employee Hub",
    icon: Users2,
    color: "text-purple-500",
    children: [
      { title: "Team Profiles", href: "/employees", permission: "view_employees" },
      { title: "KPI Reports (GA/C2C)", href: "/reports/kpi", permission: "view_reports" },
      { title: "Attendance", href: "/attendance", permission: "view_attendance" },
    ]
  },
  {
    title: "Commercial & Sales",
    icon: Banknote,
    color: "text-green-500",
    children: [
      { title: "GA Live Report", href: "/reports/ga-live", permission: "view_reports" },
      { title: "Lifting & Commission", href: "/commercial/lifting", permission: "view_lifting" },
      { title: "Daily Expenses", href: "/commercial/expenses", permission: "view_expenses" },
    ]
  },
  {
    title: "DMS Automation",
    icon: Zap,
    color: "text-yellow-500",
    children: [
      { title: "SIM Issue", href: "/dms/sim-issue", permission: "view_sim_issue" },
      { title: "SIM Status Check", href: "/dms/sim-status", permission: "view_sim_status" },
      { title: "SIM Return", href: "/dms/sim-return", permission: "view_sim_return" },
      { title: "Scratch Card Issue", href: "/dms/scratch-card", permission: "view_scratch_card" },
    ]
  },
  {
    title: "Roles & Permissions",
    icon: Shield,
    color: "text-red-500",
    children: [
      { title: "Roles", href: "/roles", permission: "view_roles" },
      { title: "Permissions", href: "/permissions", permission: "view_permissions" },
    ]
  },
  {
    title: "Administration",
    icon: ShieldCheck,
    color: "text-cyan-500",
    children: [
      { title: "User Management", href: "/users", permission: "view_users" },
      { title: "System Settings", href: "/settings", permission: "view_settings" },
    ]
  },
];
