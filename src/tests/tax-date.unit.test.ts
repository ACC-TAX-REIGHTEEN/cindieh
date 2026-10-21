// Unit tests for tax-date.ts — masa pajak period & date parsing.
// Covers extractYear, extractMonth (including the TD. tax-domain form),
// extractYMD, and the timezone-safe formatDate.
import { describe, it, expect } from "vitest";
import {
  extractPeriods,
  extractYear,
  extractMonth,
  extractMasaPajak,
  extractYMD,
  formatPeriod,
  formatDate,
  formatIsoDateTime,
  getCurrentYearMonthWIB,
  periodMonthName,
} from "../content/tax-date";

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

// ── extractMasaPajak ──────────────────────────────────────────────────────────

describe("periodMonthName", () => {
  it("names the month a portal period code stands for", () => {
    // The badge shows the month in words; the portal's own code is what the
    // request carries, not what a person reads.
    expect(periodMonthName("TD.00701")).toBe("Januari");
    expect(periodMonthName("TD.00703")).toBe("Maret");
    expect(periodMonthName("TD00711")).toBe("November");
    expect(periodMonthName("TD.00712")).toBe("Desember");
  });

  it("returns a value that names no month unchanged", () => {
    // A month the portal spelled out, a bare year, an unreadable value: the
    // line must not invent a month it could not read.
    expect(periodMonthName("Agustus")).toBe("Agustus");
    expect(periodMonthName("2026")).toBe("2026");
    expect(periodMonthName("")).toBe("");
    expect(periodMonthName("TD.007")).toBe("TD.007");
  });
});

