/**
 * Calendar helpers for plain YYYY-MM-DD dates.
 *
 * Two separate concerns live here and it matters which is which:
 *  - "what is today" depends on the household's timezone, so it goes through Intl;
 *  - arithmetic on an already-resolved date is pure calendar math, done in UTC
 *    so that daylight saving and offsets can't shift a day.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= daysInMonth(y, m);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Today in the given IANA timezone, as YYYY-MM-DD. */
export function todayInTimeZone(timeZone: string, at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Throws if the timezone is not one Node recognises — better at boot than at 2am. */
export function assertValidTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
  } catch {
    throw new Error(`TIMEZONE "${timeZone}" is not a recognised IANA timezone name`);
  }
}

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return shifted.toISOString().slice(0, 10);
}

/** First and last day of the month containing the given date. */
export function monthBounds(isoDate: string): { start: string; end: string } {
  const [y, m] = isoDate.split("-").map(Number) as [number, number];
  const mm = String(m).padStart(2, "0");
  return {
    start: `${y}-${mm}-01`,
    end: `${y}-${mm}-${String(daysInMonth(y, m)).padStart(2, "0")}`,
  };
}

/** First and last day of the month before the one containing the given date. */
export function previousMonthBounds(isoDate: string): { start: string; end: string } {
  const { start } = monthBounds(isoDate);
  return monthBounds(addDays(start, -1));
}

/** "2026-09-13" → "2026-09", the key used when grouping a report by month. */
export function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/** Inclusive on both ends, which is how people mean a date range. */
export function isWithin(isoDate: string, start: string, end: string): boolean {
  return isoDate >= start && isoDate <= end;
}
