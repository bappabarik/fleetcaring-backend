import { env } from "../config/env.js";
import { zonedTimeToUtc } from "./timezone.js";

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
 * The one exception is `combineDateAndTime`, which deliberately interprets its
 * `hhmm` argument (op-hours like "09:00") as wall-clock time in the
 * deployment's configured `DEFAULT_TIMEZONE`, not UTC — see that function.
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

/** Interprets `hhmm` (e.g. op-hours like "09:00") as wall-clock time in
 * `timeZone` — defaulting to the deployment's `DEFAULT_TIMEZONE` — and returns
 * the equivalent UTC instant on `date`'s calendar day. */
export function combineDateAndTime(date: Date, hhmm: string, timeZone: string = env.DEFAULT_TIMEZONE): Date {
  return zonedTimeToUtc(date, hhmm, timeZone);
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