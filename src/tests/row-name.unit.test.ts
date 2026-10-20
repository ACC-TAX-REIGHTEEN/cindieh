import { describe, it, expect } from "vitest";
import {
  ROW_NAME_SPECS,
  UNIDENTIFIED_ROW_NAME,
  WITHHOLDING_SLIP_NUMBER_FIELDS,
  rowInvoiceNumber,
  rowLabel,
  rowName,
} from "../content/row-name";

// What a scraped row is CALLED.
//
// The label a row is reported under and the name the file it downloads lands
// as have to be the same row: the download ORDER is the only thing that ties a
// failure back to a row once the run is over, so a run that reports "4 gagal"
// has to be able to say WHICH four.
//
// These are the cases where the two used to disagree — the panel's ladder and
// the file's ladder were different lists, and a row carrying more than one
// naming field was named one way in the panel and another way on disk.

// ── The label ──────────────────────────────────────────

describe("rowLabel", () => {
  it("leads with the Referensi for an e-faktur row", () => {
    expect(
      rowLabel(
        { Reference: "SZ-0447/07/26", TaxInvoiceNumber: "010.000-26.00000001", LetterNumber: "L1" },
        "OUTPUT_TAX",
      ),
    ).toBe("SZ-0447/07/26");
  });

  it("falls back to the invoice number when the row has no Referensi", () => {
    expect(
      rowLabel({ TaxInvoiceNumber: "010.000-26.00000001", LetterNumber: "L1" }, "INPUT_TAX"),
    ).toBe("010.000-26.00000001");
  });

  it("uses the slip number first on a Bukti Potong row", () => {
    expect(
      rowLabel(
        { WithholdingSlipNumber: "BP-001", WithholdingSlipsNumber: "BP-001", Reference: "X" },
        "WITHHOLDING_SLIPS",
      ),
    ).toBe("BP-001");
  });

  it("accepts the second Bukti Potong spelling too", () => {
    // One list, two spellings: the bulk-PDF flow carries the singular one and
    // the grid capture the plural one, and a slip can arrive with either.
    expect(rowLabel({ WithholdingSlipsNumber: "BP-777" }, "WITHHOLDING_SLIPS")).toBe("BP-777");
    expect(rowLabel({ WithholdingSlipNumber: "BP-778" }, "WITHHOLDING_SLIPS")).toBe("BP-778");
  });

  it("never returns an empty string, so a failure is always attributable", () => {
    expect(rowLabel({ Id: 7 }, "OUTPUT_TAX")).toBe(UNIDENTIFIED_ROW_NAME);
    expect(rowLabel({}, "WITHHOLDING_SLIPS")).toBe(UNIDENTIFIED_ROW_NAME);
    expect(rowLabel({ Reference: "   " }, "OUTPUT_TAX")).toBe(UNIDENTIFIED_ROW_NAME);
  });

  it("treats null and undefined identifiers as absent", () => {
    expect(
      rowLabel({ Reference: null, TaxInvoiceNumber: undefined, LetterNumber: "L9" }, "OUTPUT_TAX"),
    ).toBe("L9");
  });

  // ── The cases the two ladders used to disagree on ──

  it("names a RETUR row by its return number, the way the file is named", () => {
    // A retur carries BOTH a Referensi and a return number. The panel used to
    // lead with the Referensi while the file led with the return number, so a
    // failure report named a row the downloads folder did not.
    const row = { Reference: "REF-001", ReturnNumber: "RET-001", TaxInvoiceNumber: "010.1" };
    expect(rowLabel(row, "OUTPUT_RETURN")).toBe("RET-001");
    expect(rowName(row, "OUTPUT_RETURN")).toBe("RET-001");
  });

  it("falls back to the Referensi for a retur row that carries no return number", () => {
    expect(rowLabel({ Reference: "REF-001" }, "OUTPUT_RETURN")).toBe("REF-001");
  });

  it("names an e-faktur row by the invoice number the file carries", () => {
    // PPN Keluaran's invoice is the LetterNumber and PPN Masukan's is the
    // TaxInvoiceNumber, so the label follows the grid — otherwise the panel
    // named a row the file named differently.
    const row = { TaxInvoiceNumber: "TAX-999", LetterNumber: "INV-001" };
    expect(rowLabel(row, "OUTPUT_TAX")).toBe("INV-001");
    expect(rowLabel(row, "INPUT_TAX")).toBe("TAX-999");
  });

  it("names a Bukti Potong row by its slip number in EITHER spelling", () => {
    // The singular spelling used to be honoured by the panel and ignored by
    // the file, so a slip was reported as "BP-001" and filed as "TANPA_NOMOR".
    expect(rowLabel({ WithholdingSlipNumber: "BP-001" }, "WITHHOLDING_SLIPS")).toBe("BP-001");
    expect(rowName({ WithholdingSlipNumber: "BP-001" }, "WITHHOLDING_SLIPS")).toBe("BP-001");
    expect(rowName({ WithholdingSlipsNumber: "BP-002" }, "WITHHOLDING_SLIPS")).toBe("BP-002");
  });
});

