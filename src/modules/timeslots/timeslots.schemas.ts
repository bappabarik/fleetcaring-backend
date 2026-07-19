import { z } from "zod";

const timeStringSchema = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Must be HH:MM 24-hour format");
const recurrenceRuleSchema = z.enum(["DAILY", "WEEKDAYS", "WEEKENDS"]);
const timeslotTypeSchema = z.enum(["STANDARD", "PRIORITY"]).default("STANDARD");

export const createTemplateSchema = z.object({
  opItemId: z.string().uuid(),
  zoneId: z.string().uuid(),
  startTime: timeStringSchema,
  endTime: timeStringSchema,
  recurrenceRule: recurrenceRuleSchema,
  capacity: z.number().int().nonnegative(),
  buffer: z.number().int().nonnegative().default(0),
  timeslotType: timeslotTypeSchema,
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional(),
});

export const updateTemplateSchema = z.object({
  capacity: z.number().int().nonnegative().optional(),
  buffer: z.number().int().nonnegative().optional(),
  isActive: z.boolean().optional(),
  endDate: z.coerce.date().nullable().optional(),
});

export const listTimeslotsQuerySchema = z.object({
  opItemId: z.string().uuid(),
  zoneId: z.string().uuid(),
  date: z.coerce.date(),
});

export const bookSlotSchema = z.object({
  timeslotId: z.string().uuid(),
});

export type CreateTemplateBody = z.infer<typeof createTemplateSchema>;
export type UpdateTemplateBody = z.infer<typeof updateTemplateSchema>;
export type ListTimeslotsQuery = z.infer<typeof listTimeslotsQuerySchema>;