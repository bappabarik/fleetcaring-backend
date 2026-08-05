/**
 * Convert a wall-clock time in an IANA timezone to the equivalent UTC instant,
 * without pulling in a timezone library — Node's built-in Intl has full ICU
 * data, so this is a few lines rather than a new dependency.
 *
 * Correct for fixed-offset zones (Asia/Kolkata, Asia/Dubai — neither observes
 * DST, which covers every market this app currently targets). For a zone that
 * does observe DST, the offset is computed from `date` itself rather than the
 * final wall-clock instant, which can be off by the DST delta right at a
 * transition boundary — acceptable today, worth revisiting if a DST-observing
 * region is ever added.
 */
function getTimezoneOffsetMinutes(timeZone: string, date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});

  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );

  return (asUTC - date.getTime()) / 60_000;
}

/** `date`'s year/month/day combined with the `hh:mm` wall-clock time as understood
 * in `timeZone`, returned as the equivalent UTC `Date`. E.g. `zonedTimeToUtc(<Aug 5>,
 * "09:00", "Asia/Kolkata")` returns the UTC instant for 09:00 IST (03:30 UTC). */
export function zonedTimeToUtc(date: Date, hhmm: string, timeZone: string): Date {
  const [hours, minutes] = hhmm.split(":").map(Number);
  const wallClockAsUTC = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hours, minutes, 0, 0);
  const offsetMinutes = getTimezoneOffsetMinutes(timeZone, new Date(wallClockAsUTC));
  return new Date(wallClockAsUTC - offsetMinutes * 60_000);
}
