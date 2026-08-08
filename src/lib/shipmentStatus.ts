import type { ShipmentStatus } from "@prisma/client";

/**
 * A shipment in one of these statuses means a pilot is actively working
 * it right now — assigned but not yet started counts as active too, since
 * the pilot is already committed to it. Used everywhere "is this pilot
 * busy / can this asset be double-booked / is this shift's work actually
 * done" needs answering: shipment (re)assignment conflict checks, shift
 * auto-expiry's idle check, and pilot deactivation's outstanding-work
 * warning.
 *
 * Previously duplicated inline in a couple of these call sites — kept as
 * one shared constant so the definition of "active" can't silently drift
 * between them.
 */
export const ACTIVE_SHIPMENT_STATUSES: ShipmentStatus[] = ["ASSIGNED", "ON_THE_WAY", "ARRIVED", "IN_PROGRESS"];