// ── The two slots ──────────────────────────────────────

describe("rowName and rowInvoiceNumber", () => {
  it("read the row's own name and the invoice it belongs to", () => {
    const row = { Reference: "REF-001", LetterNumber: "INV-001" };
    expect(rowName(row, "OUTPUT_TAX")).toBe("REF-001");
    expect(rowInvoiceNumber(row, "OUTPUT_TAX")).toBe("INV-001");
  });

  it("read PPN Masukan's invoice from the TaxInvoiceNumber", () => {
    const row = { Reference: "REF-001", TaxInvoiceNumber: "TAX-001", LetterNumber: "INV-001" };
    expect(rowInvoiceNumber(row, "INPUT_TAX")).toBe("TAX-001");
  });

  it("read a retur's invoice from the invoice it credits", () => {
    const row = { ReturnNumber: "RET-001", ReturnInvoiceNumber: "000123" };
    expect(rowName(row, "OUTPUT_RETURN")).toBe("RET-001");
    expect(rowInvoiceNumber(row, "OUTPUT_RETURN")).toBe("000123");
  });

  it("read nothing for a row that carries neither", () => {
    expect(rowName({ Id: 7 }, "OUTPUT_TAX")).toBe("");
    expect(rowInvoiceNumber({ Id: 7 }, "OUTPUT_TAX")).toBe("");
  });

  it("read nothing for a grid with no invoice beside its name", () => {
    expect(rowInvoiceNumber({ Reference: "R" }, "WITHHOLDING_SLIPS")).toBe("");
    expect(rowInvoiceNumber({ Reference: "R" }, "SPT_A2")).toBe("");
  });

  it("fall back to the default ladder for a source the module does not know", () => {
    // A page the extension does not have a rule for still has to name its rows.
    expect(rowName({ Reference: "A2-001" }, "SPT_A2")).toBe("A2-001");
    expect(rowName({ DocumentNumber: "D-1" }, "SOMETHING_ELSE")).toBe("D-1");
  });
});

// ── The declaration ────────────────────────────────────

describe("the row-name declaration", () => {
  it("gives every export source a rule, so a new one cannot ship without one", () => {
    for (const [source, spec] of Object.entries(ROW_NAME_SPECS)) {
      expect(spec.name.length, `${source} has no naming field`).toBeGreaterThan(0);
    }
  });

  it("reads the withholding slip number from ONE list of two spellings", () => {
    expect(WITHHOLDING_SLIP_NUMBER_FIELDS).toEqual([
      "WithholdingSlipNumber",
      "WithholdingSlipsNumber",
    ]);
    // The exported column and the file's name read the same list, so a slip's
    // two spellings cannot be spelled differently in two places.
    expect(ROW_NAME_SPECS.WITHHOLDING_SLIPS.name).toContain("WithholdingSlipNumber");
    expect(ROW_NAME_SPECS.WITHHOLDING_SLIPS.name).toContain("WithholdingSlipsNumber");
  });
});
