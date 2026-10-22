# A period filter may carry a LIST of codes

ADR-0019 decided that a grid may only sweep once its filter NAMES have been
measured off the portal, and the measured table holds those two names. The
table did not say what a filter's VALUE may look like, because on the one
measured grid it did not have to: PPN Keluaran sends `TaxInvoicePeriod` as one
string (`"TD.00708"`, MatchMode `equals`).

PPN Masukan sends the same filter name with a different value. Measured on the
live portal on 2026-10-21, its grid request carries:

```json
{ "PropertyName": "TaxInvoicePeriod", "Value": ["TD.00709"],
  "MatchMode": "contains", "CaseSensitive": true, "AsString": false }
```

The value is a **LIST of codes**, and the MatchMode is `contains` rather than
`equals`. The list holds one element when one month is selected and several
when the Wajib Pajak selected several in the portal's own filter. The year
filter is the same on both grids (`TaxInvoiceYear`, `"2026"`, `equals`).

Retur PPN Masukan and Retur PPN Keluaran, measured the same day, send the same
shape — the same filter name, the same list of codes, the same `contains`
MatchMode — so what is learned here covers three of the four grids rather than
one.

Two things followed from that, and the first was not a matter of taste.

**The reader saw no period at all.** `capturedPeriod` accepted a string value
and returned null for anything else, so on PPN Masukan it answered null. The
plan is built from that answer, so the plan was EMPTY — and an empty plan
takes the branch that scrapes the grid exactly as it stands, with no period
override. The "Ekspor 1 Tahun" button would then have produced a file named
for the year (`FPM-2026.xlsx`) holding whatever months the portal's filter
happened to be on: two months, 369 rows, no error, no warning. That is the one
outcome ADR-0019 exists to prevent, and it would have arrived through a
feature that looked like it worked.

**The prefix could be derived from a value that was never one code.** The
guard asked `periodPrefix(String(value))` — and `String(["TD.00709","TD.00710"])`
is `"TD.00709,TD.00710"`, which the prefix pattern matched greedily, yielding
the prefix `"TD.00709,TD.007"`. The twelve codes that follow from it
(`TD.00709,TD.00701` … `TD.00709,TD.00712`) are months the portal has never
heard of, and every one of them comes back empty. The diagnostic script hit
exactly this: its first session, with two months selected, derived those codes
and measured **zero rows for all three months**.

The measurement also settled what the portal READS, which is not the mirror of
what it sends. Rewriting the period filter with **one code as a plain string**,
keeping the filter's own MatchMode, was honoured: three consecutive months
came back with 334, 274 and 142 rows, and every row's own period field equalled
the code that was asked for. So the list is what the portal SENDS and the
string is what it READS — an asymmetry, measured rather than assumed. (`Rows`
is honoured on this endpoint too, and one month held 235 rows — under the 500
the sweep asks for, so a short page ends the month and no data is cut.)

Decision:

1. **The period filter is read as a list of codes.** The plan is built from the
   FIRST code, and the sweep writes back ONE code as a plain string, with the
   filter's own MatchMode and CaseSensitive untouched. The read side and the
   write side deliberately disagree, because the portal's do.
2. **A capture may carry several codes.** The Wajib Pajak can select several
   months in the portal's own filter, and the capture then holds all of them.
   The first is enough: the codes of one grid share a prefix, and the sweep
   replaces the whole filter with one code at a time anyway. A list that carries
   no code at all is refused — a filter the sweep cannot read.
3. **`periodPrefix` accepts exactly ONE code.** A value carrying a separator
   yields no prefix, so the guard refuses instead of sweeping twelve empty
   months. Fail SAFE, the same way an unknown filter name does.
4. **The value shape is a property of the GRID, learned by measurement.** The
   measured table still holds the two NAMES; this ADR holds the shape, and a
   grid whose shape is not known here is a grid with no measured row at all.

Consequences:

- All four e-Faktur PPN grids sweep. PPN Masukan, Retur PPN Masukan and Retur
  PPN Keluaran send the period filter as a LIST of codes; PPN Keluaran sends one
  string — and the list reader reads that string as a one-element list, so the
  string shape is the special case the list reader EXTENDS, not a grid that is
  left out (ADR-0019).
- The guard's refusal for an unreadable period value now also covers a list
  that carries no code, which is the same failure a moved spelling produces.
- The sweep's log line names the ONE code the plan uses, not the list: the list
  is an artifact of what the Wajib Pajak had selected, not of the year.
- The FILE's name is unaffected — the year comes from the separate year
  filter, and a year-wide file is named for the year. A wrinkle that is NOT
  fixed here: an ordinary export of a grid filtered to two months has no month
  in its name, because the month hint is read from that same list.

The measurement discipline is untouched: this ADR records a value SHAPE that
was read off the portal on 2026-10-21, and invents no filter and no code. The
capture it rests on is `grid-requests.ts`'s PPN Masukan entry, and the test
that holds the capture, the table and the guard together is
`grid-requests.unit.test.ts`.

Status: accepted.
