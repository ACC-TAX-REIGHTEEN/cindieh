/**
 * Unit tests for downloader.ts
 * Validates: Requirements 2.1, 2.2, 2.4, 2.5
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  base64ToBlob,
  downloadBlob,
  handlePdfDownload,
  generateWithholdingFilename,
  generateOutputTaxFilename,
  generateGenericPdfFilename,
  type WithholdingSlip,
} from "../content/downloader";
import { stubFakeDom, type FakeDoc, type FakeEl } from "./__mocks__/fake-dom";

// ---------------------------------------------------------------------------
// base64ToBlob
// ---------------------------------------------------------------------------

describe("base64ToBlob", () => {
  it("converts a valid PDF base64 string to a Blob with the correct MIME type", async () => {
    // Minimal valid PDF header encoded as base64
    const pdfBytes = "%PDF-1.4 test content";
    const b64 = btoa(pdfBytes);

    const blob = base64ToBlob(b64);

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("application/pdf");

    // Verify the bytes round-trip correctly
    const buffer = await blob.arrayBuffer();
    const decoded = new TextDecoder().decode(buffer);
    expect(decoded).toBe(pdfBytes);
  });

  it("uses the default MIME type of application/pdf when none is provided", () => {
    const blob = base64ToBlob(btoa("hello"));
    expect(blob.type).toBe("application/pdf");
  });

  it("uses a custom MIME type when provided", () => {
    const blob = base64ToBlob(btoa("hello"), "application/octet-stream");
    expect(blob.type).toBe("application/octet-stream");
  });

  it("produces a Blob whose size matches the decoded byte length", async () => {
    const original = "Hello, World!";
    const b64 = btoa(original);
    const blob = base64ToBlob(b64);

    expect(blob.size).toBe(original.length);
  });

  it("throws when given an empty string", () => {
    expect(() => base64ToBlob("")).toThrow();
  });

  it("throws when given an invalid base64 string", () => {
    // Contains characters outside the base64 alphabet
    expect(() => base64ToBlob("not-valid-base64!!!")).toThrow();
  });

  it("throws when given a string with non-base64 special characters", () => {
    // Characters like '!' are outside the base64 alphabet and cause atob to throw
    expect(() => base64ToBlob("aGVs!bG8=")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// generateWithholdingFilename
// ---------------------------------------------------------------------------

describe("generateWithholdingFilename", () => {
  it("formats a normal item as MM-YYYY-Nomor-Nama.pdf", () => {
    const item: WithholdingSlip = {
      WithholdingSlipsNumber: "001/PPh/2025",
      WithholdingSlipsDate: "2025-03-15T00:00:00+07:00",
      EmployerName: "PT Maju Bersama",
    };

    const filename = generateWithholdingFilename(item);

    expect(filename).toBe("03-2025-001-PPh-2025-PT Maju Bersama.pdf");
  });

  it("uses month 00 and current year when date is missing", () => {
    const currentYear = new Date().getFullYear().toString();
    const item: WithholdingSlip = {
      WithholdingSlipsNumber: "007",
      WithholdingSlipsDate: "",
      EmployerName: "Acme Corp",
    };

    const filename = generateWithholdingFilename(item);

    expect(filename).toBe(`00-${currentYear}-007-Acme Corp.pdf`);
  });

  it("uses month 00 and current year when date is invalid", () => {
    const currentYear = new Date().getFullYear().toString();
    const item: WithholdingSlip = {
      WithholdingSlipsNumber: "007",
      WithholdingSlipsDate: "not-a-date",
      EmployerName: "Acme Corp",
    };

    const filename = generateWithholdingFilename(item);

    expect(filename).toBe(`00-${currentYear}-007-Acme Corp.pdf`);
  });

  it("uses TANPA_NOMOR when WithholdingSlipsNumber is missing", () => {
    const item: WithholdingSlip = {
      WithholdingSlipsNumber: "",
      WithholdingSlipsDate: "2025-06-01T00:00:00+07:00",
      EmployerName: "PT Test",
    };

    const filename = generateWithholdingFilename(item);

    expect(filename).toBe("06-2025-TANPA_NOMOR-PT Test.pdf");
  });

  it("uses TANPA_NAMA when EmployerName is missing", () => {
    const item: WithholdingSlip = {
      WithholdingSlipsNumber: "123",
      WithholdingSlipsDate: "2025-06-01T00:00:00+07:00",
      EmployerName: "",
    };

    const filename = generateWithholdingFilename(item);

    expect(filename).toBe("06-2025-123-TANPA_NAMA.pdf");
  });

  it("replaces forbidden characters in WithholdingSlipsNumber with hyphens", () => {
    const item: WithholdingSlip = {
      WithholdingSlipsNumber: "001/PPh\\2025?test*num:ber|x\"y<z>",
      WithholdingSlipsDate: "2025-01-01T00:00:00+07:00",
      EmployerName: "Corp",
    };

    const filename = generateWithholdingFilename(item);

    // All forbidden chars in number become '-'
    expect(filename).toMatch(/^01-2025-001-PPh-2025-test-num-ber-x-y-z--Corp\.pdf$/);
  });

  it("replaces forbidden characters in EmployerName with underscores", () => {
    const item: WithholdingSlip = {
      WithholdingSlipsNumber: "001",
      WithholdingSlipsDate: "2025-01-01T00:00:00+07:00",
      EmployerName: "PT/Test\\Corp?Name*With:Special|Chars\"And<More>",
    };

    const filename = generateWithholdingFilename(item);

    // Forbidden chars in name become '_'
    expect(filename).toContain("PT_Test_Corp_Name_With_Special_Chars_And_More_");
  });

  it("truncates EmployerName to 50 characters", () => {
    const longName = "A".repeat(100);
    const item: WithholdingSlip = {
      WithholdingSlipsNumber: "001",
      WithholdingSlipsDate: "2025-01-01T00:00:00+07:00",
      EmployerName: longName,
    };

    const filename = generateWithholdingFilename(item);
    const namePart = filename.replace("01-2025-001-", "").replace(".pdf", "");

    expect(namePart.length).toBe(50);
  });

  it("always ends with .pdf", () => {
    const item: WithholdingSlip = {
      WithholdingSlipsNumber: "X",
      WithholdingSlipsDate: "2025-05-10T00:00:00+07:00",
      EmployerName: "Y",
    };

    expect(generateWithholdingFilename(item)).toMatch(/\.pdf$/);
  });
});

// ---------------------------------------------------------------------------
// generateOutputTaxFilename
// ---------------------------------------------------------------------------

describe("generateOutputTaxFilename", () => {
  it("formats a normal item as 'Reference - InvoiceNumber.pdf'", () => {
    const item = {
      Reference: "REF-001",
      LetterNumber: "INV-2025-001",
    };

    const filename = generateOutputTaxFilename(item);

    expect(filename).toBe("REF-001 - INV-2025-001.pdf");
  });

  it("uses the explicit reference argument over item.Reference", () => {
    const item = {
      Reference: "ITEM_REF",
      LetterNumber: "INV-001",
    };

    const filename = generateOutputTaxFilename(item, "EXPLICIT_REF");

    expect(filename).toBe("EXPLICIT_REF - INV-001.pdf");
  });

  it("falls back to item.Reference when no explicit reference is provided", () => {
    const item = {
      Reference: "ITEM_REF",
      LetterNumber: "INV-001",
    };

    const filename = generateOutputTaxFilename(item);

    expect(filename).toBe("ITEM_REF - INV-001.pdf");
  });

  it("uses TANPA_REFERENSI when reference is missing from both argument and item", () => {
    const item = {
      LetterNumber: "INV-001",
    };

    const filename = generateOutputTaxFilename(item);

    expect(filename).toBe("TANPA_REFERENSI - INV-001.pdf");
  });

  it("uses TaxInvoiceNumber as fallback when LetterNumber is missing", () => {
    const item = {
      Reference: "REF-001",
      TaxInvoiceNumber: "TAX-2025-999",
    };

    const filename = generateOutputTaxFilename(item);

    expect(filename).toBe("REF-001 - TAX-2025-999.pdf");
  });

  it("uses 000 when both LetterNumber and TaxInvoiceNumber are missing", () => {
    const item = {
      Reference: "REF-001",
    };

    const filename = generateOutputTaxFilename(item);

    expect(filename).toBe("REF-001 - 000.pdf");
  });

  it("replaces forbidden characters in reference with hyphens", () => {
    const item = { LetterNumber: "INV-001" };

    const filename = generateOutputTaxFilename(item, "REF/WITH\\SPECIAL?CHARS*");

    expect(filename).toBe("REF-WITH-SPECIAL-CHARS- - INV-001.pdf");
  });

  it("replaces forbidden characters in invoice number with hyphens", () => {
    const item = {
      Reference: "REF-001",
      LetterNumber: "INV/2025\\001",
    };

    const filename = generateOutputTaxFilename(item);

    expect(filename).toBe("REF-001 - INV-2025-001.pdf");
  });

  it("always ends with .pdf", () => {
    const item = { Reference: "R", LetterNumber: "N" };

    expect(generateOutputTaxFilename(item)).toMatch(/\.pdf$/);
  });
});

// ---------------------------------------------------------------------------
// generateGenericPdfFilename
// ---------------------------------------------------------------------------

describe("generateGenericPdfFilename", () => {
  it("formats generic PDF filename using source and reference/number fields", () => {
    const item = { Reference: "REF-A2-001" };
    expect(generateGenericPdfFilename(item, "SPT_A2")).toBe("SPT_A2-REF-A2-001.pdf");
  });

  it("falls back to TANPA_NOMOR when item has no reference fields", () => {
    const item = {};
    expect(generateGenericPdfFilename(item, "PPH_21_L1A")).toBe("PPH_21_L1A-TANPA_NOMOR.pdf");
  });

  it("sanitizes forbidden characters in source and reference", () => {
    const item = { DocumentNumber: "DOC/123\\456" };
    expect(generateGenericPdfFilename(item, "UNKNOWN/SOURCE")).toBe("UNKNOWN-SOURCE-DOC-123-456.pdf");
  });
});

// ---------------------------------------------------------------------------
// downloadBlob / handlePdfDownload (DOM)
// ---------------------------------------------------------------------------
// The browser end of a bulk PDF run: build the blob, pick the filename for the
// page's source, and save it through a temporary anchor. It was the module's
// biggest uncovered block because it needs an anchor, a URL API and a DOM to
// click through — the fake DOM now provides all three, so what each source
// NAMES its file is asserted here rather than read.

describe("downloadBlob / handlePdfDownload (DOM)", () => {
  let doc: FakeDoc;
  /** Every element the module created, in order — the download anchor is one. */
  let created: FakeEl[];
  let createObjectURL: ReturnType<typeof vi.spyOn>;
  let revokeObjectURL: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    doc = stubFakeDom().doc;
    created = [];
    const create = doc.createElement.bind(doc);
    vi.spyOn(doc, "createElement").mockImplementation((tag) => {
      const el = create(tag);
      created.push(el);
      return el;
    });
    createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:cindieh");
    revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  /** The download anchor the last call built. */
  function lastAnchor(): FakeEl {
    const anchor = created[created.length - 1];
    expect(anchor.tagName).toBe("a");
    return anchor;
  }

  it("saves the blob through a temporary anchor and releases the object URL", () => {
    downloadBlob(new Blob(["pdf"], { type: "application/pdf" }), "hasil.pdf");

    const anchor = lastAnchor();
    expect(anchor.href).toBe("blob:cindieh");
    expect(anchor.download).toBe("hasil.pdf");
    expect(anchor.clicks).toBe(1);
    // The anchor must not stay in the page: it is a click target, not UI.
    expect(doc.body.children).not.toContain(anchor);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:cindieh");
  });

  it("names a PPN Keluaran file after its reference and letter number", () => {
    handlePdfDownload(btoa("%PDF-1.4"), {
      Reference: "SZ-0447-07-26",
      LetterNumber: "010.000-26.00000001",
    }, "OUTPUT_TAX");

    expect(lastAnchor().download).toBe("SZ-0447-07-26 - 010.000-26.00000001.pdf");
  });

  it("names a PPN Masukan file from the tax invoice number", () => {
    handlePdfDownload(btoa("%PDF-1.4"), { TaxInvoiceNumber: "010.000-26.00000002" }, "INPUT_TAX");

    expect(lastAnchor().download).toBe("TANPA_REFERENSI - 010.000-26.00000002.pdf");
  });

  it("names a retur file from its return number, for either retur page", () => {
    const item = { ReturnNumber: "RET-001", ReturnInvoiceNumber: "000123" };

    handlePdfDownload(btoa("%PDF-1.4"), item, "OUTPUT_RETURN");
    expect(lastAnchor().download).toBe("RET-001 - 000123.pdf");

    created.length = 0;
    handlePdfDownload(btoa("%PDF-1.4"), item, "INPUT_RETURN");
    expect(lastAnchor().download).toBe("RET-001 - 000123.pdf");
  });

  it("names a withholding file MM-YYYY-Nomor-Nama", () => {
    handlePdfDownload(btoa("%PDF-1.4"), {
      WithholdingSlipsNumber: "01-2026-BP-001",
      WithholdingSlipsDate: "2026-01-31T00:00:00+07:00",
      EmployerName: "PT Contoh",
    }, "WITHHOLDING_SLIPS");

    expect(lastAnchor().download).toBe("01-2026-01-2026-BP-001-PT Contoh.pdf");
  });

  it("falls back to the generic name for a source it has no rule for", () => {
    handlePdfDownload(btoa("%PDF-1.4"), { Reference: "A2-001" }, "SPT_A2");

    // The name still carries the source, so an unexpected page produces files
    // that can be told apart rather than a pile called TANPA_NOMOR.pdf.
    expect(lastAnchor().download).toBe("SPT_A2-A2-001.pdf");
  });

  it("fails before touching the DOM when the payload is not base64", () => {
    expect(() => handlePdfDownload("", { Reference: "X" }, "OUTPUT_TAX")).toThrow();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(created).toHaveLength(0);
  });
});
