import { z } from "zod";

export const createOrderSchema = z.object({
  addressId: z.string().uuid(),
  timeslotId: z.string().uuid(),
  itemVariationId: z.string().uuid(),
  vehicleIds: z.array(z.string().uuid()).min(1),
  addOnItemVariationIds: z.array(z.string().uuid()).default([]),
  notes: z.string().optional(),
});

export const cancelOrderSchema = z.object({
  reason: z.string().max(500).optional(),
});

export const listOrdersQuerySchema = z.object({
  status: z.enum(["active", "completed", "cancelled"]).optional(),
  zoneId: z.string().uuid().optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
  cursor: z.string().uuid().optional(),
});

export type CreateOrderBody = z.infer<typeof createOrderSchema>;
export type CancelOrderBody = z.infer<typeof cancelOrderSchema>;
export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;