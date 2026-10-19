# The comparison's file columns are declared with its grid columns

The checker's sheet was already derived from its column schema: `CheckerColumn` pairs the
table's column with the file's, and the file-only NPWP/NIK column is declared beside them
(`screen: null`). The comparer was the exception. Its grid was a list of `ResultColumn`, and
its sheet was a second hand-written header array inside `comparer-export.ts` — thirteen
labels and thirteen cells, plus the arithmetic that told the XLSX writer where the five
amount columns had landed (`refLainEnabled ? 7 : 6`).

The comparer now follows the same shape:

```ts
interface ComparerColumn {
  screen: ResultColumn<ComparisonResult> | null;   // the grid
  sheet: SheetColumn<ComparisonResult>;            // the file
}
```

`comparerSchema(refLainEnabled)` is the one definition; `comparisonColumns` and
`comparerSheetColumns` are its two readings. The three columns only the file carries —
Tanggal, NIK/NPWP, Nomor Faktur Pajak — are declared in that list as `screen: null`, in the
position they occupy in the file (after Nama Pembeli), and Referensi Lain is inserted after
Referensi in both halves by the same rule.

A sheet column also declares what kind of number it holds (`format: "amount" |
"difference"`). `exporter.resultNumberFormats(columns)` turns that into the workbook's
number formats, keyed by the column's actual index. Both tabs use it, so the hand-counted
`firstAmount` (and the checker's `{5…9}` literal) are gone: inserting a column ahead of the
amounts no longer shifts every format one place left, silently formatting a status code as
currency and leaving the last amount unformatted.

Rationale:

1. **A file column is a column, not a second table.** The header array in
   `comparer-export.ts` was correct the day it was written and free to drift every day
   after: a new grid column had to be remembered there, in the right position, with the
   right cell — and the CSV/XLSX paths could disagree with the screen without any test
   failing, because nothing compared them.
2. **Position is the schema's job.** The number formats used to encode where the amounts
   sit. That is a fact about the column list, so it is read from the column list.
3. **The two grids can still differ, and say so.** The comparer's sheet is wider and its
   status cell is the raw code where the table shows a label; the checker's file carries the
   counterparty TIN and signs its differences. Both are differences between two cells of one
   column, or between a column and its absence — both expressible in the pair, neither
   needing a schema of its own.
4. **The pair is the compile-time guard.** `sheet` is required, `screen` is optional, so a
   column cannot reach the table and be forgotten in the file — the same asymmetry that has
   kept the checker honest since its schema was introduced.

Consequences: `comparer-export.ts` contributes no column of its own for either grid — both
builders write the header and rows from the schema through one `sheetRows` helper. The
comparer's export asks the schema for its number formats, which is why `ui-comparer.ts` no
longer knows how many columns precede the amounts. Tests pin the file's order with and
without Referensi Lain, that the grid's labels are the file's with the three file-only
columns removed, that the file writes raw amounts and raw status where the grid formats
them, and that the format map lands on the amount columns (7–11 with Referensi Lain, 6–10
without; 5–7 plus the signed 8–9 for the checker).

Status: accepted.
