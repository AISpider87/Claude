export const LEAGUE_TIME_ZONE = "Europe/Rome";

/** Wall-clock parts of an instant in a time zone. */
function partsInZone(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, number> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== "literal") map[p.type] = Number(p.value);
  }
  return map;
}

/** Offset (ms) of `timeZone` from UTC at the given instant. */
function offsetAt(date: Date, timeZone: string) {
  const p = partsInZone(date, timeZone);
  const asUtc = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
  return asUtc - date.getTime();
}

/**
 * Converts a local wall-clock string ("2026-09-06T20:00", as produced by
 * <input type="datetime-local">) in the league time zone to a UTC Date.
 * Handles DST by iterating on the offset (two passes are enough).
 */
export function zonedLocalToUtc(local: string, timeZone = LEAGUE_TIME_ZONE): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(local.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const naive = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s ?? 0),
  );
  let guess = naive - offsetAt(new Date(naive), timeZone);
  guess = naive - offsetAt(new Date(guess), timeZone);
  const result = new Date(guess);
  return Number.isNaN(result.getTime()) ? null : result;
}

/** UTC instant → "YYYY-MM-DDTHH:mm" in the league time zone (for datetime-local inputs). */
export function utcToZonedLocal(date: Date | string, timeZone = LEAGUE_TIME_ZONE): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const p = partsInZone(d, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month!)}-${pad(p.day!)}T${pad(p.hour!)}:${pad(p.minute!)}`;
}
