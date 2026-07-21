import { z } from "zod";

const phoneNumberSchema = z.string().regex(/^\+[1-9]\d{6,14}$/, "Must be E.164 format, e.g. +9715XXXXXXXX");

export const createPilotSchema = z.object({
  code: z.string().min(1),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phoneNumber: phoneNumberSchema,
  verticalId: z.string().uuid().optional(),
  // Optional: if provided, the pilot can log in with email+password
  // immediately; otherwise they're limited to phone+OTP until a password
  // is set later (e.g. via a "set password" flow — not built yet).
  password: z.string().min(8).optional(),
});

export const updatePilotSchema = z.object({
  status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED"]).optional(),
  verticalId: z.string().uuid().nullable().optional(),
});

export const updateMyPilotPreferencesSchema = z.object({
  preferredNavApp: z.enum(["google_maps", "waze", "2gis"]).optional(),
  language: z.enum(["en", "ar"]).optional(),
});

export const listPilotsQuerySchema = z.object({
  search: z.string().optional(), // matches name, code, email, or phone
  status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED"]).optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
  cursor: z.string().uuid().optional(),
});

export type CreatePilotBody = z.infer<typeof createPilotSchema>;
export type UpdatePilotBody = z.infer<typeof updatePilotSchema>;
export type UpdateMyPilotPreferencesBody = z.infer<typeof updateMyPilotPreferencesSchema>;
export type ListPilotsQuery = z.infer<typeof listPilotsQuerySchema>;