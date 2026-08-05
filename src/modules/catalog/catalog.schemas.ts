import { z } from "zod";

export const createVerticalSchema = z.object({ name: z.string().min(1) });

export const createBrandSchema = z.object({ name: z.string().min(1) });

export const createOpItemSchema = z.object({
  name: z.string().min(1),
  verticalId: z.string().uuid(),
  brandId: z.string().uuid().optional(),
});

export const updateOpItemSchema = z.object({
  name: z.string().min(1).optional(),
  brandId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
});

const vehicleClassEnum = z.enum(["SEDAN", "SUV", "VAN", "TRUCK"]);

export const createVariationSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  price: z.number().positive(),
  durationMins: z.number().int().positive(),
  vehicleClass: vehicleClassEnum.optional(),
});

export const updateVariationSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  price: z.number().positive().optional(),
  durationMins: z.number().int().positive().optional(),
  vehicleClass: vehicleClassEnum.optional(),
  isActive: z.boolean().optional(),
});

export const createPriceRuleSchema = z.object({
  zoneId: z.string().uuid().optional(),
  multiplier: z.number().positive().default(1),
  fixedAdjustment: z.number().optional(),
  // UTC day-of-week: 0=Sun ... 6=Sat. Empty (default) = applies every day.
  // e.g. [0, 6] for an ongoing weekend surcharge.
  daysOfWeek: z.array(z.number().int().min(0).max(6)).default([]),
  validFrom: z.coerce.date().optional(),
  validTo: z.coerce.date().optional(),
});

export const updatePriceRuleSchema = z.object({
  zoneId: z.string().uuid().nullable().optional(),
  multiplier: z.number().positive().optional(),
  fixedAdjustment: z.number().nullable().optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
  validFrom: z.coerce.date().nullable().optional(),
  validTo: z.coerce.date().nullable().optional(),
  isActive: z.boolean().optional(),
});

export const resolvePriceQuerySchema = z.object({
  zoneId: z.string().uuid().optional(),
  at: z.coerce.date().optional(), // preview pricing for a specific date (e.g. "what would this cost on a Friday")
});

export type CreateOpItemBody = z.infer<typeof createOpItemSchema>;
export type UpdateOpItemBody = z.infer<typeof updateOpItemSchema>;
export type CreateVariationBody = z.infer<typeof createVariationSchema>;
export type UpdateVariationBody = z.infer<typeof updateVariationSchema>;
export type CreatePriceRuleBody = z.infer<typeof createPriceRuleSchema>;
export type UpdatePriceRuleBody = z.infer<typeof updatePriceRuleSchema>;