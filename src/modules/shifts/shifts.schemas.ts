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

export type CreateShiftBody = z.infer<typeof createShiftSchema>;
export type StartBreakBody = z.infer<typeof startBreakSchema>;