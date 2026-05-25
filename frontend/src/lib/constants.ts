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
  children?: {
    title: string;
    href: string;
    icon?: LucideIcon;
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
    title: "Network Hub",
    icon: Network,
    color: "text-orange-500",
    children: [
      { title: "Houses", href: "/houses" },
      { title: "Retailers", href: "/retailers" },
      { title: "BTS Management", href: "/bts" },
    ]
  },
  {
    title: "Field Force Hub",
    icon: Users2,
    color: "text-purple-500",
    children: [
      { title: "Team Profiles", href: "/field-force" },
      { title: "KPI Reports (GA/C2C)", href: "/reports/kpi" },
      { title: "Attendance", href: "/attendance" },
    ]
  },
  {
    title: "Commercial & Sales",
    icon: Banknote,
    color: "text-green-500",
    children: [
      { title: "GA Live Report", href: "/reports/ga-live" },
      { title: "Lifting & Commission", href: "/commercial/lifting" },
      { title: "Daily Expenses", href: "/commercial/expenses" },
    ]
  },
  {
    title: "DMS Automation",
    icon: Zap,
    color: "text-yellow-500",
    children: [
      { title: "SIM Issue", href: "/dms/sim-issue" },
      { title: "SIM Status Check", href: "/dms/sim-status" },
      { title: "SIM Return", href: "/dms/sim-return" },
      { title: "Scratch Card Issue", href: "/dms/scratch-card" },
    ]
  },
  {
    title: "Administration",
    icon: ShieldCheck,
    color: "text-cyan-500",
    children: [
      { title: "User Management", href: "/users" },
      { title: "Roles & Permissions", href: "/roles" },
      { title: "System Settings", href: "/settings" },
    ]
  },
];
