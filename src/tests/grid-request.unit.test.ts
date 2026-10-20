import { describe, expect, it } from "vitest";
import {
  GRID_FILTER_NAMES,
  filterEntry,
  filterName,
  filterRawValue,
  filterValue,
  filterValueOf,
  filtersKeyOf,
  filtersOf,
  findFilter,
  parseGridBody,
} from "../content/grid-request";

// The shape of a Coretax grid request's body, in ONE place.
//
// Two rules carry the weight here:
//
//   1. a filter is found by its WHOLE name — a name that merely resembles the
//      one asked for is a DIFFERENT filter, and treating it as one is how a
//      file ends up named after a filter its rows never came from;
//   2. a body is answered under the key it was read from — a filter written
//      under the key the portal did not send is a filter the portal never
//      receives.
//
// Everything else is tolerance: the portal has been observed to spell the
// body and its entries in more than one way, and a body that parses is a body
// whose filters are worth reading.

// ── Reading the body ──────────────────────────────────

describe("parseGridBody", () => {
  it("reads a body", () => {
    const body = parseGridBody('{"First":0,"Filters":[]}');
    expect(body).toEqual({ First: 0, Filters: [] });
  });

  it.each([
    ["unparseable JSON", "{not json"],
    ["an empty string", ""],
    ["a JSON value that is not an object", "42"],
    ["a JSON null", "null"],
  ])("reads no body from %s", (_label, raw) => {
    // null and not an empty body: "a body I could not read" and "a body with
    // nothing in it" are answered differently when a filter is written into it.
    expect(parseGridBody(raw)).toBeNull();
  });
});

describe("filtersKeyOf", () => {
  it("answers the standard spelling for a body that carries it", () => {
    expect(filtersKeyOf({ Filters: [] })).toBe("Filters");
  });

  it("answers a body's own spelling when it uses the other one", () => {
    // The portal reads the key it sent, so a body that spells it `filters` must
    // be answered with `filters` — a filter written under `Filters` would be a
    // filter the portal never received.
    expect(filtersKeyOf({ filters: [] })).toBe("filters");
  });

  it("answers the standard spelling for a body that could not be read", () => {
    // There is nothing else to go on, and it is the spelling the portal is
    // observed to send.
    expect(filtersKeyOf(null)).toBe("Filters");
  });

  it("answers the other spelling for a body that names neither", () => {
    expect(filtersKeyOf({})).toBe("filters");
  });

  it("answers the spelling a body NAMES, even when it holds no list", () => {
    // The key follows the list; a body with no list is answered with the
    // spelling it names, so a filter written into it lands where the body
    // already put its filters.
    expect(filtersKeyOf({ Filters: undefined })).toBe("Filters");
    expect(filtersKeyOf({ filters: undefined })).toBe("filters");
  });
});

describe("filtersOf", () => {
  it("reads the list the body carries", () => {
    const filters = [{ PropertyName: "TaxInvoicePeriod", Value: "TD.00708" }];
    expect(filtersOf({ Filters: filters })).toEqual(filters);
  });

  it("reads the list under the other spelling too", () => {
    const filters = [{ PropertyName: "TaxInvoicePeriod", Value: "TD.00708" }];
    expect(filtersOf({ filters: filters })).toEqual(filters);
  });

  it("reads no list from a body that carries none", () => {
    expect(filtersOf({})).toEqual([]);
  });

  it("reads the list even when the body names the other spelling", () => {
    // Reading and writing are two questions: a body that holds its list under
    // one spelling still has that list READ.
    const filters = [{ PropertyName: "TaxInvoicePeriod", Value: "TD.00708" }];
    expect(filtersOf({ Filters: undefined, filters: filters })).toEqual(filters);
  });

  it("reads no list from a body that could not be read", () => {
    expect(filtersOf(null)).toEqual([]);
  });
});

// ── Reading a filter ──────────────────────────────────

