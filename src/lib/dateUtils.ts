export type RecurrenceRule = "DAILY" | "WEEKDAYS" | "WEEKENDS";

/**
 * Every function here operates in UTC explicitly (getUTCDate, setUTCHours,
 * Date.UTC, etc.), never local time. This is deliberate: mixing UTC-parsed
 * date strings (which is how JS parses date-only ISO strings like "2026-07-18")
 * with local-timezone arithmetic causes date drift that depends on what
 * timezone the server happens to be running in — the same code would give
 * different answers in local dev (e.g. IST) vs. production (typically
 * UTC). Standardizing on UTC everywhere makes this deterministic.
 *
 * Known simplification: op-hours strings like "09:00" are currently
 * interpreted as UTC directly, not as Dubai local time (UTC+4). That's a
 * separate, smaller decision to make later (e.g. a per-zone timezone
 * field) — this fix specifically eliminates the server-timezone-dependent
 * bug, which was the immediate correctness problem.
 */

export function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export function matchesRecurrence(date: Date, rule: string): boolean {
  const day = date.getUTCDay();
  switch (rule as RecurrenceRule) {
    case "WEEKDAYS":
      return day >= 1 && day <= 5;
    case "WEEKENDS":
      return day === 0 || day === 6;
    case "DAILY":
    default:
      return true;
  }
}

export function combineDateAndTime(date: Date, hhmm: string): Date {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hours, minutes, 0, 0));
}

export function generateMatchingDates(rangeStart: Date, rangeEnd: Date, rule: string): Date[] {
  const dates: Date[] = [];
  let current = startOfDay(rangeStart);
  const end = startOfDay(rangeEnd);

  while (current <= end) {
    if (matchesRecurrence(current, rule)) {
      dates.push(new Date(current));
    }
    current = addDays(current, 1);
  }

  return dates;
}