import { z } from "zod";

export const createAdminUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  roleId: z.string().uuid(),
});

export const updateAdminUserSchema = z.object({
  roleId: z.string().uuid().optional(),
  isActive: z.boolean().optional(),
});

export type CreateAdminUserBody = z.infer<typeof createAdminUserSchema>;
export type UpdateAdminUserBody = z.infer<typeof updateAdminUserSchema>;