// Feature: cindieh-improvements, Property 8: CSV escaping round-trip
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { escapeCSV } from "../content/exporter";

/**
 * Property 8: CSV escaping round-trip
 *
 * For any string value (including strings containing commas, double-quotes,
 * newline characters, or being empty), applying `escapeCSV` and then parsing
 * the result as a single RFC 4180 CSV field SHALL recover the original string
 * value exactly.
 *
 * Validates: Requirements 6.5, 6.6
 */

/**
 * Parse a single RFC 4180 CSV field.
 * - If the field is wrapped in double-quotes, strip the outer quotes and
 *   replace every `""` sequence with a single `"`.
 * - Otherwise, return the field as-is.
 */
function parseCSVField(field: string): string {
	if (field.startsWith('"') && field.endsWith('"')) {
		return field.slice(1, -1).replace(/""/g, '"');
	}
	return field;
}

/**
 * Arbitrary that generates strings from the printable ASCII range plus
 * the three special CSV characters: comma, double-quote, and newline.
 * This is more efficient than fc.string().filter(...) for targeted testing.
 */
const csvSpecialChars = fc.constantFrom(",", '"', "\n");
const csvStringArb = fc.array(
	fc.oneof(
		fc.string({ minLength: 1, maxLength: 1 }),  // any single char
		csvSpecialChars,                             // inject special CSV chars
	),
	{ maxLength: 30 },
).map((chars) => chars.join(""));

describe("escapeCSV - Property 8: CSV escaping round-trip", () => {
	/**
	 * Core round-trip property: escapeCSV followed by RFC 4180 field parsing
	 * recovers the original string for any arbitrary string input.
	 *
	 * Validates: Requirements 6.5, 6.6
	 */
	it("round-trip: escapeCSV then parse as RFC 4180 field recovers original string", () => {
		fc.assert(
			fc.property(
				fc.string({ maxLength: 50 }),
				(s) => {
					const escaped = escapeCSV(s);
					const recovered = parseCSVField(escaped);
					expect(recovered).toBe(s);
				},
			),
		);
	});

	/**
	 * Round-trip property using Unicode grapheme strings to cover multi-byte
	 * characters, emoji, and other Unicode code points that may interact with
	 * CSV escaping.
	 *
	 * Validates: Requirements 6.5, 6.6
	 */
	it("round-trip: escapeCSV then parse as RFC 4180 field recovers original full-unicode string", () => {
		fc.assert(
			fc.property(
				fc.string({ unit: "grapheme", maxLength: 30 }),
				(s) => {
					const escaped = escapeCSV(s);
					const recovered = parseCSVField(escaped);
					expect(recovered).toBe(s);
				},
			),
		);
	});

	/**
	 * Round-trip property using strings that are constructed to include
	 * the special CSV characters (comma, double-quote, newline).
	 *
	 * Validates: Requirements 6.5, 6.6
	 */
	it("round-trip: strings with injected special CSV characters round-trip correctly", () => {
		fc.assert(
			fc.property(
				csvStringArb,
				(s) => {
					const escaped = escapeCSV(s);
					const recovered = parseCSVField(escaped);
					expect(recovered).toBe(s);
				},
			),
		);
	});

	/**
	 * Strings containing commas must be quoted in the output.
	 *
	 * Validates: Requirement 6.5
	 */
	it("strings containing commas are wrapped in double-quotes and round-trip correctly", () => {
		// Build strings that definitely contain a comma by concatenation
		fc.assert(
			fc.property(
				fc.string({ maxLength: 20 }),
				fc.string({ maxLength: 20 }),
				(prefix, suffix) => {
					const s = `${prefix},${suffix}`;
					const escaped = escapeCSV(s);
					expect(escaped.startsWith('"')).toBe(true);
					expect(escaped.endsWith('"')).toBe(true);
					expect(parseCSVField(escaped)).toBe(s);
				},
			),
		);
	});

	/**
	 * Strings containing double-quotes must be quoted and internal quotes doubled.
	 *
	 * Validates: Requirement 6.5
	 */
	it("strings containing double-quotes are wrapped and internal quotes are doubled, round-trip correctly", () => {
		fc.assert(
			fc.property(
				fc.string({ maxLength: 20 }),
				fc.string({ maxLength: 20 }),
				(prefix, suffix) => {
					const s = `${prefix}"${suffix}`;
					const escaped = escapeCSV(s);
					expect(escaped.startsWith('"')).toBe(true);
					expect(escaped.endsWith('"')).toBe(true);
					expect(parseCSVField(escaped)).toBe(s);
				},
			),
		);
	});

	/**
	 * Strings containing newlines must be quoted in the output.
	 *
	 * Validates: Requirement 6.5
	 */
	it("strings containing newlines are wrapped in double-quotes and round-trip correctly", () => {
		fc.assert(
			fc.property(
				fc.string({ maxLength: 20 }),
				fc.string({ maxLength: 20 }),
				(prefix, suffix) => {
					const s = `${prefix}\n${suffix}`;
					const escaped = escapeCSV(s);
					expect(escaped.startsWith('"')).toBe(true);
					expect(escaped.endsWith('"')).toBe(true);
					expect(parseCSVField(escaped)).toBe(s);
				},
			),
		);
	});

	/**
	 * null and undefined serialize as empty unquoted fields.
	 *
	 * Validates: Requirement 6.6
	 */
	it("null and undefined serialize as empty unquoted fields", () => {
		expect(escapeCSV(null)).toBe("");
		expect(escapeCSV(undefined)).toBe("");
	});

	/**
	 * Empty string serializes as an empty unquoted field.
	 *
	 * Validates: Requirement 6.6
	 */
	it("empty string serializes as empty unquoted field", () => {
		expect(escapeCSV("")).toBe("");
	});
});
