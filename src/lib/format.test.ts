import { describe, expect, it } from "vitest";
import {
  breakSeconds, dateOnly, decimalHours, formatClock, hoursLabel, initials, mondayOf, prettyDate, secondsBetween,
  timerElapsed, toCsv, weekdayLabel, weekDates,
} from "@/lib/format";

describe("formatClock", () => {
  it("formats zero as a zero clock", () => {
    expect(formatClock(0)).toBe("00:00:00");
  });

  it("formats hours, minutes, and seconds", () => {
    expect(formatClock(3661)).toBe("01:01:01");
    expect(formatClock(7200)).toBe("02:00:00");
  });

  it("clamps negative input", () => {
    expect(formatClock(-90)).toBe("00:00:00");
  });

  it("pads single digits", () => {
    expect(formatClock(65)).toBe("00:01:05");
  });
});

describe("hoursLabel", () => {
  it("renders whole hours without decimals", () => {
    expect(hoursLabel(3600)).toBe("1h");
    expect(hoursLabel(0)).toBe("0h");
  });

  it("renders one decimal for partial hours", () => {
    expect(hoursLabel(5400)).toBe("1.5h");
    expect(hoursLabel(3600 * 6 + 1800)).toBe("6.5h");
  });

  it("rounds to one decimal", () => {
    expect(hoursLabel(3600 * 1.04)).toBe("1h");
    expect(hoursLabel(3600 * 1.06)).toBe("1.1h");
  });
});

describe("decimalHours", () => {
  it("converts seconds to rounded decimal hours", () => {
    expect(decimalHours(5400)).toBe(1.5);
    expect(decimalHours(0)).toBe(0);
  });

  it("never returns negative values", () => {
    expect(decimalHours(-500)).toBe(0);
  });
});

describe("initials", () => {
  it("uses the first two name parts", () => {
    expect(initials("Maya Chen")).toBe("MC");
  });

  it("handles single word names and extra whitespace", () => {
    expect(initials("  Plato  ")).toBe("P");
    expect(initials("Ada  Lovelace Byron")).toBe("AL");
  });
});

describe("mondayOf and weekDates", () => {
  it("returns the Monday of a mid-week date", () => {
    expect(dateOnly(mondayOf(new Date("2024-01-05T15:00:00Z")))).toBe("2024-01-01");
  });

  it("treats Sunday as the end of the week, not the start", () => {
    expect(dateOnly(mondayOf(new Date("2024-01-07T15:00:00Z")))).toBe("2024-01-01");
  });

  it("normalizes time to midnight", () => {
    expect(mondayOf(new Date("2024-01-03T18:45:00Z")).toISOString()).toBe("2024-01-01T00:00:00.000Z");
  });

  it("produces seven sequential dates", () => {
    const days = weekDates(new Date("2024-01-01T00:00:00Z"));
    expect(days).toHaveLength(7);
    expect(days[0]).toBe("2024-01-01");
    expect(days[6]).toBe("2024-01-07");
  });
});

describe("date labels", () => {
  it("formats a short date", () => {
    expect(prettyDate("2024-02-09")).toBe("Feb 9");
  });

  it("falls back to a dash for missing values", () => {
    expect(prettyDate(null)).toBe("—");
    expect(prettyDate(undefined)).toBe("—");
  });

  it("falls back to a dash for unparseable values", () => {
    expect(prettyDate("not-a-date")).toBe("—");
    expect(weekdayLabel("also-bad")).toBe("—");
  });

  it("formats a weekday label", () => {
    expect(weekdayLabel("2024-01-05")).toBe("Fri");
  });
});

describe("secondsBetween", () => {
  it("measures elapsed seconds", () => {
    expect(secondsBetween("2024-01-01T00:00:00Z", "2024-01-01T00:01:00Z")).toBe(60);
  });

  it("never returns a negative duration", () => {
    expect(secondsBetween("2024-01-01T00:01:00Z", "2024-01-01T00:00:00Z")).toBe(0);
  });

  it("returns zero for invalid input", () => {
    expect(secondsBetween("bad", "2024-01-01T00:00:00Z")).toBe(0);
  });
});

describe("timerElapsed", () => {
  const startedAt = "2024-01-01T00:00:00Z";
  const oneHourLater = new Date("2024-01-01T01:00:00Z").getTime();

  it("adds live time to accumulated time while running", () => {
    expect(timerElapsed({ startedAt, state: "running", accumulatedSeconds: 60 }, oneHourLater)).toBe(3660);
  });

  it("returns only accumulated time while paused", () => {
    expect(timerElapsed({ startedAt, state: "paused", accumulatedSeconds: 120 }, oneHourLater)).toBe(120);
  });

  it("returns zero for a fresh timer at its start instant", () => {
    expect(timerElapsed({ startedAt, state: "running", accumulatedSeconds: 0 }, new Date(startedAt).getTime())).toBe(0);
  });
});

describe("breakSeconds", () => {
  it("sums closed breaks", () => {
    expect(breakSeconds([
      { startedAt: "2024-01-01T10:00:00Z", endedAt: "2024-01-01T10:15:00Z" },
    ])).toBe(900);
  });

  it("uses accumulated seconds for an open break", () => {
    expect(breakSeconds([{ startedAt: "2024-01-01T10:00:00Z", endedAt: null, accumulatedSeconds: 300 }])).toBe(300);
  });

  it("totals mixed records", () => {
    expect(breakSeconds([
      { startedAt: "2024-01-01T10:00:00Z", endedAt: "2024-01-01T10:10:00Z" },
      { startedAt: "2024-01-01T12:00:00Z", endedAt: null, accumulatedSeconds: 120 },
    ])).toBe(720);
  });
});

describe("toCsv", () => {
  it("joins cells and rows", () => {
    expect(toCsv([["a", "b"], ["c", "d"]])).toBe("a,b\nc,d");
  });

  it("renders null and undefined as empty cells", () => {
    expect(toCsv([["a", null, undefined, "d"]])).toBe("a,,,d");
  });

  it("quotes values containing separators", () => {
    expect(toCsv([["Chen, Maya"]])).toBe('"Chen, Maya"');
  });

  it("escapes embedded double quotes", () => {
    expect(toCsv([['He said "ok"']])).toBe('"He said ""ok"""');
  });

  it("wraps multiline values", () => {
    expect(toCsv([["line1\nline2"]])).toBe('"line1\nline2"');
  });

  it("leaves plain values unquoted", () => {
    expect(toCsv([["Atlas API", "ATL", "6.5"]])).toBe("Atlas API,ATL,6.5");
  });
});
