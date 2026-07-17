/**
 * Central list of permission keys. Import these constants rather than
 * typing raw strings in route files — a typo here would silently mean
 * "no admin can ever pass this check", which is a bad failure mode to
 * discover at typo-detection speed instead of compile time.
 */
export const PERMISSIONS = {
  ZONES_READ: "zones:read",
  ZONES_WRITE: "zones:write",
  CATALOG_READ: "catalog:read",
  CATALOG_WRITE: "catalog:write",
  PRICING_READ: "pricing:read",
  PRICING_WRITE: "pricing:write",
  TIMESLOTS_READ: "timeslots:read",
  TIMESLOTS_WRITE: "timeslots:write",
  ORDERS_READ: "orders:read",
  ORDERS_WRITE: "orders:write",
  SHIPMENTS_READ: "shipments:read",
  SHIPMENTS_WRITE: "shipments:write",
  ISSUES_READ: "issues:read",
  ISSUES_WRITE: "issues:write",
  PILOTS_READ: "pilots:read",
  PILOTS_WRITE: "pilots:write",
  ASSETS_READ: "assets:read",
  ASSETS_WRITE: "assets:write",
  SHIFTS_READ: "shifts:read",
  SHIFTS_WRITE: "shifts:write",
  CUSTOMERS_READ: "customers:read",
  FINANCE_READ: "finance:read",
  FINANCE_REFUND: "finance:refund",
  FINANCE_REPORTS: "finance:reports",
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: PermissionKey[] = Object.values(PERMISSIONS);