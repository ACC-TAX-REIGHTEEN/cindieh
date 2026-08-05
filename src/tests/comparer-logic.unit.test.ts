// Unit tests for comparer-logic.ts
// Tests computePagination, applyStatusFilter, buildStatusSummary,
// formatStatusSummary, parseDailyDates, and getStatusLabel.
import { describe, it, expect } from "vitest";
import {
  computePagination,
  applyStatusFilter,
  buildStatusSummary,
  formatStatusSummary,
  parseDailyDates,
  getStatusLabel,
  createComparerSession,
} from "../content/comparer-logic";
import type { ComparisonResult, ComparisonStatus } from "../content/comparer";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeResult(ref: string, status: ComparisonStatus): ComparisonResult {
  return {
    reference: ref,
    refLain: "",
    buyerName: "",
    invoiceDate: "",
    buyerTIN: "",
    taxInvoiceNumber: "",
    dppSistem: null,
    dppExcel: null,
    ppnSistem: null,
    ppnExcel: null,
    ppnSelisih: null,
    status,
  };
}

const RESULTS: ComparisonResult[] = [
  makeResult("REF-001", "COCOK"),
  makeResult("REF-002", "COCOK"),
  makeResult("REF-003", "DPP_BERBEDA"),
  makeResult("REF-004", "PPN_BERBEDA"),
  makeResult("REF-005", "BERBEDA"),
  makeResult("REF-006", "TIDAK_DITEMUKAN"),
  makeResult("REF-007", "HANYA_CORETAX"),
];

// ── createComparerSession ─────────────────────────────────────────────────────

describe("createComparerSession", () => {
  it("creates a session with sensible defaults", () => {
    const s = createComparerSession();
    expect(s.results).toEqual([]);
    expect(s.currentPage).toBe(1);
    expect(s.tolerance).toBe(0);
    expect(s.statusFilter).toEqual([]);
    expect(s.dailyEnabled).toBe(true);
    expect(s.dailyDates).toEqual([]);
    expect(s.refLainEnabled).toBe(true);
  });

  it("two calls produce independent objects", () => {
    const a = createComparerSession();
    const b = createComparerSession();
    a.currentPage = 5;
    expect(b.currentPage).toBe(1);
  });
});

// ── computePagination ─────────────────────────────────────────────────────────

describe("computePagination", () => {
  const ITEMS = Array.from({ length: 25 }, (_, i) => makeResult(`R-${i}`, "COCOK"));
  const PAGE_SIZE = 10;

  it("returns totalPages = 3 for 25 items and page size 10", () => {
    const { totalPages } = computePagination(ITEMS, PAGE_SIZE, 1);
    expect(totalPages).toBe(3);
  });

  it("returns the first 10 items on page 1", () => {
    const { pageRows, startIndex } = computePagination(ITEMS, PAGE_SIZE, 1);
    expect(startIndex).toBe(0);
    expect(pageRows).toHaveLength(10);
    expect(pageRows[0].reference).toBe("R-0");
  });

  it("returns items 10-19 on page 2", () => {
    const { pageRows, startIndex } = computePagination(ITEMS, PAGE_SIZE, 2);
    expect(startIndex).toBe(10);
    expect(pageRows).toHaveLength(10);
    expect(pageRows[0].reference).toBe("R-10");
  });

  it("returns remaining 5 items on page 3 (last page)", () => {
    const { pageRows } = computePagination(ITEMS, PAGE_SIZE, 3);
    expect(pageRows).toHaveLength(5);
    expect(pageRows[0].reference).toBe("R-20");
  });

  it("clamps currentPage to totalPages when out of range (too high)", () => {
    const { currentPage, totalPages } = computePagination(ITEMS, PAGE_SIZE, 99);
    expect(currentPage).toBe(totalPages);
  });

  it("clamps currentPage to 1 when out of range (zero or negative)", () => {
    expect(computePagination(ITEMS, PAGE_SIZE, 0).currentPage).toBe(1);
    expect(computePagination(ITEMS, PAGE_SIZE, -5).currentPage).toBe(1);
  });

  it("returns totalPages = 1 and empty pageRows for an empty result set", () => {
    const { totalPages, pageRows } = computePagination([], PAGE_SIZE, 1);
    expect(totalPages).toBe(1);
    expect(pageRows).toHaveLength(0);
  });

  it("returns totalPages = 1 for exactly 1 item", () => {
    const { totalPages } = computePagination([ITEMS[0]], PAGE_SIZE, 1);
    expect(totalPages).toBe(1);
  });

  it("returns totalPages = 1 for exactly PAGE_SIZE items", () => {
    const { totalPages } = computePagination(ITEMS.slice(0, PAGE_SIZE), PAGE_SIZE, 1);
    expect(totalPages).toBe(1);
  });

  it("startIndex is always (currentPage - 1) * pageSize", () => {
    for (let p = 1; p <= 3; p++) {
      const { startIndex } = computePagination(ITEMS, PAGE_SIZE, p);
      expect(startIndex).toBe((p - 1) * PAGE_SIZE);
    }
  });
});

