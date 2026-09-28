"use client";

import { useMemo } from "react";
import EntitySelector, { type SelectorItem } from "@/app/zoom-in/_components/EntitySelector";
import FilterField from "./FilterField";
import { useLanguage } from "@/i18n/useLanguage";

interface SearchableSelectProps {
  label: string;
  items: SelectorItem[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  noResultsMessage?: string;
  disabled?: boolean;
  /** Non-colour explanation rendered under the control when disabled. */
  disabledReason?: string;
  loading?: boolean;
  onSearchChange?: (q: string) => void;
  /**
   * Hide the option list until the query reaches this many characters. Set it when
   * the options are fully loaded up-front (long lists), so nothing is listed before
   * the user searched.
   */
  className?: string;
}

/**
 * Single-select searchable dropdown used by every filter panel. It delegates the
 * trigger/menu behaviour to the shared EntitySelector (portal aware) and only adds
 * the label, hint and loading plumbing, so no filter page has to re-implement
 * dropdown UI.
 */
export default function SearchableSelect({
  label,
  items,
  value,
  onChange,
  placeholder,
  searchPlaceholder,
  emptyMessage,
  noResultsMessage,
  disabled = false,
  disabledReason,
  loading = false,
  onSearchChange,
  className,
}: SearchableSelectProps) {
  const { t } = useLanguage();

  // The API returns numeric ids for houses/employees while filter state is always
  // a string. Normalising here keeps the selector's strict id comparison honest
  // instead of relying on loose equality.
  const normalizedItems = useMemo(
    () => items.map((item) => ({ ...item, id: String(item.id) })),
    [items]
  );

  return (
    <FilterField label={label} disabledReason={disabled ? disabledReason : undefined} className={className}>
      <EntitySelector
        label={label}
        hideLabel
        items={normalizedItems}
        selectedIds={value ? [String(value)] : []}
        onChange={(ids) => onChange(ids.length ? String(ids[0]) : "")}
        placeholder={placeholder}
        searchPlaceholder={searchPlaceholder}
        emptyMessage={emptyMessage}
        noResultsMessage={noResultsMessage}
        disabled={disabled || loading}
        single
        selectAllLabel={t("common.select_all")}
        clearLabel={t("common.clear")}
        selectedLabel={t("activations.filters.selected")}
        onSearchChange={onSearchChange}
        portal
      />
    </FilterField>
  );
}
