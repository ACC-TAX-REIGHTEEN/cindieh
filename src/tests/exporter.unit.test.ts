// Unit tests for exporter.ts — generateDynamicFilename and escapeCSV
// Validates: Requirements 6.5, 6.6, 12.2, 12.3
import { describe, it, expect } from "vitest";
import type { ExportSource } from "../content/page-context";
import { escapeCSV, buildCSV, formatDate, generateDynamicFilename, PREFIX_MAP } from "../content/exporter";
import type { ExportData } from "../content/exporter";

// ============================================================
// buildCSV
// ============================================================
describe("buildCSV", () => {
	it("prepends a UTF-8 BOM", () => {
		expect(buildCSV([["a"]])).toMatch(/^\uFEFF/);
	});

	it("joins cells with commas and rows with newlines", () => {
		expect(buildCSV([["a", "b"], ["c", "d"]])).toBe("\uFEFFa,b\nc,d\n");
	});

	it("escapes cells that need quoting", () => {
		expect(buildCSV([["hello, world", 'say "hi"']])).toBe('\uFEFF"hello, world","say ""hi"""\n');
	});

	it("handles an empty row list", () => {
		expect(buildCSV([])).toBe("\uFEFF");
	});
});

// ============================================================
// escapeCSV
// ============================================================
describe("escapeCSV", () => {
	it("returns a plain string unchanged", () => {
		expect(escapeCSV("hello")).toBe("hello");
	});

	it("returns an empty string for null", () => {
		expect(escapeCSV(null)).toBe("");
	});

	it("returns an empty string for undefined", () => {
		expect(escapeCSV(undefined)).toBe("");
	});

	it("wraps a value containing a comma in double-quotes", () => {
		expect(escapeCSV("hello, world")).toBe('"hello, world"');
	});

	it("wraps a value containing a double-quote in double-quotes and escapes the inner quote", () => {
		expect(escapeCSV('say "hi"')).toBe('"say ""hi"""');
	});

	it("wraps a value containing a newline in double-quotes", () => {
		expect(escapeCSV("line1\nline2")).toBe('"line1\nline2"');
	});

	it("handles a value that contains both a comma and a double-quote", () => {
		expect(escapeCSV('a, "b"')).toBe('"a, ""b"""');
	});

	it("converts a number to its string representation", () => {
		expect(escapeCSV(42)).toBe("42");
	});

	it("converts a boolean to its string representation", () => {
		expect(escapeCSV(true)).toBe("true");
	});

	it("returns an empty string for an empty string input", () => {
		expect(escapeCSV("")).toBe("");
	});
});

// ============================================================
// generateDynamicFilename — prefix correctness for all 11 ExportSource values
// ============================================================
describe("generateDynamicFilename — prefix for each ExportSource", () => {
	const allSources: ExportSource[] = [
		"OUTPUT_TAX",
		"INPUT_TAX",
		"OUTPUT_RETURN",
		"INPUT_RETURN",
		"SPT_A2",
		"SPT_B2",
		"PPH_21_L1A",
		"PPH_21_L1B",
		"PPH_21_L2",
		"PPH_21_L3",
		"WITHHOLDING_SLIPS",
	];

	const expectedPrefixes: Record<ExportSource, string> = {
		OUTPUT_TAX:        "FPK-",
		INPUT_TAX:         "FPM-",
		OUTPUT_RETURN:     "RET-FPK-",
		INPUT_RETURN:      "RET-FPM-",
		SPT_A2:            "A2-",
		SPT_B2:            "B2-",
		PPH_21_L1A:        "PPH21-L1A-",
		PPH_21_L1B:        "PPH21-L1B-",
		PPH_21_L2:         "PPH21-L2-",
		PPH_21_L3:         "PPH21-L3-",
		WITHHOLDING_SLIPS: "BP-",
	};

	for (const source of allSources) {
		it(`uses prefix "${expectedPrefixes[source]}" for source "${source}"`, () => {
			const exportData: ExportData = { data: [], fields: [], source };
			const filename = generateDynamicFilename(exportData);
			expect(filename.startsWith(expectedPrefixes[source])).toBe(true);
		});
	}

	it("falls back to FPK- prefix when source is undefined", () => {
		const exportData: ExportData = { data: [], fields: [], source: undefined };
		const filename = generateDynamicFilename(exportData);
		expect(filename.startsWith("FPK-")).toBe(true);
	});
});

