// Unit tests for tax-date.ts — masa pajak period & date parsing.
// Covers extractYear, extractMonth (including the TD. tax-domain form),
// extractYMD, and the timezone-safe formatDate.
import { describe, it, expect } from "vitest";
import { extractYear, extractMonth, extractYMD, formatDate } from "../content/tax-date";

// ── extractYear ───────────────────────────────────────────────────────────────

describe("extractYear", () => {
  it("extracts a 4-digit year from a raw period", () => {
    expect(extractYear("TD007-2026-04")).toBe("2026");
    expect(extractYear("2026-07")).toBe("2026");
    expect(extractYear("07/2026")).toBe("2026");
  });

  it("returns empty string for missing or invalid input", () => {
    expect(extractYear("")).toBe("");
    expect(extractYear(null)).toBe("");
    expect(extractYear("abc")).toBe("");
    expect(extractYear("99")).toBe("");
  });

  it("supports 19xx years", () => {
    expect(extractYear("1999-01")).toBe("1999");
  });
});

// ── extractMonth ──────────────────────────────────────────────────────────────

describe("extractMonth", () => {
  it("parses the TD. tax-domain period form", () => {
    expect(extractMonth("TD00704")).toBe("04");
    expect(extractMonth("TD.00711")).toBe("11");
    expect(extractMonth("td00704")).toBe("04");
  });

  it("parses a YYYYMM suffix", () => {
    expect(extractMonth("TD007-2026-04")).toBe("04");
    expect(extractMonth("2026-07")).toBe("07");
  });

  it("parses an MMYYYY suffix", () => {
    expect(extractMonth("07-2026")).toBe("07");
  });

  it("parses a bare month and pads it", () => {
    expect(extractMonth("04")).toBe("04");
    expect(extractMonth("4")).toBe("04");
  });

  it("returns empty string for missing or invalid input", () => {
    expect(extractMonth("")).toBe("");
    expect(extractMonth(null)).toBe("");
    expect(extractMonth("abc")).toBe("");
    expect(extractMonth("13")).toBe("");
    expect(extractMonth("2026")).toBe("");
  });
});

// ── extractYMD ────────────────────────────────────────────────────────────────

describe("extractYMD", () => {
  it("extracts the Y-M-D prefix from a pure date", () => {
    expect(extractYMD("2026-07-01")).toEqual({ year: "2026", month: "07", day: "01" });
  });

  it("extracts the Y-M-D prefix from an ISO datetime", () => {
    expect(extractYMD("2026-07-01T00:00:00+07:00")).toEqual({
      year: "2026",
      month: "07",
      day: "01",
    });
    expect(extractYMD("2026-12-25T09:00:00Z")).toEqual({
      year: "2026",
      month: "12",
      day: "25",
    });
  });

  it("returns null when there is no date prefix", () => {
    expect(extractYMD(null)).toBeNull();
    expect(extractYMD(undefined)).toBeNull();
    expect(extractYMD("")).toBeNull();
    expect(extractYMD("not-a-date")).toBeNull();
    expect(extractYMD(12345)).toBeNull();
  });
});

// ── formatDate — timezone handling across multiple offsets ───────────────────

describe("formatDate", () => {
  it("formats pure dates as DD/MM/YYYY", () => {
    expect(formatDate("2026-04-15")).toBe("15/04/2026");
    expect(formatDate("2025-01-01")).toBe("01/01/2025");
    expect(formatDate("2025-12-31")).toBe("31/12/2025");
  });

  it("keeps the offset's calendar date for +07:00 (near-midnight safety)", () => {
    expect(formatDate("2026-01-31T23:00:00+07:00")).toBe("31/01/2026");
    expect(formatDate("2026-03-01T00:30:00+07:00")).toBe("01/03/2026");
  });

  it("keeps the offset's calendar date for +08:00", () => {
    expect(formatDate("2026-06-15T10:00:00+08:00")).toBe("15/06/2026");
    expect(formatDate("2026-07-01T00:15:00+08:00")).toBe("01/07/2026");
  });

  it("keeps the offset's calendar date for +09:00", () => {
    expect(formatDate("2026-12-25T09:00:00+09:00")).toBe("25/12/2026");
    expect(formatDate("2026-04-01T00:05:00+09:00")).toBe("01/04/2026");
  });

  it("keeps the calendar date for Z (UTC)", () => {
    expect(formatDate("2026-08-20T12:00:00Z")).toBe("20/08/2026");
    expect(formatDate("2026-11-01T00:00:00Z")).toBe("01/11/2026");
  });

  it("keeps the calendar date for a negative offset", () => {
    expect(formatDate("2026-09-10T20:00:00-05:00")).toBe("10/09/2026");
  });

  it("handles empty and null input", () => {
    expect(formatDate(null)).toBe("");
    expect(formatDate(undefined)).toBe("");
    expect(formatDate("")).toBe("");
  });

  it("passes through unparseable strings", () => {
    expect(formatDate("not-a-date")).toBe("not-a-date");
  });
});
