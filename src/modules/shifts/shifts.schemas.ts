import { z } from "zod";

export const createShiftSchema = z
  .object({
    pilotId: z.string().uuid(),
    assetId: z.string().uuid(),
    zoneId: z.string().uuid(),
    startTime: z.coerce.date(),
    endTime: z.coerce.date(),
  })
  .refine((data) => data.endTime > data.startTime, {
    message: "endTime must be after startTime",
    path: ["endTime"],
  })
  .refine((data) => data.endTime > new Date(), {
    message: "Can't schedule a shift that's already over",
    path: ["endTime"],
  });

export const breakReasonSchema = z.enum([
  "LUNCH_BREAK",
  "ACCIDENT",
  "MECHANICAL_ISSUE",
  "SICKNESS",
  "RETURN_TO_DEPOT",
  "OTHER",
]);

export const startBreakSchema = z.object({
  reason: breakReasonSchema,
  durationAllowedMins: z.number().int().positive().max(240).optional(),
});

export const listShiftsQuerySchema = z.object({
  pilotId: z.string().uuid().optional(),
  zoneId: z.string().uuid().optional(),
  status: z.enum(["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW"]).optional(),
  dateFrom: z.coerce.date().optional(), // filters on startTime
  dateTo: z.coerce.date().optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
  cursor: z.string().uuid().optional(),
});

export type CreateShiftBody = z.infer<typeof createShiftSchema>;
export type StartBreakBody = z.infer<typeof startBreakSchema>;
export type ListShiftsQuery = z.infer<typeof listShiftsQuerySchema>;