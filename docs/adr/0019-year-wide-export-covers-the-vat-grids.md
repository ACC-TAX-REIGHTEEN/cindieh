# 19. The year-wide export runs only on grids whose sweep filters were measured

Date: 2026-10-15

## Status

Accepted. Amended 2026-10-17: the name-hint door is gone.
Amended 2026-10-21: PPN Masukan's row is recorded. Its filter NAMES are the
same, but its period filter carries a LIST of codes — that value shape is
ADR-0043's subject, and this ADR's table is where the row lives.
Amended 2026-10-21 (2): phase 2 runs per grid too. The shape of the portal's
echoed row count is a property of the ENDPOINT, not of the grid family, and
the two measured so far differ — so a grid cannot be measured with phase 1
alone.

## Context

ADR-0018 built the year-wide sweep and scoped it to PPN Keluaran, because that
was the one grid whose period filter had been measured: `TaxInvoicePeriod` in
`body.Filters`, `MatchMode: "equals"`, values of the form `TD.007MM`, with
`TaxInvoiceYear` as a separate filter.

The mechanism itself is grid-agnostic. The twelve period codes are derived from
the request the portal just made, and `overridesForPeriod` replaces one filter's
`Value` while carrying every other filter through untouched — so neither the
prefix nor the endpoint is baked into the sweep.

That scope left the other three VAT grids out of a feature they need just as
much: PPN Masukan and both Retur grids are also filed per masa. The first
version of this ADR closed the gap with a **name-hint door**: on any grid with no
measured names, a filter was accepted if its name said period/masa (or
year/tahun) and its value was in the measured format, with the year also allowed
to arrive as a `TaxYear`/`Year`/`Tahun` body field.

That door was a guess wearing two signals. A period-named filter with a
`TD.007MM` value is evidence that a filter *looks* like the one PPN Keluaran
sends; it is not evidence that this endpoint reads it, that `TaxInvoiceYear` is
what pins the year, or that a Retur request's period means the same month. A
wrong accept there yields twelve requests for months the portal was never asked
for — a file the user cannot check against anything. The refusal path was built
first precisely because that outcome was possible; this amendment removes it.

## Decision

**A grid may only sweep if it has a row in `MEASURED_SWEEP_FILTERS`
(`scrape-batch.ts`).** A row names the two portal filters:

```ts
export const MEASURED_SWEEP_FILTERS: Partial<Record<ExportSource, SweepFilterMeasurement>> = {
  OUTPUT_TAX: { period: "TaxInvoicePeriod", year: "TaxInvoiceYear" },
  INPUT_TAX: { period: "TaxInvoicePeriod", year: "TaxInvoiceYear" },
  INPUT_RETURN: { period: "TaxInvoicePeriod", year: "TaxInvoiceYear" },
};
```

The three rows name the same two filters, but the grids do not send them the same
way: PPN Masukan and Retur PPN Masukan carry the period as a LIST of codes and
a `contains` MatchMode, where PPN Keluaran carries one string and `equals`
(ADR-0043). The names are what this table holds; the value shape is what
ADR-0043 holds.

- The readers take the grid's `ExportSource` and look up its row. No row means
  no period filter, no year, and no re-request — `overridesForPeriod` throws and
  `batchScopeError` returns a refusal that names the grid as unmeasured, not the
  request as malformed.
- Nothing else is accepted on a grid's behalf: not a similar-sounding name, not
  a value in the measured shape, not a year carried as a body field. Those
  allowances only ever existed for grids without a row.
- On a grid **with** a row, the measured names are matched exactly. A request
  that lacks the period filter, or whose period value is outside `periodPrefix`'s
  family, still stops the sweep with its own message — a stale row is a bug to
  fix, not a reason to widen the match.
- The menu item is still built on the four e-Faktur PPN grids (`isEfakturPage`),
  so the gate and the guard stay two doors: where the entry is offered is a page
  fact, whether this request may be swept is answered from the request and the
  table. On the two grids with no row, the entry refuses and says why; adding
  the row turns it on with no other change.

### Why a table and not a smarter heuristic

Every heuristic added names that a value *resembles* a period. The measurement
cannot be inferred from a captured request, because the question it answers —
does this endpoint honour this filter for this year? — is only answered by
asking the endpoint. A table keeps that answer where a reviewer can see it, dates
it to the measurement, and makes an unmeasured grid a deliberate refusal rather
than an untested assumption.

## Consequences

- **The feature currently runs on PPN Keluaran, PPN Masukan and Retur PPN
  Masukan.** One grid refuses, and it refuses for a reason that measuring will
  not change: Retur PPN Keluaran's request carries NO period filter at all
  (measured 2026-10-21), so it cannot be swept through the server-side filter
  path this feature uses. That is a loss of coverage in exchange for never
  shipping a guessed year; the refusal names the grid and offers the ordinary
  export as the alternative.
- **A refusal is still the measurement.** `readSweepFilters` reports the grid's
  measured row (or its absence) and every filter the request carries;
  `describeSweepFilters` words it; `scraper-actions` logs the line before the
  guard can refuse (`Sweep filters on <source>: …`, `?chdebug=1`). A refused run
  therefore hands over the spellings a new row needs. `readSweepFilters` is the
  fact and `describeSweepFilters` the wording, so the log can change without
  touching a decision.
- **Adding a grid is a code change with a measurement behind it**, not a runtime
  inference: one row in the table, one row in `tools/README.md`, one in this ADR,
  and a test that the new grid is accepted while the ones still unmeasured are
  not.
- The completed-coverage evidence is unchanged from ADR-0018: a per-period
  summary, a filename named for the year, a shared dedupe set (ADR-0016), and the
  completion notice that drops its clean-success wording for a failed or empty
  masa.

## Measurement

The instrument is `tools/masa-batch-diagnostic.js`, and the place to write the
answer is the per-grid table in `tools/README.md`.

1. On the target grid, pick one masa in the portal's filter, search, and let the
   table render.
2. Paste `tools/masa-batch-diagnostic.js` into the Console and run
   `__cindiehMasaDiag.jalankan([1, 2])` (phase 1 and 1b, plus phase 2 — the
   shape of the endpoint's echoed count is per endpoint; or `verdictFilter()`
   when the template is already captured and the count shape is already
   known).
3. Phase 1b prints the grid's measured row (or that it has none), the period and
   year filters the request carries, every filter in the body, the guard's
   verdict, the twelve codes a sweep would request, and a row ready for the
   table. Phase 2 measures the OTHER shape the portal answers with — the row
   count it echoes — which is a property of the endpoint: PPN Keluaran answers
   `Rows + 1` and PPN Masukan answers `Rows` itself when a page comes back
   short (ADR-0043's measurement).
4. Record that row in `tools/README.md` and add the same two names to
   `MEASURED_SWEEP_FILTERS` here and in this ADR, with a test per grid.

The rows recorded so far: PPN Keluaran (2026-10-06), PPN Masukan and Retur PPN
Masukan (2026-10-21). The two later grids needed a value shape of their own —
their period filter is a LIST of codes — so that learning was written as
ADR-0043 rather than folded into this ADR.

One grid has been measured and REFUSED: Retur PPN Keluaran (2026-10-21) sends
no period filter at all — only `TaxInvoiceYear` — so it cannot be swept
through the server-side filter path, and no row is written for it. A refusal of
that kind is not a gap waiting to be filled; it is the answer, and the table
records it rather than a guess.

Until a row exists, the verdict on that grid is `DITOLAK — grid ini BELUM
TERUKUR`, which is exactly what a real sweep reports.
