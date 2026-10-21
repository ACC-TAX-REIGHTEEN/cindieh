// ============================================================================
// export-source.matrix.unit.test.ts — the CHARACTERISATION matrix
// ============================================================================
// One table per axis, covering all 11 ExportSource values, written against the
// code as it stood BEFORE the export-source spec refactor. It exists so the
// refactor's claim "no export source changed shape" is checkable rather than
// asserted: this file passes on the old branching implementation and must pass
// unchanged on the new declaration-driven one.
//
// Deliberately overlapping with exporter.processdata.unit.test.ts and
// exporter.unit.test.ts. Those two say "MASA for OUTPUT_TAX is '4'"; this file
// says "here is all eleven sources' column sets and filename shapes, side by
// side, in one place" — which is the thing you actually read when a source's
// export changes. Keep it as the diff surface.
//
// Nothing here imports the new module: it pins BEHAVIOUR through the public
// exporter API only, so it survives the refactor by construction.
// ============================================================================

import { describe, it, expect } from "vitest";
import { processData, generateDynamicFilename, type ExportData } from "../content/exporter";
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

/** Build an ExportData whose captured fields default to the fixture's own keys. */
function exportDataOf(
	source: ExportSource | undefined,
	rows: Record<string, unknown>[],
	overrides: Partial<ExportData> = {},
): ExportData {
	return {
		data: rows,
		fields: rows.length > 0 ? Object.keys(rows[0]) : [],
		source,
		...overrides,
	};
}

// ============================================================================
// COLUMN MAPPING MATRIX — cleaned mode, every source
// ============================================================================

