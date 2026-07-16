import { z } from "zod";

// E.164-ish phone number check — real format validation happens at Twilio.
const phoneNumberSchema = z.string().regex(/^\+[1-9]\d{6,14}$/, "Must be E.164 format, e.g. +9715XXXXXXXX");

export const otpRequestSchema = z.object({
  phoneNumber: phoneNumberSchema,
});

export const otpVerifySchema = z.object({
  phoneNumber: phoneNumberSchema,
  code: z.string().length(4).regex(/^\d+$/),
});

export const pilotLoginSchema = z.object({
  emailOrCode: z.string().min(1),
  password: z.string().min(1),
});

export const adminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
});

export type OtpRequestBody = z.infer<typeof otpRequestSchema>;
export type OtpVerifyBody = z.infer<typeof otpVerifySchema>;
export type PilotLoginBody = z.infer<typeof pilotLoginSchema>;
export type AdminLoginBody = z.infer<typeof adminLoginSchema>;
export type RefreshTokenBody = z.infer<typeof refreshTokenSchema>;
