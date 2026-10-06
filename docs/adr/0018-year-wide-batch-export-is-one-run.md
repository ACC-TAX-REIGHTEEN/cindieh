# 18. A year-wide export is ONE Run over every tax period

Date: 2026-10-06

## Status

Accepted

## Context

A Wajib Pajak preparing a yearly filing must open the Coretax PPN Keluaran grid
twelve times, once per tax period, and export each separately. The portal does
not offer a year view. The obvious extension is one click that fetches all twelve
months into one file.

Two things had to be settled before that could be built, and neither could be
settled from the code:

1. **Is the period filter scriptable, or does it require driving the portal's
   own UI?** Measured on the live portal: `TaxInvoicePeriod` travels in
   `body.Filters` with `MatchMode: "equals"` and a value of the form `TD.007MM`
   — a fixed three-digit prefix plus a two-digit month. `TaxInvoiceYear` is a
   separate filter. So the sweep is ordinary request building, not UI automation.

2. **What happens to a row that belongs to two periods?** ADR-0016 established
   that a row's identity is `RecordId` or `AggregateIdentifier`, but its dedupe
   set is per-Run. Measured: 44,237 rows across three adjacent periods produced
   **zero** duplicates, and every row carried a `RecordId`. That is the case
   *not* to over-engineer for — and it is exactly the case that would silently
   double-count an invoice if the batch were implemented as twelve Runs.

A third measurement shaped the design rather than gating it. Coretax's
`Payload.TotalRecords` is not a row count on this endpoint: it answers every page
size with `Rows + 1` (measured across 10, 100, 500, 1000, 2000, 5000 — see
`readGridTotal`). So there is **no trustworthy server-side total** to check a
sweep against, at one period or at twelve.

## Decision

A year-wide export is **one Run that sweeps every period in order**, into one
accumulator.

- `scrapePaginated` takes the accumulated rows and the dedupe set as a parameter
  rather than creating them, so consecutive periods share both. One invoice
  present in two periods is therefore collected once, which is the outcome the
  zero-duplicate measurement promised only because the periods share a set.
- Period codes are derived **from the captured request**, never synthesised. The
  request crosses from the isolated world, and the period codes live with it, so
  the content script asks for a *number of months* and the MAIN world derives
  the codes from what the portal itself sent. A request whose body carries no
  `TaxInvoicePeriod` filter **fails loudly** instead of sweeping one period
  twelve times and reporting a year's worth of a month's rows.
- The completion carries a per-period summary, and the panel reports it. Because
  the server's count is unusable, the per-period row counts *are* the
  completeness evidence: a period that returns nothing while its neighbours
  returned something is the one detectable anomaly, and it is stated rather than
  shipped as a quiet short year. The server's per-period count is deliberately
  dropped rather than compared against the concatenated total.
- The file is named for the **year**, not for the month the grid happened to be
  filtered to.
- The between-period pause is an ordinary paced delay, so it may only ever make
  the run slower.

Scope is PPN Keluaran only: it is the one grid whose period filter was measured,
and whose twelve months form a single meaningful export. The other ten export
sources have different endpoints and were not measured at all.

## Consequences

- One click, one Run, one file, one completion, one dedupe set. A twelve-file
  export is not the feature.
- Completeness rests on per-period counts, not on a server total, because no
  server total exists here. This is a weaker guarantee than a count would be,
  and the panel says so rather than claiming a clean success.
- The measured zero-duplicate result covers January–March only. The
  **December→January year boundary is untested**, and that adjacency is the
  plausible one for a year-end adjustment. The shared dedupe set is what makes it
  safe if it happens; it is not proof that it cannot.
- A period that cannot even be requested is recorded as *failed* and the sweep
  continues, so eleven months beat none — but eleven months reported as twelve
  would not, which is why the summary keeps the two apart.
- The clamp hazard measured in `readGridTotal` (the portal honouring a smaller
  `Rows` than asked, so page one looks like the end of the data) is **not** yet
  detected inside a period. It remains a standing gap for this feature.