import { z } from "zod";

export const createOrderSchema = z.object({
  addressId: z.string().uuid(),
  timeslotId: z.string().uuid(),
  itemVariationId: z.string().uuid(),
  vehicleIds: z.array(z.string().uuid()).min(1),
  addOnItemVariationIds: z.array(z.string().uuid()).default([]),
  notes: z.string().optional(),
});

export type CreateOrderBody = z.infer<typeof createOrderSchema>;