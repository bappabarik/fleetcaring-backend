import { z } from "zod";

export const createAssetSchema = z.object({
  plateCode: z.string().min(1),
  name: z.string().min(1),
  type: z.string().min(1),
});

export const updateAssetSchema = z.object({
  name: z.string().min(1).optional(),
  type: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});

export const listAssetsQuerySchema = z.object({
  search: z.string().optional(), // matches plateCode or name
  isActive: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
  cursor: z.string().uuid().optional(),
});

export type CreateAssetBody = z.infer<typeof createAssetSchema>;
export type UpdateAssetBody = z.infer<typeof updateAssetSchema>;
export type ListAssetsQuery = z.infer<typeof listAssetsQuerySchema>;