// ============================================================
// generateDynamicFilename — filenameHint handling
// ============================================================
describe("generateDynamicFilename — filenameHint formats", () => {
	it("uses YYYYMM hint to produce MMYYYY suffix (e.g. 202604 → 042026)", () => {
		const exportData: ExportData = {
			data: [],
			fields: [],
			source: "OUTPUT_TAX",
			filenameHint: "202604",
		};
		const filename = generateDynamicFilename(exportData);
		expect(filename).toBe("FPK-042026");
	});

	it("uses YYYY_MM hint to produce MMYYYY suffix (e.g. 2026_04 → 042026)", () => {
		const exportData: ExportData = {
			data: [],
			fields: [],
			source: "OUTPUT_TAX",
			filenameHint: "2026_04",
		};
		const filename = generateDynamicFilename(exportData);
		expect(filename).toBe("FPK-042026");
	});

	it("uses a period string with dashes (e.g. TD007-2026-04) and extracts MMYYYY", () => {
		const exportData: ExportData = {
			data: [],
			fields: [],
			source: "OUTPUT_TAX",
			filenameHint: "TD007-2026-04",
		};
		const filename = generateDynamicFilename(exportData);
		expect(filename).toBe("FPK-042026");
	});

	it("uses a 4-digit year hint for OUTPUT_RETURN (returns YEAR only)", () => {
		const exportData: ExportData = {
			data: [],
			fields: [],
			source: "OUTPUT_RETURN",
			filenameHint: "2025",
		};
		const filename = generateDynamicFilename(exportData);
		expect(filename).toBe("RET-FPK-2025");
	});

	it("uses a 4-digit year hint for INPUT_RETURN (returns YEAR only)", () => {
		const exportData: ExportData = {
			data: [],
			fields: [],
			source: "INPUT_RETURN",
			filenameHint: "2024",
		};
		const filename = generateDynamicFilename(exportData);
		expect(filename).toBe("RET-FPM-2024");
	});

	it("uses a PPH_21 hint with period string", () => {
		const exportData: ExportData = {
			data: [],
			fields: [],
			source: "PPH_21_L1A",
			filenameHint: "202603",
		};
		const filename = generateDynamicFilename(exportData);
		expect(filename).toBe("PPH21-L1A-032026");
	});

	it("falls back to date-based suffix when filenameHint is undefined and data is empty", () => {
		// With no hint and no data, the function uses the current date.
		// We just verify the prefix is correct and the suffix is non-empty.
		const exportData: ExportData = {
			data: [],
			fields: [],
			source: "OUTPUT_TAX",
			filenameHint: undefined,
		};
		const filename = generateDynamicFilename(exportData);
		expect(filename.startsWith("FPK-")).toBe(true);
		// Suffix should be MMYYYY (6 digits)
		const suffix = filename.slice("FPK-".length);
		expect(/^\d{6}$/.test(suffix)).toBe(true);
	});

	it("derives period from data rows when filenameHint is absent", () => {
		const exportData: ExportData = {
			data: [
				{
					TaxInvoiceYear: "2026",
					TaxInvoicePeriod: "04",
					TaxInvoiceDate: "2026-04-15T00:00:00",
				},
			],
			fields: ["TaxInvoiceYear", "TaxInvoicePeriod", "TaxInvoiceDate"],
			source: "OUTPUT_TAX",
		};
		const filename = generateDynamicFilename(exportData);
		expect(filename).toBe("FPK-042026");
	});

	it("produces a range suffix when data rows span multiple periods", () => {
		const exportData: ExportData = {
			data: [
				{ TaxInvoiceYear: "2026", TaxInvoicePeriod: "03" },
				{ TaxInvoiceYear: "2026", TaxInvoicePeriod: "05" },
			],
			fields: ["TaxInvoiceYear", "TaxInvoicePeriod"],
			source: "OUTPUT_TAX",
		};
		const filename = generateDynamicFilename(exportData);
		// Should be FPK-032026-052026
		expect(filename).toBe("FPK-032026-052026");
	});
});