describe("column mapping matrix — cleaned mode, all 11 sources", () => {
	it("OUTPUT_TAX: tax-period columns fall back to TaxPeriodMonth/TaxPeriodYear", () => {
		const rows = [
			{
				// The TD007-prefixed form the portal actually sends.
				TaxInvoiceDate: "2026-04-15T00:00:00+07:00",
				TaxInvoicePeriod: "TD007-2026-04",
				TaxInvoiceYear: "TD007-2026-04",
				BuyerName: "PT Maju Jaya",
				BuyerTIN: "123456789",
				TaxInvoiceNumber: "0400000001",
				TaxInvoiceStatus: "NORMAL",
				BuyerStatus: "PKP",
				SellingPrice: 568000,
				OtherTaxBase: 1818,
				VAT: 62480,
				STLG: 0,
				Reference: "SZ-0447/07/26",
			},
			{
				// Primary period fields empty: the fallback chain must find the
				// month in TaxPeriodMonth and the year in TaxPeriodYear.
				TaxInvoiceDate: "2026-06-01T00:00:00+07:00",
				TaxInvoicePeriod: "",
				TaxInvoiceYear: "",
				TaxPeriodMonth: "TD.00706",
				TaxPeriodYear: "2026",
				BuyerName: "PT whatsoever",
				BuyerTIN: "222",
				TaxInvoiceNumber: "0600000002",
				TaxInvoiceStatus: "NORMAL",
				BuyerStatus: "PKP",
				SellingPrice: 100,
				OtherTaxBase: 0,
				VAT: 11,
				STLG: 0,
				Reference: "SZ-0448/06/26",
			},
			{
				// No period signal at all: both columns are empty strings, NOT
				// "undefined" and not 0.
				TaxInvoiceDate: "2026-01-01T00:00:00+07:00",
				TaxInvoicePeriod: "",
				TaxInvoiceYear: "",
				BuyerName: "Tanpa Masa",
				BuyerTIN: "333",
				TaxInvoiceNumber: "0100000003",
				TaxInvoiceStatus: "NORMAL",
				BuyerStatus: "PKP",
				SellingPrice: 100,
				OtherTaxBase: 0,
				VAT: 11,
				STLG: 0,
				Reference: "SZ-0449/01/26",
			},
		];

		const result = processData(exportDataOf("OUTPUT_TAX", rows));

		expect(result.fields).toEqual([
			"TANGGAL",
			"MASA",
			"TAHUN",
			"NAMA PEMBELI",
			"NO IDENTITAS PEMBELI",
			"NO FAKTUR",
			"STATUS",
			"STATUS PEMBELI",
			"DPP",
			"DPP NILAI LAIN",
			"PPN",
			"PPNBM",
			"REFERENSI",
		]);

		// MASA drops its leading zero; TAHUN keeps four digits.
		expect(result.data[0]).toEqual({
			TANGGAL: "15/04/2026",
			MASA: "4",
			TAHUN: "2026",
			"NAMA PEMBELI": "PT Maju Jaya",
			"NO IDENTITAS PEMBELI": "123456789",
			"NO FAKTUR": "0400000001",
			STATUS: "NORMAL",
			"STATUS PEMBELI": "PKP",
			DPP: 568000,
			"DPP NILAI LAIN": 1818,
			PPN: 62480,
			PPNBM: 0,
			REFERENSI: "SZ-0447/07/26",
		});
		expect(result.data[1].MASA).toBe("6");
		expect(result.data[1].TAHUN).toBe("2026");
		expect(result.data[2].MASA).toBe("");
		expect(result.data[2].TAHUN).toBe("");
	});

	it("INPUT_TAX: adds the two crediting-period columns", () => {
		const rows = [
			{
				TaxInvoiceDate: "2026-03-10T00:00:00+07:00",
				TaxInvoicePeriod: "TD.00703",
				TaxInvoiceYear: "2026",
				SellerTaxpayerName: "PT Supplier",
				SellerTIN: "987654321",
				TaxInvoiceNumber: "0100000999",
				TaxInvoiceStatus: "APPROVED",
				BuyerStatus: "CREDITED",
				PeriodCredit: "TD.00704",
				YearCredit: "2026",
				SellingPrice: 1000000,
				OtherTaxBase: 916667,
				VAT: 110000,
				STLG: 0,
				Reference: "REF-IN-001",
			},
		];

		const result = processData(exportDataOf("INPUT_TAX", rows));

		expect(result.fields).toEqual([
			"TANGGAL",
			"MASA",
			"TAHUN",
			"NAMA PENJUAL",
			"NO IDENTITAS PENJUAL",
			"NO FAKTUR",
			"STATUS",
			"STATUS PEMBELI",
			"MASA PENGKREDITAN",
			"TAHUN PENGKREDITAN",
			"DPP",
			"DPP NILAI LAIN",
			"PPN",
			"PPNBM",
			"REFERENSI",
		]);
		expect(result.data[0]).toEqual({
			TANGGAL: "10/03/2026",
			MASA: "3",
			TAHUN: "2026",
			"NAMA PENJUAL": "PT Supplier",
			"NO IDENTITAS PENJUAL": "987654321",
			"NO FAKTUR": "0100000999",
			STATUS: "APPROVED",
			"STATUS PEMBELI": "CREDITED",
			"MASA PENGKREDITAN": "4",
			"TAHUN PENGKREDITAN": "2026",
			DPP: 1000000,
			"DPP NILAI LAIN": 916667,
			PPN: 110000,
			PPNBM: 0,
			REFERENSI: "REF-IN-001",
		});
	});

	it("OUTPUT_RETURN: return columns, and ReturnDate is formatted as its own date", () => {
		const rows = [
			{
				BuyerTIN: "0639343490201000",
				BuyerTaxpayerNameClear: "PT Buyer Clear",
				TaxInvoiceNumber: "0400000123",
				TaxInvoiceDate: "2026-06-18T00:00:00+07:00",
				ReturnNumber: "RET-OUT-001",
				ReturnDate: "2026-07-01T00:00:00+07:00",
				TaxInvoicePeriod: "TD.00706",
				TaxInvoiceYear: "2026",
				BuyerStatus: "CREDITED",
				TaxInvoiceStatus: "APPROVED",
				SellingPrice: 291215,
				OtherTaxBase: 266947,
				VAT: 32034,
				STLG: 0,
			},
		];

		const result = processData(exportDataOf("OUTPUT_RETURN", rows));

		expect(result.fields).toEqual([
			"NO IDENTITAS PEMBELI",
			"NAMA PEMBELI",
			"NO FAKTUR",
			"TANGGAL FAKTUR",
			"NO RETUR",
			"TANGGAL RETUR",
			"MASA",
			"TAHUN",
			"STATUS PEMBELI",
			"STATUS",
			"DPP",
			"DPP NILAI LAIN",
			"PPN",
			"PPNBM",
		]);
		expect(result.data[0]).toEqual({
			"NO IDENTITAS PEMBELI": "0639343490201000",
			"NAMA PEMBELI": "PT Buyer Clear",
			"NO FAKTUR": "0400000123",
			"TANGGAL FAKTUR": "18/06/2026",
			"NO RETUR": "RET-OUT-001",
			"TANGGAL RETUR": "01/07/2026",
			// The RETUR's own month — July, from the credit note's date — not the
			// invoice's June. The portal puts the invoice's period in the
			// invoice's period field.
			MASA: "7",
			TAHUN: "2026",
			"STATUS PEMBELI": "CREDITED",
			STATUS: "APPROVED",
			DPP: 291215,
			"DPP NILAI LAIN": 266947,
			PPN: 32034,
			PPNBM: 0,
		});
	});

	it("INPUT_RETURN: same shape, seller columns and its own return date", () => {
		const rows = [
			{
				SellerTIN: "0016232159201000",
				SellerTaxpayerName: "PT Seller",
				TaxInvoiceNumber: "0100000123",
				TaxInvoiceDate: "2026-06-18T00:00:00+07:00",
				ReturnNumber: "RET-IN-001",
				ReturnDate: "2026-07-02T00:00:00+07:00",
				TaxInvoicePeriod: "TD.00706",
				TaxInvoiceYear: "2026",
				BuyerStatus: "CREDITED",
				TaxInvoiceStatus: "APPROVED",
				SellingPrice: 1000000,
				OtherTaxBase: 916667,
				VAT: 110000,
				STLG: 0,
			},
		];

		const result = processData(exportDataOf("INPUT_RETURN", rows));

		expect(result.fields).toEqual([
			"NO IDENTITAS PENJUAL",
			"NAMA PENJUAL",
			"NO FAKTUR",
			"TANGGAL FAKTUR",
			"NO RETUR",
			"TANGGAL RETUR",
			"MASA",
			"TAHUN",
			"STATUS PEMBELI",
			"STATUS",
			"DPP",
			"DPP NILAI LAIN",
			"PPN",
			"PPNBM",
		]);
		expect(result.data[0]["NO IDENTITAS PENJUAL"]).toBe("0016232159201000");
		expect(result.data[0]["TANGGAL FAKTUR"]).toBe("18/06/2026");
		expect(result.data[0]["TANGGAL RETUR"]).toBe("02/07/2026");
		// The credit note's own month, not the invoice's.
		expect(result.data[0].MASA).toBe("7");
		expect(result.data[0].TAHUN).toBe("2026");
	});

	it("WITHHOLDING_SLIPS: both number spellings, MASA/TAHUN derived from the slip date", () => {
		const singular = {
			// The bulk-PDF spelling (scraper-xhr.ts).
			WithholdingSlipNumber: "BP-001",
			WithholdingSlipsDate: "2026-07-15T00:00:00+07:00",
			EmployerName: "PT Mitra Sejahtera",
			TaxIdentificationNumber: "01234567890123",
			RecordId: "rec-1",
		};
		const plural = {
			// The PDF-filename spelling (downloader.ts).
			WithholdingSlipsNumber: "BP-002",
			WithholdingSlipsDate: "2026-08-20T00:00:00+07:00",
			EmployerName: "PT Mitra twofold",
			TaxIdentificationNumber: "01234567890124",
		};

		const result = processData(exportDataOf("WITHHOLDING_SLIPS", [singular, plural]));

		expect(result.fields).toEqual([
			"NO BUKTI POTONG",
			"TANGGAL",
			"MASA",
			"TAHUN",
			"NAMA PEMOTONG",
			"NPWP PEMOTONG",
		]);
		expect(result.data).toEqual([
			{
				"NO BUKTI POTONG": "BP-001",
				TANGGAL: "15/07/2026",
				MASA: "7",
				TAHUN: "2026",
				"NAMA PEMOTONG": "PT Mitra Sejahtera",
				"NPWP PEMOTONG": "01234567890123",
			},
			{
				"NO BUKTI POTONG": "BP-002",
				TANGGAL: "20/08/2026",
				MASA: "8",
				TAHUN: "2026",
				"NAMA PEMOTONG": "PT Mitra twofold",
				"NPWP PEMOTONG": "01234567890124",
			},
		]);
		// The unrecognised capture id is dropped: the cleaned column set is
		// declared, not the captured field list.
		expect(result.data[0]).not.toHaveProperty("RecordId");
	});

	it("SPT_A2: the fixed 8-field list, labels are the portal's own field names", () => {
		const rows = [
			{
				DocumentDate: "2026-05-20T00:00:00+07:00",
				Name: "PT Buyer Corp",
				TIN: "987654321",
				DocumentNumber: "DOC-001",
				TaxBase: 1000000,
				OtherTaxBase: 0,
				VAT: 110000,
				STLG: 0,
				ShouldBeDropped: "yes",
			},
		];

		const result = processData(exportDataOf("SPT_A2", rows));

		expect(result.fields).toEqual([
			"DocumentDate",
			"Name",
			"TIN",
			"DocumentNumber",
			"TaxBase",
			"OtherTaxBase",
			"VAT",
			"STLG",
		]);
		expect(result.data[0]).toEqual({
			DocumentDate: "20/05/2026",
			Name: "PT Buyer Corp",
			TIN: "987654321",
			DocumentNumber: "DOC-001",
			TaxBase: 1000000,
			OtherTaxBase: 0,
			VAT: 110000,
			STLG: 0,
		});
	});

	it("SPT_B2 and all four PPH_21 variants: every captured field passes through", () => {
		const dynamicSources = [
			"SPT_B2",
			"PPH_21_L1A",
			"PPH_21_L1B",
			"PPH_21_L2",
			"PPH_21_L3",
		] as const satisfies readonly ExportSource[];

		for (const source of dynamicSources) {
			const rows = [
				{
					PayDate: "2026-07-15T00:00:00+07:00",
					EmployeeName: "Budi Santoso",
					GrossIncome: 5000000,
				},
			];

			const result = processData(exportDataOf(source, rows));

			// No declared column set: the captured field list IS the column set,
			// which is why a schema change here needs no code change.
			expect(result.fields).toEqual(["PayDate", "EmployeeName", "GrossIncome"]);
			expect(result.data[0]).toEqual({
				PayDate: "15/07/2026",
				EmployeeName: "Budi Santoso",
				GrossIncome: 5000000,
			});
		}
	});

	it("raw mode: captured fields are kept verbatim for every source", () => {
		const row = {
			TaxInvoiceDate: "2026-04-15T00:00:00+07:00",
			TaxInvoicePeriod: "TD007-2026-04",
			Whatever: "kept",
		};

		for (const source of ALL_SOURCES) {
			const result = processData({
				...exportDataOf(source, [row]),
				mode: "raw",
			});

			expect(result.fields).toEqual(Object.keys(row));
			// Only ISO datetimes are touched; a period code is left alone.
			expect(result.data[0]).toEqual({
				TaxInvoiceDate: "15/04/2026",
				TaxInvoicePeriod: "TD007-2026-04",
				Whatever: "kept",
			});
			expect(result.mode).toBe("raw");
		}
	});

	// ── The two genuinely surprising cell behaviours ─────────────────────────
	// Both are properties of "format anything that LOOKS like an ISO datetime",
	// which is applied per column rather than to known date fields only. Pin
	// them explicitly so a refactor cannot quietly narrow or widen the catch.

	it("an ISO-datetime value is reformatted even in a column that is not a date", () => {
		const rows = [
			{
				DocumentDate: "2026-05-20T00:00:00+07:00",
				Name: "2026-01-02T00:00:00+07:00",
				TIN: "987654321",
				DocumentNumber: "DOC-001",
				TaxBase: 0,
				OtherTaxBase: 0,
				VAT: 0,
				STLG: 0,
			},
		];

		const result = processData(exportDataOf("SPT_A2", rows));
		expect(result.data[0].Name).toBe("02/01/2026");
	});

	it("a pure YYYY-MM-DD value is NOT reformatted by the ISO catch", () => {
		// formatDate() on its own WOULD rewrite this to 04/03/2026. The catch
		// requires the time component, which is the whole difference between the
		// `date` reader and the `isoDate` reader.
		const rows = [
			{
				DocumentDate: "2026-05-20T00:00:00+07:00",
				Name: "PT Buyer Corp",
				TIN: "2026-03-04",
				DocumentNumber: "DOC-001",
				TaxBase: 0,
				OtherTaxBase: 0,
				VAT: 0,
				STLG: 0,
			},
		];

		const result = processData(exportDataOf("SPT_A2", rows));
		expect(result.data[0].TIN).toBe("2026-03-04");
	});
});

