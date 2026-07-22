import { z } from "zod";

export const promoDiscountTypeSchema = z.enum(["PERCENTAGE", "FIXED_AED"]);

export const createPromoCodeSchema = z
  .object({
    code: z.string().min(3).max(30),
    description: z.string().max(200).optional(),
    discountType: promoDiscountTypeSchema,
    discountValue: z.number().positive(),
    minOrderAED: z.number().positive().optional(),
    maxDiscountAED: z.number().positive().optional(),
    maxRedemptions: z.number().int().positive().optional(),
    maxRedemptionsPerUser: z.number().int().positive().default(1),
    validFrom: z.coerce.date(),
    validTo: z.coerce.date().optional(),
  })
  .refine((data) => data.discountType !== "PERCENTAGE" || data.discountValue <= 100, {
    message: "A percentage discount cannot exceed 100",
    path: ["discountValue"],
  });

export const updatePromoCodeSchema = z.object({
  description: z.string().max(200).optional(),
  isActive: z.boolean().optional(),
  validTo: z.coerce.date().nullable().optional(),
  maxRedemptions: z.number().int().positive().nullable().optional(),
});

export const validatePromoCodeSchema = z.object({
  code: z.string().min(1),
  orderSubtotalAED: z.number().positive(),
});

export const listPromoCodesQuerySchema = z.object({
  isActive: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
  cursor: z.string().uuid().optional(),
});

export type CreatePromoCodeBody = z.infer<typeof createPromoCodeSchema>;
export type UpdatePromoCodeBody = z.infer<typeof updatePromoCodeSchema>;
export type ValidatePromoCodeBody = z.infer<typeof validatePromoCodeSchema>;
export type ListPromoCodesQuery = z.infer<typeof listPromoCodesQuerySchema>;