// ============================================================
// PREFIX_MAP completeness
// ============================================================
describe("PREFIX_MAP", () => {
	it("contains entries for all 11 ExportSource values plus the default", () => {
		const allSources: ExportSource[] = [
			"OUTPUT_TAX",
			"INPUT_TAX",
			"OUTPUT_RETURN",
			"INPUT_RETURN",
			"SPT_A2",
			"SPT_B2",
			"PPH_21_L1A",
			"PPH_21_L1B",
			"PPH_21_L2",
			"PPH_21_L3",
			"WITHHOLDING_SLIPS",
		];
		for (const source of allSources) {
			expect(PREFIX_MAP).toHaveProperty(source);
		}
		expect(PREFIX_MAP).toHaveProperty("default");
	});

	it("default entry is FPK-", () => {
		expect(PREFIX_MAP["default"]).toBe("FPK-");
	});
});

// ============================================================
// formatDate — timezone handling across multiple offsets
// ============================================================
describe("formatDate", () => {
	// ── Pure date strings ────────────────────────────────
	it("converts YYYY-MM-DD to DD/MM/YYYY without timezone shift", () => {
		expect(formatDate("2026-04-15")).toBe("15/04/2026");
	});

	it("converts YYYY-01-01 edge case correctly", () => {
		expect(formatDate("2025-01-01")).toBe("01/01/2025");
	});

	it("converts YYYY-12-31 edge case correctly", () => {
		expect(formatDate("2025-12-31")).toBe("31/12/2025");
	});

	// ── ISO datetime with +07:00 (Indonesia WIB) ─────────
	it("extracts calendar date at +07:00 offset — no midnight shift", () => {
		// 2026-01-31T23:00:00+07:00 is 16:00 UTC on 2026-01-31 — still Jan 31
		expect(formatDate("2026-01-31T23:00:00+07:00")).toBe("31/01/2026");
	});

	it("extracts calendar date at +07:00 when UTC would be previous day", () => {
		// 2026-03-01T00:30:00+07:00 is 2026-02-28T17:30:00Z — date in +07:00 is Mar 1
		expect(formatDate("2026-03-01T00:30:00+07:00")).toBe("01/03/2026");
	});

	// ── ISO datetime with +08:00 (WITA / Singapore) ──────
	it("extracts calendar date at +08:00 offset correctly", () => {
		// 2026-06-15T10:00:00+08:00 → June 15 at offset
		expect(formatDate("2026-06-15T10:00:00+08:00")).toBe("15/06/2026");
	});

	it("extracts calendar date at +08:00 near midnight — no off-by-one", () => {
		// 2026-07-01T00:15:00+08:00 is 2026-06-30T16:15:00Z — date in +08:00 is Jul 1
		expect(formatDate("2026-07-01T00:15:00+08:00")).toBe("01/07/2026");
	});

	// ── ISO datetime with +09:00 (WIT / Japan) ───────────
	it("extracts calendar date at +09:00 offset correctly", () => {
		expect(formatDate("2026-12-25T09:00:00+09:00")).toBe("25/12/2026");
	});

	it("extracts calendar date at +09:00 near midnight — no off-by-one", () => {
		// 2026-04-01T00:05:00+09:00 is 2026-03-31T15:05:00Z — date in +09:00 is Apr 1
		expect(formatDate("2026-04-01T00:05:00+09:00")).toBe("01/04/2026");
	});

	// ── ISO datetime with UTC (Z) ─────────────────────────
	it("extracts calendar date for UTC (Z) offset correctly", () => {
		expect(formatDate("2026-08-20T12:00:00Z")).toBe("20/08/2026");
	});

	it("extracts calendar date for UTC midnight correctly", () => {
		expect(formatDate("2026-11-01T00:00:00Z")).toBe("01/11/2026");
	});

	// ── ISO datetime with negative offset ─────────────────
	it("extracts calendar date at -05:00 offset correctly", () => {
		// 2026-09-10T20:00:00-05:00 is 2026-09-11T01:00:00Z — date at -05:00 is Sep 10
		expect(formatDate("2026-09-10T20:00:00-05:00")).toBe("10/09/2026");
	});

	// ── Non-date / edge cases ─────────────────────────────
	it("returns empty string for null-ish input", () => {
		expect(formatDate(null)).toBe("");
		expect(formatDate(undefined)).toBe("");
		expect(formatDate("")).toBe("");
	});

	it("returns non-date strings as-is", () => {
		expect(formatDate("not-a-date")).toBe("not-a-date");
	});
});
