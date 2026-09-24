// Unit tests for reference-search.ts — the Reference filter's match mode.
//
// The behaviour under test is a measured one (tools/README.md, 24 Sep 2026):
// `startswith` answers in ~0.1 s while `contains` can take ~97 s on the same
// data, so the fast mode goes first and the wide one is only paid for when the
// prefix match came back empty.
import { describe, expect, it } from "vitest";
import {
  REFERENCE_FIELD,
  REFERENCE_FAST_MATCH_MODE,
  REFERENCE_WIDE_MATCH_MODE,
  bodyRequestsFilter,
  shouldWidenReferenceSearch,
  type ReferenceWideningInput,
} from "../content/reference-search";

/** A grid body exactly as injectFilters() builds it for a Reference search. */
function gridBody(value: unknown, matchMode = REFERENCE_FAST_MATCH_MODE): string {
  return JSON.stringify({
    First: 0,
    Rows: 10,
    Filters: [
      {
        PropertyName: REFERENCE_FIELD,
        Value: value,
        MatchMode: matchMode,
        CaseSensitive: false,
        AsString: false,
      },
    ],
  });
}

/** An empty-response capture that genuinely asked for the prefix match. */
function wideningInput(overrides: Partial<ReferenceWideningInput> = {}): ReferenceWideningInput {
  return {
    value: "EE-0300",
    matchMode: REFERENCE_FAST_MATCH_MODE,
    rowCount: 0,
    rawBody: gridBody("EE-0300"),
    runActive: false,
    ...overrides,
  };
}

describe("reference-search — match mode constants", () => {
  it("keeps the fast mode a prefix match and the fallback a substring match", () => {
    expect(REFERENCE_FAST_MATCH_MODE).toBe("startswith");
    expect(REFERENCE_WIDE_MATCH_MODE).toBe("contains");
    expect(REFERENCE_FIELD).toBe("Reference");
  });
});

describe("bodyRequestsFilter", () => {
  it("reads the Filters key the portal's grid uses", () => {
    expect(bodyRequestsFilter(gridBody("EE-0300"), REFERENCE_FIELD, "startswith")).toBe(true);
  });

  it("reads the lowercase filters key too", () => {
    const body = JSON.stringify({
      First: 0,
      Rows: 10,
      filters: [{ PropertyName: REFERENCE_FIELD, MatchMode: "contains" }],
    });
    expect(bodyRequestsFilter(body, REFERENCE_FIELD, "contains")).toBe(true);
  });

  it("distinguishes the mode, the field, and unrelated filters", () => {
    const body = gridBody("EE-0300", "contains");
    expect(bodyRequestsFilter(body, REFERENCE_FIELD, "startswith")).toBe(false);
    expect(bodyRequestsFilter(body, REFERENCE_FIELD, "contains")).toBe(true);
    expect(bodyRequestsFilter(body, "TaxInvoiceNumber", "contains")).toBe(false);
  });

  it("returns false for bodies it cannot read instead of throwing", () => {
    expect(bodyRequestsFilter("not json", REFERENCE_FIELD, "startswith")).toBe(false);
    expect(bodyRequestsFilter("null", REFERENCE_FIELD, "startswith")).toBe(false);
    expect(bodyRequestsFilter(JSON.stringify({ First: 0, Rows: 10 }), REFERENCE_FIELD, "startswith")).toBe(false);
    expect(bodyRequestsFilter(JSON.stringify({ Filters: [null] }), REFERENCE_FIELD, "startswith")).toBe(false);
  });
});

describe("shouldWidenReferenceSearch", () => {
  it("widens an empty prefix search that actually asked for the prefix match", () => {
    expect(shouldWidenReferenceSearch(wideningInput())).toBe(true);
  });

  it("does not widen when the prefix search returned rows", () => {
    expect(shouldWidenReferenceSearch(wideningInput({ rowCount: 1 }))).toBe(false);
  });

  it("does not widen twice: the flipped mode is the one-shot latch", () => {
    expect(
      shouldWidenReferenceSearch(wideningInput({ matchMode: REFERENCE_WIDE_MATCH_MODE })),
    ).toBe(false);
  });

  it("does not widen while a scrape run owns the grid", () => {
    expect(shouldWidenReferenceSearch(wideningInput({ runActive: true }))).toBe(false);
  });

  it("does not widen an empty response to a request without the prefix filter", () => {
    // A request the extension sent before the filter took effect (or with no
    // Reference filter at all) says nothing about the mode being too narrow.
    expect(
      shouldWidenReferenceSearch(wideningInput({ rawBody: JSON.stringify({ First: 0, Rows: 10 }) })),
    ).toBe(false);
    expect(
      shouldWidenReferenceSearch({
        ...wideningInput(),
        rawBody: gridBody("EE-0300", REFERENCE_WIDE_MATCH_MODE),
      }),
    ).toBe(false);
  });

  it("ignores non-string values (the No. Faktur array path)", () => {
    expect(shouldWidenReferenceSearch(wideningInput({ value: ["010.000-26.00000001"] }))).toBe(false);
    expect(shouldWidenReferenceSearch(wideningInput({ value: "" }))).toBe(false);
    expect(shouldWidenReferenceSearch(wideningInput({ value: null }))).toBe(false);
  });
});
