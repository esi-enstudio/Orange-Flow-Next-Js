"use client";

import { useState } from "react";
import { Building2, Check, ChevronDown, Loader2 } from "lucide-react";
import { toast } from "react-hot-toast";

import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const displayName = (house: { name: string; code?: string }) =>
  house.code ? `${house.name} (${house.code})` : house.name;

/** Active-house picker for users assigned to more than one house. */
export function HouseSwitcher() {
  const { user, selectedHouse, setSelectedHouse } = useAuth();
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<number | null>(null);

  // /auth/me already returns the same accessible set as /houses/accessible, so
  // both shell placements share one authoritative list with no duplicate fetch.
  const houses = [...(user?.houses ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  if (houses.length < 2) return null;

  const activeHouse = houses.find((house) => house.id === selectedHouse?.id);
  const activeName = activeHouse
    ? displayName(activeHouse)
    : t("common.house_switcher_no_houses");

  const handleSelect = async (houseId: number) => {
    if (pending !== null || houseId === selectedHouse?.id) return;
    setPending(houseId);
    try {
      await setSelectedHouse(houseId);
      setOpen(false);
    } catch {
      toast.error(t("common.house_switcher_error"));
    } finally {
      setPending(null);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={pending !== null}
          aria-label={`${t("common.house_switcher_open")}: ${activeName}`}
          title={`${t("common.house_switcher_label")}: ${activeName}`}
          className="flex min-h-11 max-w-[200px] cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Building2 className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">
            {pending !== null ? t("common.house_switcher_switching") : activeName}
          </span>
          <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-56 max-w-[calc(100vw-1rem)] p-1"
      >
        <div className="flex flex-col gap-0.5">
          {houses.map((house) => {
            const isActive = house.id === selectedHouse?.id;
            return (
              <button
                key={house.id}
                type="button"
                disabled={pending !== null}
                aria-current={isActive ? "true" : undefined}
                onClick={() => void handleSelect(house.id)}
                className={cn(
                  "flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-md px-2.5 text-left text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
                  isActive && "bg-primary/10 font-semibold text-primary"
                )}
              >
                <span className="min-w-0 flex-1 truncate">
                  {displayName(house)}
                </span>
                {pending === house.id ? (
                  <Loader2 className="size-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                ) : isActive ? (
                  <Check className="size-4 shrink-0" aria-hidden="true" />
                ) : null}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
