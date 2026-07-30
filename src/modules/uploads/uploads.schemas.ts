import { z } from "zod";

const allowedContentTypes = ["image/jpeg", "image/png", "image/webp"] as const;

export const presignUploadSchema = z.object({
  contentType: z.enum(allowedContentTypes),
  purpose: z.enum(["precheck", "postcheck", "issue", "avatar", "vehicle"]),
});

export type PresignUploadBody = z.infer<typeof presignUploadSchema>;