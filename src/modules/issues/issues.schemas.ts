import { z } from "zod";

export const listIssuesQuerySchema = z.object({
  resolved: z.enum(["true", "false"]).optional(),
  reason: z.string().optional(),
  zoneId: z.string().uuid().optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
  cursor: z.string().uuid().optional(),
});

export const resolveIssueSchema = z.object({
  resolutionNotes: z.string().max(1000).optional(),
});

export type ListIssuesQuery = z.infer<typeof listIssuesQuerySchema>;
export type ResolveIssueBody = z.infer<typeof resolveIssueSchema>;