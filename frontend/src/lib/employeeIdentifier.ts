/**
 * Which number identifies an employee.
 *
 * RSOs are identified by their iTopUp number; every other role (BP, supervisor,
 * manager, BSP, RBSP) is identified by their pool number. Each side falls back to
 * the other so a card or list line never shows an empty slot while data exists.
 *
 * Shared by the live-location list and the travel-history page so both always
 * apply the same rule.
 */
export type EmployeeIdentifierKind = "itop" | "pool";

export interface EmployeeIdentifierSource {
  employee_type?: string | null;
  itop_number?: string | null;
  pool_number?: string | null;
}

export function isRsoEmployee(item: EmployeeIdentifierSource): boolean {
  return (item.employee_type || "").toLowerCase() === "rso";
}

export function employeeIdentifier(
  item: EmployeeIdentifierSource
): { kind: EmployeeIdentifierKind; value: string } | null {
  const rso = isRsoEmployee(item);
  const preferred = rso
    ? { kind: "itop" as const, value: item.itop_number }
    : { kind: "pool" as const, value: item.pool_number };
  const fallback = rso
    ? { kind: "pool" as const, value: item.pool_number }
    : { kind: "itop" as const, value: item.itop_number };

  if (preferred.value) return { kind: preferred.kind, value: preferred.value };
  if (fallback.value) return { kind: fallback.kind, value: fallback.value };
  return null;
}

/** Convenience for the places that only need the number itself. */
export function employeeIdentifierValue(item: EmployeeIdentifierSource): string | null {
  return employeeIdentifier(item)?.value ?? null;
}
