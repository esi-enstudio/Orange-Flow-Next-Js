import type { ReactNode, ComponentType, SVGProps } from "react";
import { WhatsAppLogo, TelegramLogo, GmailLogo } from "@/app/connections/_components/logos";

export type ConnectionProvider = "whatsapp" | "telegram" | "gmail";

export interface ConnectionProviderPresentation {
  key: ConnectionProvider;
  nameKey: string;
  descriptionKey: string;
  /** Logo component for this provider. Renders an inline SVG brand logo. */
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Icon tile classes (light + dark). */
  tileClass: string;
  /** Connect/disconnect permission for this provider. */
  permission: string;
  /** Translation key under `connectionsPage.used_for`. */
  usedForKey: string;
}

export const CONNECTION_PROVIDERS: Record<
  ConnectionProvider,
  ConnectionProviderPresentation
> = {
  whatsapp: {
    key: "whatsapp",
    nameKey: "connectionsPage.whatsapp.name",
    descriptionKey: "connectionsPage.whatsapp.description",
    icon: WhatsAppLogo,
    tileClass:
      "bg-green-50 text-green-600 dark:bg-green-500/10 dark:text-green-400",
    permission: "whatsapp.connect",
    usedForKey: "connectionsPage.used_for.report_delivery",
  },
  telegram: {
    key: "telegram",
    nameKey: "connectionsPage.telegram.name",
    descriptionKey: "connectionsPage.telegram.description",
    icon: TelegramLogo,
    tileClass: "bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400",
    permission: "telegram.connect",
    usedForKey: "connectionsPage.used_for.report_delivery",
  },
  gmail: {
    key: "gmail",
    nameKey: "connectionsPage.gmail.name",
    descriptionKey: "connectionsPage.gmail.description",
    icon: GmailLogo,
    tileClass:
      "bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400",
    permission: "gmail.connect",
    usedForKey: "connectionsPage.used_for.email",
  },
};
