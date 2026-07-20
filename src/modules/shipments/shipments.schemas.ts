import { z } from "zod";

export const assignShipmentSchema = z.object({
  pilotId: z.string().uuid().optional(),
  assetId: z.string().uuid().optional(),
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
  shipmentId: z.string().uuid().optional(),
  reason: issueReasonSchema,
  notes: z.string().optional(),
  photoUrls: z.array(z.string().url()).min(2, "At least 2 photos are required"),
});

export type AssignShipmentBody = z.infer<typeof assignShipmentSchema>;
export type CheckSubmissionBody = z.infer<typeof checkSubmissionSchema>;
export type RaiseIssueBody = z.infer<typeof raiseIssueSchema>;