import { z } from "zod";

export const financeReportQuerySchema = z.object({
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  zoneId: z.string().uuid().optional(),
});

export type FinanceReportQuery = z.infer<typeof financeReportQuerySchema>;