// ── applyStatusFilter ─────────────────────────────────────────────────────────

describe("applyStatusFilter", () => {
  it("returns all results when filter is empty", () => {
    const filtered = applyStatusFilter(RESULTS, []);
    expect(filtered).toBe(RESULTS); // identity — no copy needed
  });

  it("filters to only COCOK status", () => {
    const filtered = applyStatusFilter(RESULTS, ["COCOK"]);
    expect(filtered.every((r) => r.status === "COCOK")).toBe(true);
    expect(filtered).toHaveLength(2);
  });

  it("filters to multiple statuses (COCOK + BERBEDA)", () => {
    const filtered = applyStatusFilter(RESULTS, ["COCOK", "BERBEDA"]);
    const statuses = new Set(filtered.map((r) => r.status));
    expect(statuses.has("COCOK")).toBe(true);
    expect(statuses.has("BERBEDA")).toBe(true);
    expect(statuses.has("DPP_BERBEDA")).toBe(false);
    expect(filtered).toHaveLength(3);
  });

  it("returns empty array when filter matches nothing", () => {
    const filtered = applyStatusFilter(
      [makeResult("X", "COCOK")],
      ["TIDAK_DITEMUKAN"],
    );
    expect(filtered).toHaveLength(0);
  });

  it("filters to HANYA_CORETAX", () => {
    const filtered = applyStatusFilter(RESULTS, ["HANYA_CORETAX"]);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].reference).toBe("REF-007");
  });

  it("filters to TIDAK_DITEMUKAN", () => {
    const filtered = applyStatusFilter(RESULTS, ["TIDAK_DITEMUKAN"]);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].reference).toBe("REF-006");
  });
});

// ── buildStatusSummary ────────────────────────────────────────────────────────

describe("buildStatusSummary", () => {
  it("counts all status categories correctly", () => {
    const summary = buildStatusSummary(RESULTS);
    expect(summary.total).toBe(7);
    expect(summary.cocok).toBe(2);
    expect(summary.berbeda).toBe(3); // DPP_BERBEDA + PPN_BERBEDA + BERBEDA
    expect(summary.tidakDitemukan).toBe(1);
    expect(summary.hanyaCoretax).toBe(1);
  });

  it("returns zeroes for an empty result set", () => {
    const summary = buildStatusSummary([]);
    expect(summary.total).toBe(0);
    expect(summary.cocok).toBe(0);
    expect(summary.berbeda).toBe(0);
    expect(summary.tidakDitemukan).toBe(0);
    expect(summary.hanyaCoretax).toBe(0);
  });

  it("counts DPP_BERBEDA in the berbeda bucket", () => {
    const results = [makeResult("A", "DPP_BERBEDA")];
    expect(buildStatusSummary(results).berbeda).toBe(1);
  });

  it("counts PPN_BERBEDA in the berbeda bucket", () => {
    const results = [makeResult("A", "PPN_BERBEDA")];
    expect(buildStatusSummary(results).berbeda).toBe(1);
  });

  it("counts BERBEDA in the berbeda bucket", () => {
    const results = [makeResult("A", "BERBEDA")];
    expect(buildStatusSummary(results).berbeda).toBe(1);
  });
});

// ── formatStatusSummary ───────────────────────────────────────────────────────

