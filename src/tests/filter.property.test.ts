// Feature: better-coretax-improvements, Property 3: applyFilters date range exclusion
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { applyFilters } from "../content/filter";

const DATE_MIN_MS = new Date("2000-01-01").getTime();
const DATE_MAX_MS = new Date("2030-12-31").getTime();

/**
 * Safe date arbitrary: generates Date objects strictly within the ISO-safe
 * range [2000-01-01, 2030-12-31] using integer timestamps to avoid
 * toISOString() throwing RangeError on out-of-range dates.
 */
const safeDateArb = fc
  .integer({ min: DATE_MIN_MS, max: DATE_MAX_MS })
  .map((ms) => new Date(ms));

function parseDateBound(value: string, endOfDay: boolean): Date {
  const d = new Date(value);
  if (endOfDay) {
    d.setHours(23, 59, 59, 999);
  } else {
    d.setHours(0, 0, 0, 0);
  }
  return d;
}

/**
 * Row arbitrary: rows with optional InvoiceDate (ISO string or null),
 * plus Status and Name string fields.
 */
const rowArb = fc.record(
  {
    InvoiceDate: fc.option(safeDateArb.map((d) => d.toISOString()), {
      nil: null,
    }),
    Status: fc.string(),
    Name: fc.string(),
  },
  { requiredKeys: [] },
);

describe("applyFilters - Property 3: date range exclusion", () => {
  /**
   * Validates: Requirements 11.5 (a, d)
   *
   * For any array of rows and any combination of dateFrom/dateTo bounds:
   * - Every row returned has an InvoiceDate that parses to a date within the
   *   specified bounds (inclusive on both ends).
   * - Every row whose InvoiceDate is missing, null, or unparseable is excluded
   *   whenever at least one bound is specified.
   */
  it("all returned rows have InvoiceDate within bounds; missing/null dates excluded when bounds set", () => {
    fc.assert(
      fc.property(
        fc.array(rowArb),
        fc.option(safeDateArb),
        fc.option(safeDateArb),
        (rows, dateFrom, dateTo) => {
          // Normalise so that from <= to when both are present
          const from =
            dateFrom && dateTo && dateFrom > dateTo ? dateTo : dateFrom;
          const to =
            dateFrom && dateTo && dateFrom > dateTo ? dateFrom : dateTo;

          const options = {
            dateFrom: from ? from.toISOString().slice(0, 10) : undefined,
            dateTo: to ? to.toISOString().slice(0, 10) : undefined,
          };

          const result = applyFilters(
            rows as Record<string, unknown>[],
            options,
          );

          if (options.dateFrom || options.dateTo) {
            for (const row of result) {
              // Requirement 11.5 (d): rows with missing/null InvoiceDate must be excluded
              expect(row["InvoiceDate"]).not.toBeNull();
              expect(row["InvoiceDate"]).toBeDefined();

              const d = new Date(String(row["InvoiceDate"]));
              // Must be a valid date
              expect(isNaN(d.getTime())).toBe(false);

              // Requirement 11.5 (a): date must be within the specified bounds (inclusive)
              if (options.dateFrom) {
                expect(d >= parseDateBound(options.dateFrom, false)).toBe(true);
              }
              if (options.dateTo) {
                expect(d <= parseDateBound(options.dateTo, true)).toBe(true);
              }
            }
          }
        },
      ),
    );
  });
});
