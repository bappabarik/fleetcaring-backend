import { z } from "zod";

export const registerDeviceTokenSchema = z.object({
  token: z.string().min(1),
  platform: z.enum(["ios", "android"]),
});

export type RegisterDeviceTokenBody = z.infer<typeof registerDeviceTokenSchema>;