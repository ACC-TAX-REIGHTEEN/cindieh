// Unit tests for ui-filters.ts — the pure helpers shared with main.ts.
// splitInvoiceNumbers / parseMultiInvoiceText are the critical parsing path
// for the multi-invoice filter (gap identified in the audit report).
import { describe, it, expect } from "vitest";
import { splitInvoiceNumbers, parseMultiInvoiceText } from "../content/ui-filters";

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
    expect(splitInvoiceNumbers("INV-001   INV-002")).toEqual(["INV-001", "INV-002"]);
  });

  it("does not split on a single space", () => {
    expect(splitInvoiceNumbers("INV-001 INV-002")).toEqual(["INV-001 INV-002"]);
  });

  it("trims whitespace and drops empty entries", () => {
    expect(splitInvoiceNumbers("  INV-001  \n\n INV-002 \t")).toEqual(["INV-001", "INV-002"]);
  });

  it("splits on mixed separators and runs of separators", () => {
    expect(splitInvoiceNumbers("INV-001,INV-002;;INV-003\nINV-004")).toEqual([
      "INV-001",
      "INV-002",
      "INV-003",
      "INV-004",
    ]);
  });

  it("handles CRLF line endings", () => {
    expect(splitInvoiceNumbers("INV-001\r\nINV-002\r\nINV-003")).toEqual([
      "INV-001",
      "INV-002",
      "INV-003",
    ]);
  });

  it("drops empty entries from leading/trailing separators", () => {
    expect(splitInvoiceNumbers(";INV-001;")).toEqual(["INV-001"]);
    expect(splitInvoiceNumbers(",INV-001,,INV-002,")).toEqual(["INV-001", "INV-002"]);
  });

  it("returns empty array for empty input", () => {
    expect(splitInvoiceNumbers("")).toEqual([]);
    expect(splitInvoiceNumbers("   ")).toEqual([]);
  });
});

describe("parseMultiInvoiceText", () => {
  it("returns [] for empty or whitespace-only input", () => {
    expect(parseMultiInvoiceText("")).toEqual([]);
    expect(parseMultiInvoiceText("   ")).toEqual([]);
    expect(parseMultiInvoiceText("\n\t ")).toEqual([]);
  });

  it("trims the whole input before splitting", () => {
    expect(parseMultiInvoiceText("  INV-001\nINV-002  ")).toEqual(["INV-001", "INV-002"]);
  });

  it("parses newline-separated efaktur invoice numbers", () => {
    expect(parseMultiInvoiceText("04012600023333322\n04012600023333323")).toEqual([
      "04012600023333322",
      "04012600023333323",
    ]);
  });

  it("parses comma/semicolon separated numbers", () => {
    expect(parseMultiInvoiceText("A,B;C")).toEqual(["A", "B", "C"]);
  });
});
