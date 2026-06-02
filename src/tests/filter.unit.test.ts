// Unit tests for filter.ts — applyFilters
// Validates: Requirements 11.5 (a, b, c, d)

import { describe, it, expect } from "vitest";
import { applyFilters } from "../content/filter";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    InvoiceDate: "2024-06-15",
    Status: "Approved",
    Name: "PT Contoh Maju",
    Amount: 1000000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Date range filter — Requirement 11.5 (a, d)
// ---------------------------------------------------------------------------

describe("applyFilters — date range", () => {
  it("passes rows whose InvoiceDate is within [dateFrom, dateTo] (inclusive)", () => {
    const rows = [
      row({ InvoiceDate: "2024-01-01" }),
      row({ InvoiceDate: "2024-06-15" }),
      row({ InvoiceDate: "2024-12-31" }),
    ];
    const result = applyFilters(rows, {
      dateFrom: "2024-01-01",
      dateTo: "2024-12-31",
    });
    expect(result).toHaveLength(3);
  });

  it("excludes rows whose InvoiceDate is before dateFrom", () => {
    const rows = [
      row({ InvoiceDate: "2023-12-31" }), // before
      row({ InvoiceDate: "2024-01-01" }), // on boundary — included
      row({ InvoiceDate: "2024-06-01" }), // after — included
    ];
    const result = applyFilters(rows, { dateFrom: "2024-01-01" });
    expect(result).toHaveLength(2);
    expect(result.map((r) => r["InvoiceDate"])).toEqual([
      "2024-01-01",
      "2024-06-01",
    ]);
  });

  it("excludes rows whose InvoiceDate is after dateTo", () => {
    const rows = [
      row({ InvoiceDate: "2024-06-01" }), // before — included
      row({ InvoiceDate: "2024-12-31" }), // on boundary — included
      row({ InvoiceDate: "2025-01-01" }), // after
    ];
    const result = applyFilters(rows, { dateTo: "2024-12-31" });
    expect(result).toHaveLength(2);
    expect(result.map((r) => r["InvoiceDate"])).toEqual([
      "2024-06-01",
      "2024-12-31",
    ]);
  });

  it("excludes rows with missing (undefined) InvoiceDate when a date bound is set", () => {
    const rows = [
      row({ InvoiceDate: "2024-06-15" }),
      row({ InvoiceDate: undefined }),
    ];
    const result = applyFilters(rows, { dateFrom: "2024-01-01" });
    expect(result).toHaveLength(1);
    expect(result[0]["InvoiceDate"]).toBe("2024-06-15");
  });

  it("excludes rows with null InvoiceDate when a date bound is set", () => {
    const rows = [
      row({ InvoiceDate: "2024-06-15" }),
      row({ InvoiceDate: null }),
    ];
    const result = applyFilters(rows, { dateTo: "2024-12-31" });
    expect(result).toHaveLength(1);
    expect(result[0]["InvoiceDate"]).toBe("2024-06-15");
  });

  it("excludes rows with an unparseable InvoiceDate when a date bound is set", () => {
    const rows = [
      row({ InvoiceDate: "2024-06-15" }),
      row({ InvoiceDate: "not-a-date" }),
    ];
    const result = applyFilters(rows, { dateFrom: "2024-01-01" });
    expect(result).toHaveLength(1);
    expect(result[0]["InvoiceDate"]).toBe("2024-06-15");
  });

  it("passes all rows (including those with missing InvoiceDate) when no date bounds are set", () => {
    const rows = [
      row({ InvoiceDate: "2024-06-15" }),
      row({ InvoiceDate: null }),
      row({ InvoiceDate: undefined }),
    ];
    const result = applyFilters(rows, {});
    expect(result).toHaveLength(3);
  });

  it("handles a single-day range (dateFrom === dateTo)", () => {
    const rows = [
      row({ InvoiceDate: "2024-06-14" }),
      row({ InvoiceDate: "2024-06-15" }),
      row({ InvoiceDate: "2024-06-16" }),
    ];
    const result = applyFilters(rows, {
      dateFrom: "2024-06-15",
      dateTo: "2024-06-15",
    });
    expect(result).toHaveLength(1);
    expect(result[0]["InvoiceDate"]).toBe("2024-06-15");
  });

  it("includes rows on dateTo even when InvoiceDate has a time component", () => {
    const rows = [
      row({ InvoiceDate: "2024-12-31T12:30:00" }),
      row({ InvoiceDate: "2025-01-01T00:00:00" }),
    ];
    const result = applyFilters(rows, { dateTo: "2024-12-31" });

    expect(result).toHaveLength(1);
    expect(result[0]["InvoiceDate"]).toBe("2024-12-31T12:30:00");
  });
});

