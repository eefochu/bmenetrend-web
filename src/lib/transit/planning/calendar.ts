/**
 * Ports of data/ServiceCalendar.kt, KanyargoCalendar.kt, HommCalendar.kt and
 * ViabuszTimetableParser.activeCalendar. Days are Budapest calendar dates as "YYYY-MM-DD".
 */
export type Day = string;

const pad = (value: number) => String(value).padStart(2, "0");
const parse = (day: Day) => day.split("-").map(Number) as [number, number, number];
const utc = (day: Day) => {
  const [y, m, d] = parse(day);
  return Date.UTC(y, m - 1, d);
};
export const addDays = (day: Day, days: number): Day => new Date(utc(day) + days * 86_400_000).toISOString().slice(0, 10);
const weekday = (day: Day) => new Date(utc(day)).getUTCDay(); // 0 Sunday … 6 Saturday
const monthDay = (day: Day) => day.slice(5);

/** Annual transfers must be checked against the promulgated decree before adding a year (2026: 2025-10-20-2X). */
const REVIEWED_YEARS: Record<number, { restDays: Set<string>; workingDays: Set<string> }> = {
  2026: { restDays: new Set(["01-02", "08-21", "12-24"]), workingDays: new Set(["01-10", "08-08", "12-12"]) },
  // Add 2027 only after checking its official annual decree; not by copying 2026.
};
const FIXED_HOLIDAYS = ["01-01", "03-15", "05-01", "08-20", "10-23", "11-01", "12-25", "12-26"];

/** Gregorian Meeus/Jones/Butcher computus. */
function easterSunday(year: number): Day {
  const a = year % 19,
    b = Math.trunc(year / 100),
    c = year % 100,
    d = Math.trunc(b / 4),
    e = b % 4,
    f = Math.trunc((b + 8) / 25),
    g = Math.trunc((b - f + 1) / 3),
    h = (19 * a + b - d - g + 15) % 30,
    i = Math.trunc(c / 4),
    k = c % 4,
    l = (32 + 2 * e + 2 * i - h - k) % 7,
    m = Math.trunc((a + 11 * h + 22 * l) / 451),
    combined = h + l - 7 * m + 114;
  return `${year}-${pad(Math.trunc(combined / 31))}-${pad((combined % 31) + 1)}`;
}

export function publicHolidays(year: number): Set<Day> {
  const easter = easterSunday(year);
  return new Set([...FIXED_HOLIDAYS.map((md) => `${year}-${md}`), addDays(easter, -2), addDays(easter, 1), addDays(easter, 50)]);
}

export const isYearReviewed = (year: number) => year in REVIEWED_YEARS;

export function isConfirmedWorkingDay(day: Day): boolean {
  const year = parse(day)[0];
  const transfers = REVIEWED_YEARS[year];
  if (!transfers) return false;
  const md = monthDay(day);
  const dow = weekday(day);
  return (
    !publicHolidays(year).has(day) &&
    !transfers.restDays.has(md) &&
    (transfers.workingDays.has(md) || (dow !== 6 && dow !== 0))
  );
}

const within = (day: Day, from: Day, to: Day) => day >= from && day <= to;
const AUTUMN: [Day, Day] = ["2026-10-23", "2026-11-01"];
const WINTER: [Day, Day] = ["2026-12-19", "2027-01-03"];

/** KanyargoCalendar: working days only, reviewed 2026-09-01 … 2026-12-31. */
export function kanyargoCalendar(day: Day): string | null {
  if (!within(day, "2026-09-01", "2026-12-31") || !isConfirmedWorkingDay(day)) return null;
  return within(day, ...AUTUMN) || within(day, ...WINTER) ? "school_break" : "school_term";
}

/** HommCalendar: its second table covers weekends, public holidays and school breaks. */
export function hommCalendar(day: Day): string | null {
  if (!within(day, "2026-09-01", "2026-12-31") || !isYearReviewed(parse(day)[0])) return null;
  const dow = weekday(day);
  const weekend = dow === 6 || dow === 0;
  return weekend || !isConfirmedWorkingDay(day) || within(day, ...AUTUMN) || within(day, ...WINTER) ? "school_break" : "school_term";
}

/** ViabuszTimetableParser.activeCalendar: the school table was revised on October 1; not backdated. */
export function viabuszCalendar(day: Day): string | null {
  if (day < "2026-10-01") return null;
  return kanyargoCalendar(day);
}

/** LocalTimetableRouter.calendar */
export function providerCalendar(provider: string, day: Day): string | null {
  switch (provider) {
    case "viabusz":
      return viabuszCalendar(day);
    case "kanyargo":
      return kanyargoCalendar(day);
    case "homm":
      return hommCalendar(day);
    default:
      return null;
  }
}

/** The Budapest calendar day of an instant. */
export const budapestDay = (at: number): Day =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);

const wallClock = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Budapest",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/** date.atTime(MIDNIGHT).plusMinutes(minute) in Budapest; null in a DST gap or overlap (getValidOffsets ≠ 1). */
export function localInstant(day: Day, minute: number): number | null {
  const [y, m, d] = parse(day);
  const naive = Date.UTC(y, m - 1, d) + minute * 60_000;
  const matches = [60, 120]
    .map((offset) => naive - offset * 60_000)
    .filter((ms) => {
      const parts = Object.fromEntries(wallClock.formatToParts(ms).map((part) => [part.type, part.value]));
      return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute)) === naive;
    });
  return matches.length === 1 ? matches[0]! : null;
}
