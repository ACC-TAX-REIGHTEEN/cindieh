// Feature: cindieh-improvements, Property 7: generateDynamicFilename prefix consistency
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import type { ExportSource } from "../content/page-context";
import { generateDynamicFilename, PREFIX_MAP } from "../content/exporter";
import type { ExportData } from "../content/exporter";

/**
 * Property 7: generateDynamicFilename prefix consistency
 *
 * For any ExportSource value (including all 11 named sources, undefined, and
 * unrecognised strings) and any filenameHint input (including undefined, a valid
 * period string, and an empty string), the refactored generateDynamicFilename
 * using the flat PREFIX_MAP SHALL return the same filename string as the original
 * nested-ternary implementation would have.
 *
 * Since the original nested-ternary is no longer available, this test verifies:
 * 1. The PREFIX_MAP covers all 11 ExportSource values with the correct prefixes.
 * 2. The filename returned always starts with the correct prefix for the given source.
 * 3. Undefined or unrecognised source values fall back to "FPK-".
 *
 * Validates: Requirements 12.2, 12.3
 */

const allExportSources: ExportSource[] = [
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

/**
 * The expected prefix mapping — this mirrors the original nested-ternary logic
 * that was replaced by PREFIX_MAP. This serves as the reference implementation
 * for the property test.
 */
const expectedPrefixes: Record<ExportSource | "default", string> = {
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
	default:           "FPK-",
};

describe("generateDynamicFilename - Property 7: prefix consistency", () => {
	/**
	 * Structural check: PREFIX_MAP must cover all 11 ExportSource values
	 * with the exact same prefixes as the original nested-ternary implementation.
	 */
	it("PREFIX_MAP covers all 11 ExportSource values with correct prefixes", () => {
		for (const source of allExportSources) {
			expect(PREFIX_MAP).toHaveProperty(source);
			expect(PREFIX_MAP[source]).toBe(expectedPrefixes[source]);
		}
		// Also verify the default fallback
		expect(PREFIX_MAP["default"]).toBe("FPK-");
	});

	/**
	 * Property: for every ExportSource value and any filenameHint, the filename
	 * returned by generateDynamicFilename starts with the correct prefix.
	 *
	 * This verifies that the PREFIX_MAP lookup logic is correct for all 11 sources.
	 */
	it("filename always starts with the correct prefix for each ExportSource", () => {
		fc.assert(
			fc.property(
				fc.constantFrom(...allExportSources),
				fc.option(fc.string({ maxLength: 20 })),
				(source, filenameHint) => {
					const exportData: ExportData = {
						data: [],
						fields: [],
						source,
						filenameHint: filenameHint ?? undefined,
					};
					const filename = generateDynamicFilename(exportData);
					const expectedPrefix = expectedPrefixes[source];
					expect(filename.startsWith(expectedPrefix)).toBe(true);
				},
			),
		);
	});

	/**
	 * Property: for undefined source, the filename falls back to "FPK-" prefix.
	 *
	 * Validates: Requirement 12.3
	 */
	it("undefined source falls back to FPK- prefix", () => {
		fc.assert(
			fc.property(
				fc.option(fc.string({ maxLength: 20 })),
				(filenameHint) => {
					const exportData: ExportData = {
						data: [],
						fields: [],
						source: undefined,
						filenameHint: filenameHint ?? undefined,
					};
					const filename = generateDynamicFilename(exportData);
					expect(filename.startsWith("FPK-")).toBe(true);
				},
			),
		);
	});

	/**
	 * Property: for unrecognised source values (not in ExportSource union),
	 * the filename falls back to "FPK-" prefix.
	 *
	 * Validates: Requirement 12.3
	 */
	it("unrecognised source values fall back to FPK- prefix", () => {
		// Use strings that are definitely not valid ExportSource values
		const unrecognisedSources = fc
			.string({ minLength: 1, maxLength: 20 })
			.filter((s) => !(allExportSources as string[]).includes(s));

		fc.assert(
			fc.property(
				unrecognisedSources,
				fc.option(fc.string({ maxLength: 20 })),
				(unknownSource, filenameHint) => {
					const exportData: ExportData = {
						data: [],
						fields: [],
						// Cast to ExportSource to simulate an unrecognised value at runtime
						source: unknownSource as ExportSource,
						filenameHint: filenameHint ?? undefined,
					};
					const filename = generateDynamicFilename(exportData);
					expect(filename.startsWith("FPK-")).toBe(true);
				},
			),
		);
	});

	/**
	 * Property: for any ExportSource and any filenameHint, the prefix selected
	 * by the refactored PREFIX_MAP lookup equals the prefix that the original
	 * nested-ternary would have selected.
	 *
	 * This is the core of Property 7: the refactored implementation is
	 * behaviourally equivalent to the original for all inputs.
	 *
	 * Validates: Requirements 12.2, 12.3
	 */
	it("PREFIX_MAP lookup is equivalent to original nested-ternary for all ExportSource + filenameHint combinations", () => {
		/**
		 * Reference implementation: the original nested-ternary prefix selection
		 * logic, preserved here as the ground truth for comparison.
		 */
		function originalNestedTernaryPrefix(source: ExportSource | undefined): string {
			return source === "OUTPUT_TAX"
				? "FPK-"
				: source === "INPUT_TAX"
					? "FPM-"
					: source === "OUTPUT_RETURN"
						? "RET-FPK-"
						: source === "INPUT_RETURN"
							? "RET-FPM-"
							: source === "SPT_A2"
								? "A2-"
								: source === "SPT_B2"
									? "B2-"
									: source === "PPH_21_L1A"
										? "PPH21-L1A-"
										: source === "PPH_21_L1B"
											? "PPH21-L1B-"
											: source === "PPH_21_L2"
												? "PPH21-L2-"
												: source === "PPH_21_L3"
													? "PPH21-L3-"
													: source === "WITHHOLDING_SLIPS"
														? "BP-"
														: "FPK-";
		}

		fc.assert(
			fc.property(
				fc.option(fc.constantFrom(...allExportSources, "UNKNOWN" as ExportSource)),
				fc.option(fc.string({ maxLength: 20 })),
				(source, filenameHint) => {
					const resolvedSource = source ?? undefined;

					// Compute the prefix using the refactored PREFIX_MAP lookup
					const refactoredPrefix =
						resolvedSource && (resolvedSource as string) in PREFIX_MAP
							? PREFIX_MAP[resolvedSource as ExportSource]
							: PREFIX_MAP["default"];

					// Compute the prefix using the original nested-ternary
					const originalPrefix = originalNestedTernaryPrefix(resolvedSource);

					// The two approaches must agree on the prefix for every input
					expect(refactoredPrefix).toBe(originalPrefix);

					// Also verify the full filename starts with the agreed prefix
					const exportData: ExportData = {
						data: [],
						fields: [],
						source: resolvedSource,
						filenameHint: filenameHint ?? undefined,
					};
					const filename = generateDynamicFilename(exportData);
					expect(filename.startsWith(refactoredPrefix)).toBe(true);
				},
			),
		);
	});
});