// ---------------------------------------------------------------------------
// Status filter — Requirement 11.5 (b)
// ---------------------------------------------------------------------------

describe("applyFilters — status match", () => {
  it("keeps rows whose Status matches the option exactly (same case)", () => {
    const rows = [
      row({ Status: "Approved" }),
      row({ Status: "Rejected" }),
      row({ Status: "Pending" }),
    ];
    const result = applyFilters(rows, { status: "Approved" });
    expect(result).toHaveLength(1);
    expect(result[0]["Status"]).toBe("Approved");
  });

  it("performs case-insensitive matching for status", () => {
    const rows = [
      row({ Status: "APPROVED" }),
      row({ Status: "approved" }),
      row({ Status: "Approved" }),
      row({ Status: "Rejected" }),
    ];
    const result = applyFilters(rows, { status: "approved" });
    expect(result).toHaveLength(3);
  });

  it("excludes rows whose Status does not match", () => {
    const rows = [
      row({ Status: "Approved" }),
      row({ Status: "Rejected" }),
    ];
    const result = applyFilters(rows, { status: "Pending" });
    expect(result).toHaveLength(0);
  });

  it("treats missing Status field as empty string for matching", () => {
    const rows = [
      row({ Status: undefined }),
      row({ Status: "" }),
      row({ Status: "Approved" }),
    ];
    // Matching against empty string should return rows where Status is missing or ""
    const result = applyFilters(rows, { status: "" });
    expect(result).toHaveLength(2);
  });

  it("passes all rows when status option is absent", () => {
    const rows = [
      row({ Status: "Approved" }),
      row({ Status: "Rejected" }),
      row({ Status: "Pending" }),
    ];
    const result = applyFilters(rows, {});
    expect(result).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Keyword filter — Requirement 11.5 (c)
// ---------------------------------------------------------------------------

describe("applyFilters — keyword match", () => {
  it("keeps rows that contain the keyword in a string field", () => {
    const rows = [
      row({ Name: "PT Contoh Maju" }),
      row({ Name: "CV Lain Sekali" }),
    ];
    const result = applyFilters(rows, { keyword: "Contoh" });
    expect(result).toHaveLength(1);
    expect(result[0]["Name"]).toBe("PT Contoh Maju");
  });

  it("performs case-insensitive keyword matching", () => {
    const rows = [
      row({ Name: "PT CONTOH MAJU" }),
      row({ Name: "pt contoh maju" }),
      row({ Name: "Pt Contoh Maju" }),
      row({ Name: "CV Lain Sekali" }),
    ];
    const result = applyFilters(rows, { keyword: "contoh" });
    expect(result).toHaveLength(3);
  });

  it("matches keyword as a substring, not just a full-field match", () => {
    const rows = [
      row({ Name: "PT Contoh Maju Jaya" }),
      row({ Name: "CV Lain" }),
    ];
    const result = applyFilters(rows, { keyword: "Maju" });
    expect(result).toHaveLength(1);
  });

  it("searches across all string-typed fields", () => {
    const rows = [
      row({ Name: "CV Lain", Status: "Approved", Description: "invoice contoh" }),
      row({ Name: "CV Lain", Status: "Approved", Description: "no match here" }),
    ];
    const result = applyFilters(rows, { keyword: "contoh" });
    expect(result).toHaveLength(1);
    expect(result[0]["Description"]).toBe("invoice contoh");
  });

  it("does not match keyword against non-string fields", () => {
    const rows = [
      row({ Amount: 12345, Name: "no match" }),
    ];
    // "12345" is a number, not a string — should not match
    const result = applyFilters(rows, { keyword: "12345" });
    expect(result).toHaveLength(0);
  });

  it("excludes rows with no string fields containing the keyword", () => {
    const rows = [
      row({ Name: "PT Contoh" }),
      row({ Name: "CV Lain" }),
    ];
    const result = applyFilters(rows, { keyword: "xyz" });
    expect(result).toHaveLength(0);
  });

  it("passes all rows when keyword option is absent", () => {
    const rows = [
      row({ Name: "PT Contoh" }),
      row({ Name: "CV Lain" }),
    ];
    const result = applyFilters(rows, {});
    expect(result).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Empty options — Requirement 11.5 (a, b, c)
// ---------------------------------------------------------------------------

describe("applyFilters — empty options", () => {
  it("returns all rows unchanged when options is an empty object", () => {
    const rows = [
      row({ InvoiceDate: "2024-01-01", Status: "Approved", Name: "A" }),
      row({ InvoiceDate: null, Status: "Rejected", Name: "B" }),
      row({ InvoiceDate: undefined, Status: "Pending", Name: "C" }),
    ];
    const result = applyFilters(rows, {});
    expect(result).toHaveLength(3);
    // Preserve reference equality (no cloning)
    for (let i = 0; i < rows.length; i++) {
      expect(result[i]).toBe(rows[i]);
    }
  });

  it("returns an empty array when input data is empty", () => {
    const result = applyFilters([], { dateFrom: "2024-01-01", status: "Approved", keyword: "test" });
    expect(result).toHaveLength(0);
  });

  it("preserves original row order", () => {
    const rows = [
      row({ Name: "C" }),
      row({ Name: "A" }),
      row({ Name: "B" }),
    ];
    const result = applyFilters(rows, {});
    expect(result.map((r) => r["Name"])).toEqual(["C", "A", "B"]);
  });
});

// ---------------------------------------------------------------------------
// Combined filters
// ---------------------------------------------------------------------------

describe("applyFilters — combined filters", () => {
  it("applies date range and status filters together", () => {
    const rows = [
      row({ InvoiceDate: "2024-06-15", Status: "Approved" }),
      row({ InvoiceDate: "2024-06-15", Status: "Rejected" }),
      row({ InvoiceDate: "2023-01-01", Status: "Approved" }),
    ];
    const result = applyFilters(rows, {
      dateFrom: "2024-01-01",
      status: "Approved",
    });
    expect(result).toHaveLength(1);
    expect(result[0]["Status"]).toBe("Approved");
    expect(result[0]["InvoiceDate"]).toBe("2024-06-15");
  });

  it("applies status and keyword filters together", () => {
    const rows = [
      row({ Status: "Approved", Name: "PT Contoh" }),
      row({ Status: "Approved", Name: "CV Lain" }),
      row({ Status: "Rejected", Name: "PT Contoh" }),
    ];
    const result = applyFilters(rows, { status: "Approved", keyword: "Contoh" });
    expect(result).toHaveLength(1);
    expect(result[0]["Status"]).toBe("Approved");
    expect(result[0]["Name"]).toBe("PT Contoh");
  });

  it("applies all three filters together", () => {
    const rows = [
      row({ InvoiceDate: "2024-06-15", Status: "Approved", Name: "PT Contoh" }),
      row({ InvoiceDate: "2024-06-15", Status: "Rejected", Name: "PT Contoh" }),
      row({ InvoiceDate: "2023-01-01", Status: "Approved", Name: "PT Contoh" }),
      row({ InvoiceDate: "2024-06-15", Status: "Approved", Name: "CV Lain" }),
    ];
    const result = applyFilters(rows, {
      dateFrom: "2024-01-01",
      status: "Approved",
      keyword: "Contoh",
    });
    expect(result).toHaveLength(1);
    expect(result[0]["InvoiceDate"]).toBe("2024-06-15");
    expect(result[0]["Status"]).toBe("Approved");
    expect(result[0]["Name"]).toBe("PT Contoh");
  });
});
