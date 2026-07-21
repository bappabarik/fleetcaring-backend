import { z } from "zod";

export const listCustomersQuerySchema = z.object({
  search: z.string().optional(), // matches name, phone, or email
  limit: z.coerce.number().int().positive().max(100).default(20),
  cursor: z.string().uuid().optional(),
});

export const updateMyCustomerProfileSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email("Must be a valid email address").optional(),
});

export type ListCustomersQuery = z.infer<typeof listCustomersQuerySchema>;
export type UpdateMyCustomerProfileBody = z.infer<typeof updateMyCustomerProfileSchema>;