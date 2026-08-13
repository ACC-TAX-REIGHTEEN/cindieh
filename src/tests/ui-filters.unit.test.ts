// Unit tests for ui-filters.ts — the pure helpers shared with main.ts.
import { describe, it, expect } from "vitest";
import { splitInvoiceNumbers } from "../content/ui-filters";

describe("splitInvoiceNumbers", () => {
  it("splits on newlines", () => {
    expect(splitInvoiceNumbers("INV-001\nINV-002")).toEqual(["INV-001", "INV-002"]);
  });

  it("splits on semicolons and commas", () => {
    expect(splitInvoiceNumbers("INV-001;INV-002,INV-003")).toEqual([
      "INV-001",
      "INV-002",
      "INV-003",
    ]);
  });

  it("splits on two or more spaces", () => {
    expect(splitInvoiceNumbers("INV-001  INV-002")).toEqual(["INV-001", "INV-002"]);
  });

  it("trims whitespace and drops empty entries", () => {
    expect(splitInvoiceNumbers("  INV-001  \n\n INV-002 \t")).toEqual(["INV-001", "INV-002"]);
  });

  it("returns empty array for empty input", () => {
    expect(splitInvoiceNumbers("")).toEqual([]);
    expect(splitInvoiceNumbers("   ")).toEqual([]);
  });
});
