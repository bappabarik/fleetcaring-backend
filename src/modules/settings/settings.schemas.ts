import { z } from "zod";

export const setGeofencingSchema = z.object({
  enabled: z.boolean(),
});

export type SetGeofencingBody = z.infer<typeof setGeofencingSchema>;