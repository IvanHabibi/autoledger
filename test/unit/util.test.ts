import { describe, expect, it } from "vitest";
import {
  addDays,
  daysInMonth,
  isIsoDate,
  isWithin,
  monthBounds,
  monthKey,
  previousMonthBounds,
  todayInTimeZone,
} from "../../src/util/date.js";
import { isUlid, ulid } from "../../src/util/id.js";
import { formatIdr, groupDigits } from "../../src/util/money.js";

describe("money", () => {
  it("groups thousands with dots, Indonesian style", () => {
    expect(groupDigits(50_000)).toBe("50.000");
    expect(groupDigits(1_234_567)).toBe("1.234.567");
    expect(groupDigits(999)).toBe("999");
    expect(groupDigits(1_000)).toBe("1.000");
    expect(groupDigits(0)).toBe("0");
  });

  it("formats rupiah with the sign outside the symbol", () => {
    expect(formatIdr(50_000)).toBe("Rp 50.000");
    expect(formatIdr(15_000_000)).toBe("Rp 15.000.000");
    expect(formatIdr(-2_500)).toBe("-Rp 2.500");
  });
});

describe("dates", () => {
  it("validates ISO dates including month lengths", () => {
    expect(isIsoDate("2026-09-13")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false); // 2026 is not a leap year
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("2026-9-3")).toBe(false);
    expect(isIsoDate("13/09/2026")).toBe(false);
  });

  it("counts days in a month", () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 9)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-09-13", 1)).toBe("2026-09-14");
    expect(addDays("2026-09-13", -1)).toBe("2026-09-12");
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
  });

  it("finds month bounds", () => {
    expect(monthBounds("2026-09-13")).toEqual({ start: "2026-09-01", end: "2026-09-30" });
    expect(monthBounds("2026-02-05")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(previousMonthBounds("2026-09-13")).toEqual({
      start: "2026-08-01",
      end: "2026-08-31",
    });
    // January must walk back into the previous year.
    expect(previousMonthBounds("2026-01-20")).toEqual({
      start: "2025-12-01",
      end: "2025-12-31",
    });
  });

  it("takes the timezone into account when deciding what day it is", () => {
    // 23:30 UTC is already the next day in Jakarta (UTC+7).
    const lateUtc = new Date("2026-09-13T23:30:00Z");
    expect(todayInTimeZone("Asia/Jakarta", lateUtc)).toBe("2026-09-14");
    expect(todayInTimeZone("UTC", lateUtc)).toBe("2026-09-13");
  });

  it("treats ranges as inclusive on both ends", () => {
    expect(isWithin("2026-09-01", "2026-09-01", "2026-09-30")).toBe(true);
    expect(isWithin("2026-09-30", "2026-09-01", "2026-09-30")).toBe(true);
    expect(isWithin("2026-08-31", "2026-09-01", "2026-09-30")).toBe(false);
  });

  it("derives a month key", () => {
    expect(monthKey("2026-09-13")).toBe("2026-09");
  });
});

describe("ulid", () => {
  it("produces 26 sortable characters", () => {
    const id = ulid();
    expect(id).toHaveLength(26);
    expect(isUlid(id)).toBe(true);
  });

  it("sorts lexicographically by creation time", () => {
    const earlier = ulid(1_700_000_000_000);
    const later = ulid(1_700_000_001_000);
    expect(earlier < later).toBe(true);
  });

  it("does not collide across many ids in the same millisecond", () => {
    const ids = new Set(Array.from({ length: 5_000 }, () => ulid(1_700_000_000_000)));
    expect(ids.size).toBe(5_000);
  });

  it("rejects anything that is not a ulid", () => {
    expect(isUlid("")).toBe(false);
    expect(isUlid("too-short")).toBe(false);
    // I, L, O and U are excluded from Crockford base32.
    expect(isUlid("IIIIIIIIIIIIIIIIIIIIIIIIII")).toBe(false);
    expect(isUlid("01JQ8Z9K7N0000000000000000")).toBe(true);
  });
});