// ============================================================================
// FILENAME MATRIX — every source, every period source
// ============================================================================

describe("filename matrix — all 11 sources", () => {
	/**
	 * A clean `YYYYMM` hint. The expected suffix is what the ladder produces per
	 * source: the four e-faktur/retur-ish grids and the SPT/PPN sheets take
	 * MMYYYY, the two retur grids take the YEAR ONLY (dropping the month), and
	 * the PPh 21 sheets would additionally accept a non-period hint.
	 */
	const hintCases: readonly { source: ExportSource; expected: string }[] = [
		{ source: "OUTPUT_TAX", expected: "FPK-042026" },
		{ source: "INPUT_TAX", expected: "FPM-042026" },
		{ source: "OUTPUT_RETURN", expected: "RET-FPK-2026" },
		{ source: "INPUT_RETURN", expected: "RET-FPM-2026" },
		{ source: "SPT_A2", expected: "A2-042026" },
		{ source: "SPT_B2", expected: "B2-042026" },
		{ source: "PPH_21_L1A", expected: "PPH21-L1A-042026" },
		{ source: "PPH_21_L1B", expected: "PPH21-L1B-042026" },
		{ source: "PPH_21_L2", expected: "PPH21-L2-042026" },
		{ source: "PPH_21_L3", expected: "PPH21-L3-042026" },
		{ source: "WITHHOLDING_SLIPS", expected: "BP-042026" },
	];

	for (const { source, expected } of hintCases) {
		it(`${source}: a YYYYMM hint yields "${expected}"`, () => {
			const result = generateDynamicFilename({
				data: [],
				fields: [],
				source,
				filenameHint: "202604",
			});
			expect(result).toBe(expected);
		});
	}

	it("an unknown source string and an undefined source both fall back to the OUTPUT_TAX shape", () => {
		// The fallback is behavioural, not just cosmetic: an unrecognised source
		// must not throw and must not lose the period suffix.
		expect(generateDynamicFilename({ data: [], fields: [], source: undefined, filenameHint: "202604" })).toBe(
			"FPK-042026",
		);
		expect(
			generateDynamicFilename({
				data: [],
				fields: [],
				source: "SOMETHING_ELSE" as ExportSource,
				filenameHint: "202604",
			}),
		).toBe("FPK-042026");
	});

	it("the retur grids reduce any hint to its year", () => {
		for (const [source, prefix] of [
			["OUTPUT_RETURN", "RET-FPK-"],
			["INPUT_RETURN", "RET-FPM-"],
		] as const) {
			expect(generateDynamicFilename({ data: [], fields: [], source, filenameHint: "2025" })).toBe(
				`${prefix}2025`,
			);
			expect(generateDynamicFilename({ data: [], fields: [], source, filenameHint: "TD007-2026-04" })).toBe(
				`${prefix}2026`,
			);
		}
	});

	it("the PPh 21 sheets accept a non-period hint, and no other source does", () => {
		// "ART21" is 5 alphanumeric characters: not 6 digits, not 4 digits, but
		// long enough for the PPh 21-only leniency.
		const pph21 = generateDynamicFilename({
			data: [],
			fields: [],
			source: "PPH_21_L1A",
			filenameHint: "ART21",
		});
		expect(pph21).toBe("PPH21-L1A-ART21");

		// The same hint on a non-PPh source falls through to the date fallback,
		// which is MMYYYY from the current WIB month.
		const outputTax = generateDynamicFilename({
			data: [],
			fields: [],
			source: "OUTPUT_TAX",
			filenameHint: "ART21",
		});
		expect(outputTax).toMatch(/^FPK-\d{6}$/);
	});

	it("derives the period from per-row tax-period fields", () => {
		expect(
			generateDynamicFilename({
				data: [{ TaxInvoiceYear: "2026", TaxInvoicePeriod: "04", TaxInvoiceDate: "2026-04-15T00:00:00" }],
				fields: [],
				source: "OUTPUT_TAX",
			}),
		).toBe("FPK-042026");
	});

	it("falls back to the consolidated TaxPeriod field", () => {
		// No separate year/month columns at all — just the consolidated period.
		expect(
			generateDynamicFilename({
				data: [{ TaxPeriod: "202603" }],
				fields: [],
				source: "OUTPUT_TAX",
			}),
		).toBe("FPK-032026");
	});

	it("spans a range when rows cover more than one period", () => {
		expect(
			generateDynamicFilename({
				data: [
					{ TaxInvoiceYear: "2026", TaxInvoicePeriod: "03" },
					{ TaxInvoiceYear: "2026", TaxInvoicePeriod: "05" },
				],
				fields: [],
				source: "OUTPUT_TAX",
			}),
		).toBe("FPK-032026-052026");
	});

	it("SPT_A2 reads its period from DocumentDate/Date", () => {
		expect(
			generateDynamicFilename({
				data: [{ DocumentDate: "2026-05-20T00:00:00+07:00" }],
				fields: [],
				source: "SPT_A2",
			}),
		).toBe("A2-052026");

		expect(
			generateDynamicFilename({
				data: [{ Date: "2026-05-20T00:00:00+07:00" }],
				fields: [],
				source: "SPT_A2",
			}),
		).toBe("A2-052026");
	});

	it("WITHHOLDING_SLIPS reads its period from the slip date", () => {
		expect(
			generateDynamicFilename({
				data: [
					{ WithholdingSlipNumber: "BP-001", WithholdingSlipsDate: "2026-07-15T00:00:00+07:00" },
					{ WithholdingSlipNumber: "BP-002", WithholdingSlipsDate: "2026-07-31T00:00:00+07:00" },
				],
				fields: [],
				source: "WITHHOLDING_SLIPS",
			}),
		).toBe("BP-072026");
	});

	it("the retur grids IGNORE data-row periods and fall back to the current year", () => {
		// Asymmetric with every other source on purpose: a retur export is named
		// for the return year, not the invoice period.
		const filename = generateDynamicFilename({
			data: [
				{ TaxInvoiceYear: "2026", TaxInvoicePeriod: "04" },
				{ TaxInvoiceYear: "2026", TaxInvoicePeriod: "05" },
			],
			fields: [],
			source: "OUTPUT_RETURN",
		});
		expect(filename).toMatch(/^RET-FPK-\d{4}$/);
	});

	it("with neither hint nor rows, every source falls back to a prefix + period shape", () => {
		const expectedShapes: Record<ExportSource, RegExp> = {
			OUTPUT_TAX: /^FPK-\d{6}$/,
			INPUT_TAX: /^FPM-\d{6}$/,
			OUTPUT_RETURN: /^RET-FPK-\d{4}$/,
			INPUT_RETURN: /^RET-FPM-\d{4}$/,
			SPT_A2: /^A2-\d{6}$/,
			SPT_B2: /^B2-\d{6}$/,
			PPH_21_L1A: /^PPH21-L1A-\d{6}$/,
			PPH_21_L1B: /^PPH21-L1B-\d{6}$/,
			PPH_21_L2: /^PPH21-L2-\d{6}$/,
			PPH_21_L3: /^PPH21-L3-\d{6}$/,
			WITHHOLDING_SLIPS: /^BP-\d{6}$/,
		};

		for (const source of ALL_SOURCES) {
			expect(generateDynamicFilename({ data: [], fields: [], source })).toMatch(
				expectedShapes[source],
			);
		}
	});

	it("a user filename prefix sits in front of the per-source prefix", () => {
		expect(
			generateDynamicFilename({
				data: [],
				fields: [],
				source: "WITHHOLDING_SLIPS",
				filenameHint: "202604",
				filenamePrefix: "PTABC-",
			}),
		).toBe("PTABC-BP-042026");
	});
});
