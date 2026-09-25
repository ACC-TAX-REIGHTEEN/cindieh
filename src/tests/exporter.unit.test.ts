// Unit tests for exporter.ts — generateDynamicFilename and escapeCSV
// Validates: Requirements 6.5, 6.6, 12.2, 12.3
import { describe, it, expect } from "vitest";
import type { ExportSource } from "../content/page-context";
import { escapeCSV, buildCSV, generateDynamicFilename, PREFIX_MAP, downloadXLSXFile } from "../content/exporter";
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

	it("sanitizes CSV formula injection characters (=, +, @, non-numeric -)", () => {
		expect(escapeCSV("=SUM(A1:A10)")).toBe("'=SUM(A1:A10)");
		expect(escapeCSV("@SUM(A1)")).toBe("'@SUM(A1)");
		expect(escapeCSV("@SUM(1,2)")).toBe('"\'@SUM(1,2)"');
		expect(escapeCSV("+CMD")).toBe("'+CMD");
		expect(escapeCSV("-CMD|' /C calc'!A0")).toBe("'-CMD|' /C calc'!A0");
	});

	it("does not sanitize valid numeric values starting with - or +", () => {
		expect(escapeCSV(-100)).toBe("-100");
		expect(escapeCSV("-100.50")).toBe("-100.50");
	});

	it("preserves a leading apostrophe by doubling it (Excel text marker)", () => {
		expect(escapeCSV("'hello")).toBe("''hello");
		expect(escapeCSV("'-")).toBe("''-");
		expect(escapeCSV("'=SUM(A1)")).toBe("''=SUM(A1)");
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
// generateDynamicFilename — user filename prefix (popup preference)
// ============================================================
describe("generateDynamicFilename — user filenamePrefix", () => {
	it("places the user prefix in front of the per-source prefix", () => {
		const exportData: ExportData = {
			data: [],
			fields: [],
			source: "OUTPUT_TAX",
			filenameHint: "202604",
			filenamePrefix: "PTABC-",
		};

		// The per-source prefix still ends the name, so the README's documented
		// shape (`FPK-042026`) remains recognizable inside it.
		expect(generateDynamicFilename(exportData)).toBe("PTABC-FPK-042026");
	});

	it("leaves the filename untouched when no prefix is set", () => {
		const base: ExportData = { data: [], fields: [], source: "OUTPUT_TAX", filenameHint: "202604" };

		expect(generateDynamicFilename({ ...base, filenamePrefix: "" })).toBe(
			generateDynamicFilename(base),
		);
		expect(generateDynamicFilename({ ...base, filenamePrefix: undefined })).toBe(
			generateDynamicFilename(base),
		);
	});

	it("sanitizes a prefix that did not come through storage", () => {
		// ExportData is constructed in several places (tests, direct callers), so
		// the filename must not trust the value just because the popup sanitizes.
		const exportData: ExportData = {
			data: [],
			fields: [],
			source: "OUTPUT_TAX",
			filenameHint: "202604",
			filenamePrefix: "A/B:C?",
		};

		// The illegal characters are dropped, not replaced: the user owns the
		// separator (the placeholder suggests `PTABC-`), and inventing one would
		// make `AB` + `C` and `ABC` produce different names from the same intent.
		expect(generateDynamicFilename(exportData)).toBe("ABCFPK-042026");
	});

	it("applies the prefix to the data-derived and fallback filenames too", () => {
		const withRows: ExportData = {
			data: [{ TaxInvoiceYear: "2026", TaxInvoicePeriod: "04" }],
			fields: [],
			source: "OUTPUT_TAX",
			filenamePrefix: "X-",
		};

		expect(generateDynamicFilename(withRows).startsWith("X-FPK-")).toBe(true);
		expect(generateDynamicFilename({ data: [], fields: [], filenamePrefix: "X-" }).startsWith("X-FPK-")).toBe(
			true,
		);
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

	it("derives the withholding period from the slip date", () => {
		// A withholding row carries no tax-period field, so the slip date is the
		// only period signal the filename can be seeded from.
		const exportData: ExportData = {
			data: [
				{ WithholdingSlipNumber: "BP-001", WithholdingSlipsDate: "2026-07-15T00:00:00+07:00" },
				{ WithholdingSlipNumber: "BP-002", WithholdingSlipsDate: "2026-07-31T00:00:00+07:00" },
			],
			fields: ["WithholdingSlipNumber", "WithholdingSlipsDate"],
			source: "WITHHOLDING_SLIPS",
		};
		expect(generateDynamicFilename(exportData)).toBe("BP-072026");
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
// downloadXLSXFile
// ============================================================
describe("downloadXLSXFile", () => {
	it("executes without error when given 2D rows", () => {
		const originalCreate = URL.createObjectURL;
		const originalRevoke = URL.revokeObjectURL;
		const originalDocument = globalThis.document;
		let created = false;
		let revoked = false;
		let clicked = false;

		URL.createObjectURL = () => {
			created = true;
			return "blob:fake-url";
		};
		URL.revokeObjectURL = () => {
			revoked = true;
		};
		(globalThis as unknown as { document: unknown }).document = {
			createElement: () => ({
				href: "",
				download: "",
				click: () => {
					clicked = true;
				},
			}),
		};

		const rows = [
			["Header 1", "Header 2"],
			["Value 1", 1000],
		];

		expect(() => {
			downloadXLSXFile(rows, "test.xlsx", "Sheet1");
		}).not.toThrow();

		expect(created).toBe(true);
		expect(revoked).toBe(true);
		expect(clicked).toBe(true);

		URL.createObjectURL = originalCreate;
		URL.revokeObjectURL = originalRevoke;
		(globalThis as unknown as { document: unknown }).document = originalDocument;
	});
});
