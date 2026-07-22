import { z } from "zod";

export const assignShipmentSchema = z.object({
  pilotId: z.string().uuid(),
  assetId: z.string().uuid(),
});

export const checkSubmissionSchema = z.object({
  photoUrls: z.array(z.string().url()).min(2, "At least 2 photos are required"),
  notes: z.string().optional(),
});

export const issueReasonSchema = z.enum([
  "GATE_GARAGE_CLOSED",
  "NUMBER_PLATE_NOT_MATCHING",
  "UNABLE_TO_REACH_LOCATION",
  "VEHICLE_NOT_AVAILABLE",
  "VEHICLE_PARKED_UNSAFE_AREA",
  "BY_CONTROL_CENTRE",
  "ACCESS_DENIED_BY_SECURITY",
  "VEHICLE_IN_PAID_PARKING",
  "OTHER",
]);

export const raiseIssueSchema = z.object({
  shipmentId: z.string().uuid().optional(), // omitted = order-wide issue (e.g. "unable to reach location")
  reason: issueReasonSchema,
  notes: z.string().optional(),
  photoUrls: z.array(z.string().url()).min(2, "At least 2 photos are required"),
});

export const listMyShipmentsQuerySchema = z.object({
  date: z.coerce.date().optional(), // defaults to today if omitted
  status: z.string().optional(), // comma-separated ShipmentStatus values, e.g. "ASSIGNED,ON_THE_WAY"
  limit: z.coerce.number().int().positive().max(100).default(20),
  cursor: z.string().uuid().optional(),
});

export type AssignShipmentBody = z.infer<typeof assignShipmentSchema>;
export type CheckSubmissionBody = z.infer<typeof checkSubmissionSchema>;
export type RaiseIssueBody = z.infer<typeof raiseIssueSchema>;
export type ListMyShipmentsQuery = z.infer<typeof listMyShipmentsQuerySchema>;