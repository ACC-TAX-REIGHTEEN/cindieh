# Pengecekan runs on the Retur grids, and a row's identity is a page fact of its own

The accuracy check ran on the two PPN INVOICE grids, because `isVatInvoicePage()` was its
page gate — a fact named for what those two grids' rows are, doing duty as the answer to a
question about the check. A retur nota carries the same three amounts
(`SellingPrice`, `OtherTaxBase`, `VAT`), so the check applies there too, and the gate was
wrong. Four facts replace the one that was standing in for them:

- **`isCheckerPage()`** — does the check run here? All four e-Faktur PPN grids: Keluaran,
  Masukan, Retur Keluaran, Retur Masukan. Named apart from `isEfakturPage()`, which is the
  same four grids today and the year-wide EXPORT's gate: a fifth grid added to one must be a
  deliberate decision for the other.
- **`checkerRowIdentity()`** — what names ONE row of the result here? `"referensi"` on the two
  PPN grids (the row is an invoice), `"no-retur"` on the two Retur grids (the row is a retur
  nota, and the grid has no Referensi column at all).
- **`counterpartyIsBuyer()`** — whose invoice do this page's rows carry? True on PPN Keluaran
  AND on Retur PPN Keluaran, whose rows carry `BuyerTIN` / `BuyerTaxpayerNameClear` exactly as
  the invoice they return does. `isOutputTaxPage()` answers which GRID this is, and Retur
  Keluaran is not the output-tax grid, so a column reading "Nama Penjual" there would name the
  wrong party.
- **`isPanelPage()`** — does the overlay have a tab to offer? `isCheckerPage() ||
  referenceIsIdentity()`. Asked by the keyboard shortcut and the toolbar entry point, which
  open the OVERLAY and must not declare it unusable because ONE tab's gate said no. The
  landing tab is still decided by `ui-panel.ts` from the two tab gates.

`isVatInvoicePage()` keeps its own meaning — the two grids whose rows are the taxpayer's
invoices — and keeps being what `hasReferenceFilter()` reads; it loses only the claim that it
says where the check runs.

`CHECKER_IDENTITIES` (result-columns.ts) is the one table that turns a row identity into
words, read by the panel's grid AND by the XLSX/CSV sheet, so a retur row cannot be a
"No Retur" on screen and a "Referensi" in the file:

| identity | column | date column | cell |
|---|---|---|---|
| `referensi` | Referensi | Tanggal | `Reference`, falling back to `TaxInvoiceNumber` |
| `no-retur` | No Retur | Tanggal Retur | `ReturnNumber`, falling back to `TaxInvoiceNumber` |

Rationale:

1. **The check never was invoice-specific.** It tests one row's arithmetic against one chosen
   Acuan; the grid decides only which fields carry the three amounts, and a retur row sends
   the same three. Withholding slips and the SPT sheets stay out, and for the same reason they
   were out before: they do not carry DPP / DPP Nilai Lain / PPN in this shape.
2. **Four questions, four facts (the lesson of ADR-0021).** A retur grid answers `false` to
   `isOutputTaxPage`, `false` to `referenceIsIdentity` and `false` to `hasReferenceFilter`
   while `true` to `isCheckerPage`. One predicate asked to answer all of them could only get
   three right — which is exactly how the Referensi filter came to be withheld from PPN
   Masukan, and how the checker's counterparty column would have read "Nama Penjual" on a
   retur nota that carries the buyer.
3. **The identity is a page fact; the hand-back is not.** The checker's first column and its
   double-click both read the row's identity, but only the double-click cares whether a filter
   exists to search into: no Referensi filter is injected on the retur grids, so
   `canSearchInGrid` (the FILTER's fact) refuses the offer there while the column still names
   the row honestly. Gating the column on the filter's fact, or the search on the identity's,
   would each lose one of the two.
4. **A retur row's own date is its own field.** `ReturnDate` joins `invoiceDate` rather than
   extending the fallback chain: a retur row carries BOTH dates (it names the invoice it
   returns), so a chain could only ever have produced one of them. The identity table picks
   the pair — a retur row is dated by its retur date, an invoice row by its invoice date.

Consequences:

- A retur grid's result table and exported sheet identify a row by its NO RETUR, and a row
  with no NO RETUR falls back to the invoice number, exactly as a row with no Referensi does
  on the invoice grids.
- `ReturnNumber` and `ReturnDate` are carried on `CheckResult` beside `taxInvoiceNumber` and
  `invoiceDate`; the checker's arithmetic, its benchmarks, thresholds, statuses, status filter
  and the popup's stored defaults are untouched.
- `currentGridLabel()` names the four grids (its progress line said "PPN Masukan" on a retur
  grid before), and the panel key's gate is `isPanelPage()` — so Ctrl+Shift+B opens
  Pengecekan on a retur grid, where it is the only tab offered.
- README.md and the microsite say which four pages the check runs on, and the manual loop
  gains one row: on both Retur grids the tab must appear without the Komparator's, the column
  must read "No Retur"/"Tanggal Retur", the exported file must carry the same headers, and a
  double-click must do nothing (there is no filter to search into).

Status: accepted.
