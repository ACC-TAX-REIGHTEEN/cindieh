# A scraped row has one name, and it is the name its file carries

A scraped row is named **twice**: once in the panel's progress line and failure
list, and once in the file the download lands as. The two have to be the same
row — the download ORDER is the only thing that ties a failure back to a row
once the run is over, so a run that reports "4 gagal" has to be able to say
*which* four.

They were two different ladders:

| | the panel's ladder | the file's ladder |
|---|---|---|
| e-faktur | `Reference → TaxInvoiceNumber → LetterNumber → ReturnNumber` | `Reference` beside `LetterNumber` / `TaxInvoiceNumber` |
| a retur | the e-faktur one | `ReturnNumber → Reference → DocumentNumber` beside `TaxInvoiceNumber → LetterNumber → ReturnInvoiceNumber` |
| Bukti Potong | `WithholdingSlipNumber → WithholdingSlipsNumber → DocumentNumber` | `WithholdingSlipsNumber` only |
| anything else | — | the union of all of them |

Three rows could therefore be named two ways at once:

- a **retur** carrying both a Referensi and a return number was reported as the
  Referensi and filed as the return number;
- a **Bukti Potong** carrying only the *singular* slip number was reported as
  "BP-001" and filed as "TANPA_NOMOR";
- an **e-faktur** row carrying a TaxInvoiceNumber and a LetterNumber was
  reported as the TaxInvoiceNumber and filed as the LetterNumber.

The Bukti Potong case was the sharpest, because the two spellings are not two
versions of one field: the bulk-PDF flow carries `WithholdingSlipNumber` and
the grid capture carries `WithholdingSlipsNumber`, and a slip can arrive with
either. `export-source.ts` declared both spellings for its exported column, and
the comment said which flow produced which — a claim that had gone stale, since
`scraper-xhr.ts` never read the slip number at all.

Decision:

1. **`row-name.ts` owns the ladder.** It declares, per export source, the
   fields that NAME a row and the fields that carry the INVOICE number it
   belongs to — two lists, because a row has two names in a file and they are
   different facts (on PPN Keluaran the invoice is the LetterNumber, on PPN
   Masukan it is the TaxInvoiceNumber, and a credit note names the invoice it
   credits). A `Record`, so a grid added to the export sources without a row
   does not compile.
2. **The panel's label is the first of `name` then `invoice` the row carries.**
   The file's two slots are drawn from the same two lists, so the label is
   always a token the file also carries. That is the whole invariant, and it
   is what the two lists were chosen to make true.
3. **The two Bukti Potong spellings are ONE list.** `row-name.ts` declares it,
   and `export-source.ts`'s exported column reads it, so the column and the
   file's name cannot disagree about which spelling a slip carries. The stale
   provenance comment goes with it.
4. **The file keeps its own shape.** `downloader.ts` still owns the per-source
   filename — `Reference - LetterNumber.pdf`, `MM-YYYY-Nomor-Nama.pdf`, the
   generic `SOURCE-name.pdf` — and the placeholders a filename needs when a
   part is missing (`TANPA_REFERENSI`, `TANPA_NOMOR`, `000`). Those are file
   conventions, not row facts; what goes IN them is now one ladder.

Consequences:

- A retur row is reported by its return number, the way it is filed.
- A Bukti Potong slip is filed by its slip number in EITHER spelling, so a
  singular slip is no longer reported as "BP-001" and filed as "TANPA_NOMOR".
- An e-faktur row is reported by the invoice number its grid files it under.
- The panel and the downloads folder cannot disagree about which row failed,
  and a test reads BOTH ladders and asserts the label appears in the file
  name.

The measurement discipline is untouched: the ladder says which fields can name
a row, not whether the endpoint honours them, and it invents no field — every
name in it is one the portal's own rows carry.

Status: accepted.