describe("formatStatusSummary", () => {
  it("formats a typical summary without hanyaCoretax", () => {
    const text = formatStatusSummary({ total: 10, cocok: 7, berbeda: 2, tidakDitemukan: 1, hanyaCoretax: 0 });
    expect(text).toBe("10 data diperiksa: 7 cocok, 2 berbeda, 1 tidak ditemukan.");
  });

  it("appends hanyaCoretax count when non-zero", () => {
    const text = formatStatusSummary({ total: 12, cocok: 8, berbeda: 2, tidakDitemukan: 1, hanyaCoretax: 1 });
    expect(text).toBe("12 data diperiksa: 8 cocok, 2 berbeda, 1 tidak ditemukan, 1 hanya di coretax.");
  });

  it("ends with a period", () => {
    const text = formatStatusSummary({ total: 0, cocok: 0, berbeda: 0, tidakDitemukan: 0, hanyaCoretax: 0 });
    expect(text.endsWith(".")).toBe(true);
  });

  it("does not mention hanya di coretax when hanyaCoretax is 0", () => {
    const text = formatStatusSummary({ total: 5, cocok: 5, berbeda: 0, tidakDitemukan: 0, hanyaCoretax: 0 });
    expect(text).not.toContain("coretax");
  });
});

// ── parseDailyDates ───────────────────────────────────────────────────────────

describe("parseDailyDates", () => {
  it("parses comma-separated dates", () => {
    expect(parseDailyDates("1,15,31")).toEqual([1, 15, 31]);
  });

  it("parses space-separated dates", () => {
    expect(parseDailyDates("1 15 31")).toEqual([1, 15, 31]);
  });

  it("parses semicolon-separated dates", () => {
    expect(parseDailyDates("1;15;31")).toEqual([1, 15, 31]);
  });

  it("parses mixed separators", () => {
    expect(parseDailyDates("1, 15; 31")).toEqual([1, 15, 31]);
  });

  it("drops values outside 1-31", () => {
    expect(parseDailyDates("0, 1, 31, 32, 100")).toEqual([1, 31]);
  });

  it("drops non-numeric values", () => {
    expect(parseDailyDates("1, abc, 15")).toEqual([1, 15]);
  });

  it("returns empty array for empty string", () => {
    expect(parseDailyDates("")).toEqual([]);
  });

  it("returns empty array for whitespace-only string", () => {
    expect(parseDailyDates("   ")).toEqual([]);
  });

  it("handles single value", () => {
    expect(parseDailyDates("7")).toEqual([7]);
  });

  it("preserves duplicate values (caller responsible for deduplication)", () => {
    const result = parseDailyDates("5,5,5");
    expect(result).toEqual([5, 5, 5]);
  });

  it("accepts all boundary values 1 and 31", () => {
    expect(parseDailyDates("1")).toEqual([1]);
    expect(parseDailyDates("31")).toEqual([31]);
  });
});

// ── getStatusLabel ────────────────────────────────────────────────────────────

describe("getStatusLabel", () => {
  const cases: Array<[ComparisonStatus, string]> = [
    ["COCOK", "Cocok"],
    ["DPP_BERBEDA", "DPP Berbeda"],
    ["PPN_BERBEDA", "PPN Berbeda"],
    ["BERBEDA", "Berbeda"],
    ["TIDAK_DITEMUKAN", "Tidak ditemukan"],
    ["HANYA_CORETAX", "Hanya di Coretax"],
  ];

  for (const [status, expectedLabel] of cases) {
    it(`maps ${status} → "${expectedLabel}"`, () => {
      expect(getStatusLabel(status)).toBe(expectedLabel);
    });
  }

  it("covers all 6 ComparisonStatus values", () => {
    // Ensures no status is accidentally unhandled by the switch
    const allStatuses: ComparisonStatus[] = [
      "COCOK", "DPP_BERBEDA", "PPN_BERBEDA", "BERBEDA",
      "TIDAK_DITEMUKAN", "HANYA_CORETAX",
    ];
    for (const s of allStatuses) {
      expect(() => getStatusLabel(s)).not.toThrow();
      expect(typeof getStatusLabel(s)).toBe("string");
    }
  });
});