describe("extractMasaPajak", () => {
  it("extracts an MM/YYYY period from free text", () => {
    expect(extractMasaPajak("Periode Masa Pajak 04/2026")).toBe("04/2026");
    expect(extractMasaPajak("Masa Pajak: 07/2026")).toBe("07/2026");
  });

  it("extracts an MM-YYYY period from free text", () => {
    expect(extractMasaPajak("Masa Pajak 04-2026")).toBe("04-2026");
    expect(extractMasaPajak("Periode 12-2026 (Desember)")).toBe("12-2026");
  });

  it("returns the first MM/YYYY or MM-YYYY match", () => {
    expect(extractMasaPajak("Dari 01/2026 sampai 04/2026")).toBe("01/2026");
  });

  it("returns empty string for missing or invalid input", () => {
    expect(extractMasaPajak("")).toBe("");
    expect(extractMasaPajak("Masa Pajak belum diisi")).toBe("");
    expect(extractMasaPajak("2026")).toBe("");
    expect(extractMasaPajak("Tahun 2026 bulan 4")).toBe("");
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

// ── formatIsoDateTime ────────────────────────────────────────────────────────

describe("formatIsoDateTime", () => {
  it("reformats an ISO datetime to DD/MM/YYYY", () => {
    expect(formatIsoDateTime("2026-01-31T23:00:00+07:00")).toBe("31/01/2026");
    expect(formatIsoDateTime("2026-04-15T00:00:00Z")).toBe("15/04/2026");
  });

  it("leaves a pure calendar date alone", () => {
    // The whole difference between this and formatDate: "2026-03-04" is a value
    // whose column already says what it is, and rewriting it would be wrong.
    expect(formatIsoDateTime("2026-03-04")).toBe("2026-03-04");
    expect(formatDate("2026-03-04")).toBe("04/03/2026");
  });

  it("leaves values that are not strings untouched, type and all", () => {
    const zero = 0;
    expect(formatIsoDateTime(zero)).toBe(0);
    expect(formatIsoDateTime(null)).toBeNull();
    expect(formatIsoDateTime(undefined)).toBeUndefined();
  });

  it("leaves other strings untouched", () => {
    expect(formatIsoDateTime("")).toBe("");
    expect(formatIsoDateTime("not-a-date")).toBe("not-a-date");
    expect(formatIsoDateTime("PT Maju Jaya")).toBe("PT Maju Jaya");
  });

  it("requires the time component, not merely a T somewhere in the string", () => {
    expect(formatIsoDateTime("PT Maju")).toBe("PT Maju");
    expect(formatIsoDateTime("2026-01-01 PT")).toBe("2026-01-01 PT");
  });
});

// ── getCurrentYearMonthWIB ───────────────────────────────────────────────────

describe("getCurrentYearMonthWIB", () => {
  it("returns year and month formatted for Asia/Jakarta timezone", () => {
    const fixedDate = new Date("2026-08-14T20:00:00Z"); // 2026-08-15 03:00 WIB
    const res = getCurrentYearMonthWIB(fixedDate);
    expect(res.year).toBe("2026");
    expect(res.month).toBe("08");
  });

  it("handles day crossover into next day in WIB", () => {
    const nearMidnightUTC = new Date("2026-04-30T18:00:00Z"); // 2026-05-01 01:00 WIB
    const res = getCurrentYearMonthWIB(nearMidnightUTC);
    expect(res.year).toBe("2026");
    expect(res.month).toBe("05");
  });
});

// ── formatPeriod ────────────────────────────────────────────────────────────────────────────
// The filename label. These shapes were pinned by the exporter's filename
// suite before the ladder moved here; they are pinned again, against its own
// interface, so a new portal period shape is taught once.

describe("formatPeriod", () => {
  it("renders the internal YYYY_MM as MMYYYY", () => {
    expect(formatPeriod("2026_04")).toBe("042026");
  });

  it("renders a YYYYMM value — or anything ending in one — as MMYYYY", () => {
    expect(formatPeriod("202604")).toBe("042026");
    expect(formatPeriod("TD007-2026-04")).toBe("042026");
    expect(formatPeriod("04/2026")).toBe("042026");
  });

  it("keeps a value that is already MMYYYY, and a bare year", () => {
    expect(formatPeriod("042026")).toBe("042026");
    expect(formatPeriod("2025")).toBe("2025");
  });

  it("keeps the alphanumeric value when it is not a period at all", () => {
    // An article code on a PPh 21 lampiran is not a date: the filename rule
    // recognises it by shape (looseHint), so it must survive with its
    // punctuation dropped rather than being turned into a period.
    expect(formatPeriod("L1A-ART21")).toBe("L1AART21");
    expect(formatPeriod("TD.00704")).toBe("TD00704");
    expect(formatPeriod(undefined)).toBe("");
  });

  it("falls through when the month is impossible", () => {
    // 13 is not a month, so neither the YYYYMM nor the MMYYYY reading applies.
    expect(formatPeriod("202613")).toBe("202613");
  });
});

// ── extractPeriods ────────────────────────────────────────────────────────────────────────────

describe("extractPeriods", () => {
  it("reads the dedicated year and month fields first", () => {
    const rows = [{ TaxInvoiceYear: "2026", TaxInvoicePeriod: "4" }];
    expect(extractPeriods(rows, [])).toEqual(["2026_04"]);
  });

  it("falls back to a consolidated TaxPeriod", () => {
    expect(extractPeriods([{ TaxPeriod: "TD007-2026-04" }], [])).toEqual(["2026_04"]);
    expect(extractPeriods([{ TaxPeriod: "202607" }], [])).toEqual(["2026_07"]);
  });

  it("falls back to the caller's own date columns, in their order", () => {
    const rows = [{ DocumentDate: "2026-03-05T00:00:00+07:00" }];
    expect(extractPeriods(rows, ["TaxInvoiceDate", "DocumentDate"])).toEqual(["2026_03"]);
  });

  it("collects each masa once, sorted", () => {
    const rows = [
      { TaxInvoiceYear: "2026", TaxInvoicePeriod: "7" },
      { TaxInvoiceYear: "2026", TaxInvoicePeriod: "4" },
      { TaxInvoiceYear: "2026", TaxInvoicePeriod: "7" },
    ];
    expect(extractPeriods(rows, [])).toEqual(["2026_04", "2026_07"]);
  });

  it("ignores rows that carry no readable period, and no rows at all", () => {
    expect(extractPeriods([{ TaxInvoiceNumber: "04012600023333322" }], [])).toEqual([]);
    expect(extractPeriods(undefined, [])).toEqual([]);
    expect(extractPeriods([], [])).toEqual([]);
  });
});
