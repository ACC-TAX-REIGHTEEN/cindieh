// ============================================================================
// export-source.unit.test.ts — the export-source declarations and the mapper
// ============================================================================
// The matrix file pins BEHAVIOUR through the public exporter API. This one pins
// the module's own surface: that the table is complete, that a column resolves
// candidate spellings correctly, and that the schema-drift warning fires when it
// should — including the two cases where it deliberately no longer does.
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
	CAPTURED_COLUMNS,
	getExportSourceSpec,
	mapColumns,
	type ColumnPlan,
} from "../content/export-source";
import { processData } from "../content/exporter";
import { disableDebug, enableDebug } from "../content/debug";
import type { ExportSource } from "../content/page-context";

const ALL_SOURCES: readonly ExportSource[] = [
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

// ── The declaration table ────────────────────────────────────────────────────

describe("getExportSourceSpec", () => {
	it("declares every source, and none is the OUTPUT_TAX fallback", () => {
		// `Record<ExportSource, …>` makes a MISSING entry a type error; this
		// catches the other half — an entry that was copy-pasted from OUTPUT_TAX
		// and therefore silently exports PPN Keluaran columns.
		const outputTax = getExportSourceSpec("OUTPUT_TAX");
		for (const source of ALL_SOURCES) {
			const spec = getExportSourceSpec(source);
			expect(spec, `${source} resolved to no spec`).toBeDefined();
			if (source !== "OUTPUT_TAX") expect(spec, `${source} is the fallback`).not.toBe(outputTax);
		}
	});

	it("gives every source a filename prefix and a period shape", () => {
		for (const source of ALL_SOURCES) {
			const spec = getExportSourceSpec(source);
			expect(spec.prefix, `${source} has no prefix`).toMatch(/[A-Z0-9]+-$/);
			expect(["masa", "tahun"], `${source} has an unknown shape`).toContain(spec.filename.shape);
			expect(spec.filename.periodDateFields.length, `${source} names no date fields`).toBeGreaterThan(0);
		}
	});

	it("names only the retur grids as year-only, and only the PPh 21 sheets as loose-hinted", () => {
		const yearOnly = ALL_SOURCES.filter((s) => getExportSourceSpec(s).filename.shape === "tahun");
		const loose = ALL_SOURCES.filter((s) => getExportSourceSpec(s).filename.looseHint === true);

		expect(yearOnly).toEqual(["OUTPUT_RETURN", "INPUT_RETURN"]);
		expect(loose).toEqual(["PPH_21_L1A", "PPH_21_L1B", "PPH_21_L2", "PPH_21_L3"]);
	});

	it("declares a drift warning for the fixed-column sources and not the captured ones", () => {
		// A captured-column source has nothing to drift from: its columns ARE the
		// API response, so "none of them matched" is the normal case, not a
		// warning. The old code had the same asymmetry, minus the explanation.
		const withWarning = ALL_SOURCES.filter((s) => getExportSourceSpec(s).driftWarning !== undefined);

		expect(withWarning).toEqual([
			"OUTPUT_TAX",
			"INPUT_TAX",
			"OUTPUT_RETURN",
			"INPUT_RETURN",
			"SPT_A2",
			"WITHHOLDING_SLIPS",
		]);
	});
});

// ── mapColumns ───────────────────────────────────────────────────────────────

describe("mapColumns", () => {
	const DECLARED: ColumnPlan = {
		kind: "declared",
		columns: [
			{ label: "TANGGAL", sources: ["DocDate"], read: (raw) => `date:${String(raw)}` },
			{ label: "MASA", sources: ["Period", "TaxPeriodMonth"], read: (raw) => `month:${String(raw)}` },
			{ label: "JUMLAH", sources: ["Amount"] },
		],
	};

	it("writes one cell per column, keyed by label, in declaration order", () => {
		const result = mapColumns(DECLARED, [{ DocDate: "d", Period: "p", Amount: 1 }], []);

		expect(result.fields).toEqual(["TANGGAL", "MASA", "JUMLAH"]);
		expect(result.data).toEqual([{ TANGGAL: "date:d", MASA: "month:p", JUMLAH: 1 }]);
	});

	it("maps every row independently", () => {
		const result = mapColumns(DECLARED, [{ Period: "01", Amount: 1 }, { Period: "02", Amount: 2 }], []);

		expect(result.data).toEqual([
			{ TANGGAL: "date:undefined", MASA: "month:01", JUMLAH: 1 },
			{ TANGGAL: "date:undefined", MASA: "month:02", JUMLAH: 2 },
		]);
	});

	it("falls through the candidate spellings to the first that carries a value", () => {
		const plan: ColumnPlan = {
			kind: "declared",
			columns: [{ label: "NO BUKTI POTONG", sources: ["Plural", "Singular"] }],
		};

		expect(mapColumns(plan, [{ Singular: "from-singular" }], []).data).toEqual([
			{ "NO BUKTI POTONG": "from-singular" },
		]);
		expect(mapColumns(plan, [{ Plural: "from-plural", Singular: "ignored" }], []).data).toEqual([
			{ "NO BUKTI POTONG": "from-plural" },
		]);
	});

	it("skips an empty-string candidate but KEEPS a zero", () => {
		// The distinction the characterisation matrix caught: `0` is a real amount
		// in a Coretax row, and only "", null and undefined mean "not sent".
		const plan: ColumnPlan = {
			kind: "declared",
			columns: [
				{ label: "DPP", sources: ["Primary", "Fallback"] },
				{ label: "PPNBM", sources: ["OtherPrimary", "OtherFallback"] },
			],
		};

		expect(
			mapColumns(plan, [{ Primary: "", Fallback: 0, OtherPrimary: 0, OtherFallback: 7 }], []).data,
		).toEqual([{ DPP: 0, PPNBM: 0 }]);
	});

	it("a captured plan makes every captured field a column, under its own name", () => {
		const result = mapColumns(CAPTURED_COLUMNS, [{ A: "1", B: "2" }], ["A", "B", "C"]);

		// C is declared as a captured field but absent from the row: the column
		// still exists, with no value. That is what "the portal decides" means.
		expect(result.fields).toEqual(["A", "B", "C"]);
		expect(result.data).toEqual([{ A: "1", B: "2", C: undefined }]);
	});

	it("an empty row list yields no rows and no fields for a captured plan", () => {
		const result = mapColumns(CAPTURED_COLUMNS, [], []);
		expect(result.data).toEqual([]);
		expect(result.fields).toEqual([]);
		expect(result.drift).toBeNull();
	});

	describe("schema drift", () => {
		it("reports drift when a row carries none of the declared fields", () => {
			const result = mapColumns(DECLARED, [{ DocDate: "d", Period: "p", Amount: 1 }, {}], []);

			expect(result.drift).toEqual({
				expected: ["DocDate", "Period", "TaxPeriodMonth", "Amount"],
				sampleRow: { DocDate: "d", Period: "p", Amount: 1 },
			});
		});

		it("does not report drift when the fallback spelling supplied the value", () => {
			// A grid that only sends the consolidated TaxPeriod is working as
			// designed, and its MASA cell is populated. The old primary-only check
			// called that drift; the check now asks the honest question.
			const result = mapColumns(DECLARED, [{ TaxPeriodMonth: "06", Amount: 1 }], []);

			expect(result.data).toEqual([
				{ TANGGAL: "date:undefined", MASA: "month:06", JUMLAH: 1 },
			]);
			expect(result.drift).toBeNull();
		});

		it("lists every candidate spelling in the expected payload", () => {
			// The payload is what someone debugging a schema change reads to learn
			// which field the API stopped sending, so the alternates belong in it.
			const plan: ColumnPlan = {
				kind: "declared",
				columns: [{ label: "X", sources: ["A", "B", "C"] }],
			};
			expect(mapColumns(plan, [{}], []).drift?.expected).toEqual(["A", "B", "C"]);
		});
	});
});

// ── The drift warning as the exporter emits it ───────────────────────────────

describe("processData — schema drift warning", () => {
	let warn: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		enableDebug();
		warn = vi.spyOn(console, "warn").mockImplementation(() => {});
	});

	afterEach(() => {
		warn.mockRestore();
		disableDebug();
	});

	it("warns, naming the source's expected fields, when a row matches nothing", () => {
		processData({ data: [{}], fields: [], source: "INPUT_TAX" });

		expect(warn).toHaveBeenCalledTimes(1);
		// debugWarn prepends the "[Cindieh]" tag, so the message is arg 1.
		const [, message, payload] = warn.mock.calls[0] as [string, string, { expected: string[] }];
		expect(message).toContain("API schema may have changed");
		expect(message).toContain("INPUT_TAX");
		expect(payload.expected).toContain("SellerTaxpayerName");
	});

	it("stays quiet when the rows populated the columns", () => {
		processData({
			data: [{ SellerTaxpayerName: "PT Supplier", TaxInvoiceDate: "2026-01-01" }],
			fields: [],
			source: "INPUT_TAX",
		});

		expect(warn).not.toHaveBeenCalled();
	});

	it("stays quiet for a captured-column source, whose columns cannot drift", () => {
		processData({ data: [{}], fields: ["PayDate"], source: "PPH_21_L1A" });

		expect(warn).not.toHaveBeenCalled();
	});

	it("stays quiet for a withholding row whose only period signal is empty", () => {
		// BEHAVIOUR CHANGE, deliberate. The old check treated "" as absent, so a
		// slip with an empty slip date warned; the sheet it produces is correct
		// (empty period columns), so that warning was noise.
		processData({
			data: [{ WithholdingSlipsDate: "", EmployerName: "PT Mitra" }],
			fields: [],
			source: "WITHHOLDING_SLIPS",
		});

		expect(warn).not.toHaveBeenCalled();
	});

	it("stays quiet in raw mode, which expects to match nothing", () => {
		processData({ data: [{}], fields: ["Whatever"], source: "OUTPUT_TAX", mode: "raw" });

		expect(warn).not.toHaveBeenCalled();
	});
});
