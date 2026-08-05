import { z } from "zod";

export const createIntentSchema = z.object({
  method: z.enum(["online", "cod"]).default("online"),
});

export const setCodCollectedSchema = z.object({
  collected: z.boolean(),
});

export type CreateIntentBody = z.infer<typeof createIntentSchema>;
export type SetCodCollectedBody = z.infer<typeof setCodCollectedSchema>;
