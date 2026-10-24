import { describe, expect, it } from "vitest";

import { addDays, isDate, isTimeZone, localDate, localDayRange, systemTimeZone } from "../../src/desk/ui/localday.ts";

const H = 3_600_000;

describe("days in the owner's zone", () => {
  it("names the calendar date an instant falls on in a zone", () => {
    const t = Date.parse("2026-10-24T20:00:00Z");
    expect(localDate(t, "UTC")).toBe("2026-10-24");
    expect(localDate(t, "Asia/Kolkata")).toBe("2026-10-25"); // UTC+5:30: 01:30 the next morning
    expect(localDate(t, "America/Los_Angeles")).toBe("2026-10-24"); // UTC-7
    expect(localDate(t, "Pacific/Kiritimati")).toBe("2026-10-25"); // UTC+14
    expect(localDate(Date.parse("2026-01-01T00:00:00Z"), "America/New_York")).toBe("2025-12-31");
  });

  it("gives a day as a half-open window, and the next day starts exactly where it ends", () => {
    const utc = localDayRange("2026-10-25", "UTC");
    expect(new Date(utc.startMs).toISOString()).toBe("2026-10-25T00:00:00.000Z");
    expect(utc.endMs).toBe(utc.startMs + 24 * H);
    const ist = localDayRange("2026-10-25", "Asia/Kolkata");
    expect(new Date(ist.startMs).toISOString()).toBe("2026-10-24T18:30:00.000Z");
    expect(new Date(ist.endMs).toISOString()).toBe("2026-10-25T18:30:00.000Z");
    expect(localDayRange("2026-10-26", "Asia/Kolkata").startMs).toBe(ist.endMs);
  });

  it("knows a day can be 23 or 25 hours long where the clocks change", () => {
    const spring = localDayRange("2026-03-08", "America/Los_Angeles"); // clocks go forward at 02:00
    expect((spring.endMs - spring.startMs) / H).toBe(23);
    const autumn = localDayRange("2026-11-01", "America/Los_Angeles"); // clocks go back at 02:00
    expect((autumn.endMs - autumn.startMs) / H).toBe(25);
    expect(new Date(autumn.startMs).toISOString()).toBe("2026-11-01T07:00:00.000Z"); // still summer time at midnight
    expect(new Date(autumn.endMs).toISOString()).toBe("2026-11-02T08:00:00.000Z");
    const ordinary = localDayRange("2026-10-25", "America/Los_Angeles");
    expect((ordinary.endMs - ordinary.startMs) / H).toBe(24);
  });

  it("agrees with itself: every instant of a day maps back to that date, and the instant before it to the day before", () => {
    for (const tz of ["UTC", "Asia/Kolkata", "America/Los_Angeles", "Australia/Lord_Howe", "Pacific/Kiritimati", "Europe/London"]) {
      for (const date of ["2026-03-08", "2026-03-29", "2026-10-25", "2026-11-01", "2026-12-31"]) {
        const r = localDayRange(date, tz);
        expect(localDate(r.startMs, tz)).toBe(date);
        expect(localDate(r.endMs - 1, tz)).toBe(date);
        expect(localDate(r.startMs - 1, tz)).toBe(addDays(date, -1));
        expect(localDate(r.endMs, tz)).toBe(addDays(date, 1));
      }
    }
  });

  it("adds days as pure dates across month, year and leap boundaries", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01");
  });

  it("recognises real dates and real zones only", () => {
    expect(isDate("2026-10-24")).toBe(true);
    for (const bad of ["2026-02-30", "2026-13-01", "24-10-2026", "2026-1-1", "", "2026-10-24T00:00:00Z"]) expect(isDate(bad)).toBe(false);
    expect(isTimeZone("Asia/Kolkata")).toBe(true);
    expect(isTimeZone("Mars/Olympus")).toBe(false);
    expect(isTimeZone(systemTimeZone())).toBe(true);
  });
});
