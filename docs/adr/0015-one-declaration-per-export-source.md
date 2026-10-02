# Each export source is one declaration

`export-source.ts` owns one `ExportSourceSpec` per `ExportSource`: the columns its cleaned export has, its filename prefix, its schema-drift warning, and the rules for naming the file. `mapColumns` turns those declarations into cells. `exporter.ts` keeps the download plumbing, the filename period ladder, and the one `debugWarn` call.

This replaces five hand-written copies of the same column mapper inside `exporter.ts`. They were not five sources' worth of variation — they were five *shapes* of mapper, and the sources that shared a shape each got their own copy:

| shape | sources | copy |
|---|---|---|
| mapped tax columns | PPN Keluaran, PPN Masukan, both retur | one helper called from four branches, plus a fifth inline copy for the default arm, because the helper's month/year extraction needed pre-computing per row |
| multi-spelling columns | Bukti Potong | bespoke ~80 lines with its own `pick`, its own `format` union, and its own drift check |
| fixed pass-through | Lampiran A2 | bespoke, with its own date handling and its own drift check |
| captured pass-through | Lampiran B2, the four PPh 21 lampiran | bespoke, no drift check at all |
| raw mode | all eleven | a fourth copy of the ISO-datetime regex |

Alongside them sat three more passes over the same eleven values: `PREFIX_MAP`, `generateDynamicFilename`'s period ladder (with its own per-source special cases for the retur grids, the PPh 21 sheets and Lampiran A2), and `downloader.ts`'s PDF filename switch. A twelfth grid meant editing all of them, and the failure mode was silent: the old default arm exported PPN Keluaran columns and an `FPK-` prefix for any source it did not recognise.

## What the column type has to express

The declarations only work because one `ExportColumn` — a label, a list of candidate field names, and an optional reader — covers all four shapes:

- **The `||` fallback chains were already `sources` lists.** `row[TaxInvoicePeriod] || row[TaxPeriodMonth] || row[TaxPeriod]` is a candidate list, and `PeriodCredit` / `YearCredit` turned out to be chains with a *different head* over the same two fallbacks, which is the kind of detail that reads as two plain columns until you trace it.
- **Candidate spellings are not redundancy.** Bukti Potong rows spell the slip number `WithholdingSlipsNumber` in the PDF-filename path and `WithholdingSlipNumber` in the bulk-PDF path. `sources` names that, where the old bespoke block encoded it in a bespoke resolver.
- **A date can seed several columns.** A slip row has no tax-period field at all, so `TANGGAL`, `MASA` and `TAHUN` all read `WithholdingSlipsDate`, through three different readers.
- **"The portal decides" is a different plan, not a different column.** Lampiran B2 and the PPh 21 lampiran have no column set of their own, so `ColumnPlan` has a `captured` variant whose columns are the captured fields. Raw mode is the same variant, which is why its fourth copy of the ISO regex disappeared.

The `captured` variant is also why there is no drift warning for those sources: their columns *are* the API response, so "none of them matched" is the normal case rather than a signal.

## The type is the point, not the deduplication

`SPECS` is a `Record<ExportSource, ExportSourceSpec>`, so adding a source to the union without declaring it is a compile error. Previously that grid exported the wrong spreadsheet until a human noticed. The deleted duplication is worth having, but a mechanism that cannot go stale is worth more.

`PREFIX_MAP` is gone rather than derived: it had a `default` key, and a `default` prefix is how the failure mode above started. `getExportSourceSpec` resolves an absent or unrecognised source to PPN Keluaran's *whole declaration*, which keeps the fallback the old code had (a property test still pins it for arbitrary unrecognised strings) while giving it the columns too.

## Why the ISO-datetime helper lives in tax-date

The catch — reformat a value only if it looks like an ISO datetime — is a date *shape test*, and it appeared three times as a hand-rolled `/^\d{4}-\d{2}-\d{2}T/` outside `tax-date.ts`. ADR-0004 puts date parsing there and says not to hand-roll these. `formatIsoDateTime` is deliberately narrower than `formatDate`: a column whose job is to catch an undeclared timestamp must leave a pure calendar date alone, and `formatDate("2026-03-04")` would rewrite it.

## Why not

- **`downloader.ts`'s PDF filename switch is left alone.** It is a genuine fourth ladder over these sources, and folding it in would be consistent. It was excluded for cost, not oversight: that file is in the PDF download path, so changing it makes a portal verification run mandatory — the Network + download-list evidence in AGENTS.md, all six download checks — and it buys nothing for column mapping. The spec has room for a `pdfNamer` discriminator whenever someone wants to spend that verification budget on it.
- **`page-context.ts`'s URL predicates and `inferCapturedSource` are left alone.** Those answer "which page or request is this", at capture time, in whichever world did the capturing; the spec answers "what does this source's export look like", at export time. Merging them would make MAIN-world request detection depend on export shape, and would put a `location.href` predicate in a module that is otherwise pure and testable without a page.
- **The schema-drift warning is not unified into one message.** Each source keeps its own wording, because the wording names the grid a developer will look for in the log. They now share one *condition*, which is the part that had drifted.

## Behaviour changes

Three, all deliberately, and all confined to the debug log:

1. A row that matches a source's columns only through a **fallback spelling** no longer warns about drift. The old check asked whether the *primary* fields were all null while the fallback chain had just filled the cells successfully, so it warned about a working export. The check now asks whether the row matched anything we declared.
2. A Bukti Potong row whose only period signal is an **empty-string slip date** no longer warns. `pick` treated `""` as absent; the column readers do not, because the sheet it produces is correct.
3. The drift payload's `expected` lists **every candidate spelling** rather than one per column, since that is the field someone debugging a schema change needs to see.

## Consequences

- **`exporter.ts` is 675 → 381 lines**, and `dist/cindieh-chrome/content/main.js` is slightly smaller than before the extraction (80,541 → 80,394 bytes) despite gaining a module: branching logic became data. SheetJS remains a separate chunk and remains off the page-load path.
- **`export-source.ts` is 100% on all four coverage metrics.** The branches it removed were the least-tested in the project — `exporter.ts` sat at 81.1% branch because the bespoke arms were barely exercised; it is now 84.5%.
- **No PDF-download-path file changed, so this needs no portal verification.** That is a deliberate consequence of the scope decision above, not luck: `scraper.ts`, `scraper-pdf.ts`, `scraper-fetch.ts`, `scraper-nets.ts`, `scraper-xhr-patches.ts`, `scraper-xhr.ts` and `downloader.ts` are untouched.
- **The characterisation matrix is the evidence, not a claim.** `export-source.matrix.unit.test.ts` was written and run green against the *old* branching implementation before a line of production code changed, and passes unchanged against this one. It pins all eleven sources' column sets and filename shapes through the public exporter API only. It earned its place immediately: the first refactored run failed it, because `firstSource` skipped falsy values and turned every `0` in a Coretax row into `undefined`. Zero amounts are the norm in these grids.
- `CONTEXT.md` gains **Export source spec**.

Status: accepted. Recorded and implemented 2026-10-02.
