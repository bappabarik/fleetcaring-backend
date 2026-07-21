import { z } from "zod";

const fuelTypeSchema = z.enum(["PETROL", "DIESEL", "ELECTRIC", "HYBRID"]);

export const createVehicleSchema = z.object({
  make: z.string().min(1),
  model: z.string().min(1),
  year: z.number().int().min(1980).max(2100).optional(),
  licensePlate: z.string().min(1),
  color: z.string().min(1),
  fuelType: fuelTypeSchema,
  isDefault: z.boolean().optional(),
});

export const updateVehicleSchema = z.object({
  make: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  year: z.number().int().min(1980).max(2100).nullable().optional(),
  licensePlate: z.string().min(1).optional(),
  color: z.string().min(1).optional(),
  fuelType: fuelTypeSchema.optional(),
  isDefault: z.boolean().optional(),
});

export type CreateVehicleBody = z.infer<typeof createVehicleSchema>;
export type UpdateVehicleBody = z.infer<typeof updateVehicleSchema>;