import { z } from "zod";

const phoneNumberSchema = z.string().regex(/^\+[1-9]\d{6,14}$/, "Must be E.164 format, e.g. +9715XXXXXXXX");

export const createPilotSchema = z.object({
  code: z.string().min(1),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phoneNumber: phoneNumberSchema,
  verticalId: z.string().uuid().optional(),
  password: z.string().min(8).optional(),
});

export const updatePilotSchema = z.object({
  status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED"]).optional(),
  verticalId: z.string().uuid().nullable().optional(),
});

export type CreatePilotBody = z.infer<typeof createPilotSchema>;
export type UpdatePilotBody = z.infer<typeof updatePilotSchema>;