describe("filterName and filterValue", () => {
  it("read the spellings the portal sends", () => {
    const filter = { PropertyName: "TaxInvoicePeriod", Value: "TD.00708" };
    expect(filterName(filter)).toBe("TaxInvoicePeriod");
    expect(filterRawValue(filter)).toBe("TD.00708");
    expect(filterValue(filter)).toBe("TD.00708");
  });

  it("read the lower-cased spellings too", () => {
    const filter = { propertyName: "TaxInvoicePeriod", value: "TD.00708" };
    expect(filterName(filter)).toBe("TaxInvoicePeriod");
    expect(filterRawValue(filter)).toBe("TD.00708");
    expect(filterValue(filter)).toBe("TD.00708");
  });

  it("trim the value, and read nothing as an empty string", () => {
    expect(filterValue({ PropertyName: "X", Value: "  TD.00708  " })).toBe("TD.00708");
    expect(filterValue({ PropertyName: "X" })).toBe("");
    expect(filterValue(undefined)).toBe("");
  });

  it("read a numeric value as the number it is", () => {
    expect(filterRawValue({ PropertyName: "TaxInvoiceYear", Value: 2026 })).toBe(2026);
    expect(filterValue({ PropertyName: "TaxInvoiceYear", Value: 2026 })).toBe("2026");
  });

  it("read a name that is not a string as no name at all", () => {
    // A body is not obliged to carry a name the extension can use; a number
    // where a name belongs is a filter this module cannot name.
    expect(filterName({ PropertyName: 7 as unknown as string })).toBe("");
    expect(filterName({})).toBe("");
  });
});

// ── Finding a filter ──────────────────────────────────

describe("findFilter", () => {
  const filters = [
    { PropertyName: "TaxInvoiceStatus", Value: "CREATED" },
    { PropertyName: "TaxInvoicePeriod", Value: "TD.00708" },
    { PropertyName: "TaxInvoiceYear", Value: "2026" },
  ];

  it("finds a filter by its whole name", () => {
    expect(findFilter(filters, "TaxInvoiceYear")).toEqual({
      PropertyName: "TaxInvoiceYear",
      Value: "2026",
    });
  });

  it("finds it whatever the case", () => {
    expect(findFilter(filters, "taxinvoiceyear")?.Value).toBe("2026");
  });

  it("does NOT find a filter whose name merely contains the one asked for", () => {
    // THE rule. `TaxInvoicePeriodStatus` is a different filter, and a body
    // carrying it BEFORE `TaxInvoicePeriod` used to name the file after the
    // status while the rows came from the period.
    expect(findFilter(filters, "TaxInvoicePeriod")).toEqual({
      PropertyName: "TaxInvoicePeriod",
      Value: "TD.00708",
    });
    expect(findFilter([{ PropertyName: "TaxInvoicePeriodStatus", Value: "x" }], "TaxInvoicePeriod")).toBeUndefined();
    expect(findFilter([{ PropertyName: "MasaPajak", Value: "x" }], "Masa")).toBeUndefined();
  });

  it("finds nothing when no filter carries that name", () => {
    expect(findFilter(filters, "TaxInvoiceNumber")).toBeUndefined();
  });
});

describe("filterValueOf", () => {
  it("takes the value of the first name the filters carry", () => {
    const filters = [
      { PropertyName: "TaxInvoiceYear", Value: "2026" },
      { PropertyName: "TaxInvoicePeriod", Value: "TD.00708" },
    ];
    expect(filterValueOf(filters, GRID_FILTER_NAMES.period)).toBe("TD.00708");
    expect(filterValueOf(filters, GRID_FILTER_NAMES.year)).toBe("2026");
  });

  it("lets the NAMES decide the order, not the body", () => {
    // A list is a priority: the specific name wins over the general one,
    // whichever order the body sent them in.
    const filters = [
      { PropertyName: "Period", Value: "general" },
      { PropertyName: "TaxInvoicePeriod", Value: "specific" },
    ];
    expect(filterValueOf(filters, GRID_FILTER_NAMES.period)).toBe("specific");
  });

  it("reads nothing when no name is carried", () => {
    expect(filterValueOf([{ PropertyName: "Reference", Value: "R-1" }], GRID_FILTER_NAMES.period)).toBe("");
  });

  it("reads nothing when the named filter carries no value", () => {
    expect(filterValueOf([{ PropertyName: "Period", Value: "" }], GRID_FILTER_NAMES.period)).toBe("");
  });
});

// ── Writing a filter ──────────────────────────────────

describe("filterEntry", () => {
  it("writes the shape the portal sends", () => {
    expect(filterEntry("TaxInvoiceNumber", "001")).toEqual({
      PropertyName: "TaxInvoiceNumber",
      Value: "001",
      MatchMode: "equals",
      CaseSensitive: false,
      AsString: false,
    });
  });

  it("takes the match mode it is given", () => {
    expect(filterEntry("Reference", "R-1", "contains").MatchMode).toBe("contains");
  });
});
