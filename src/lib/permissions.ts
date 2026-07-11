// Writer sets shared between nav, page guards and action buttons.
// Mirrors the restrictive RLS policies (see 20260711090000_equipment_inventory.sql).
// When per-account permission overrides land, resolve them here so callers
// don't change.

export type Role = string | null | undefined;

export const EQUIPMENT_WRITERS = ["admin", "operations", "supervisor", "payroll"] as const;

export function canWriteEquipment(role: Role): boolean {
  return !!role && (EQUIPMENT_WRITERS as readonly string[]).includes(role);
}
