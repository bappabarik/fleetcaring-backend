import { z } from "zod";

export const addressLabelSchema = z.enum(["HOME", "WORK", "CUSTOM"]);

export const createAddressSchema = z.object({
  label: z.string().min(1),
  labelType: addressLabelSchema,
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  addressText: z.string().min(1),
  notes: z.string().optional(),
});

export const updateAddressSchema = z.object({
  label: z.string().min(1).optional(),
  labelType: addressLabelSchema.optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  addressText: z.string().min(1).optional(),
  notes: z.string().nullable().optional(),
});

export type CreateAddressBody = z.infer<typeof createAddressSchema>;
export type UpdateAddressBody = z.infer<typeof updateAddressSchema>;