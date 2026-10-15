# 19. The year-wide export covers every e-Faktur VAT grid

Date: 2026-10-15

## Status

Accepted

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
much: PPN Masukan and both Retur grids are also filed per masa, and each of them
costs twelve exports a year on a grid whose twelve months are one meaningful
file. The audit of 2026-10-13 recorded the asymmetry as a finding, and named the
one thing that has to be measured before it can be closed: what the other grids'
requests call their period and year filters, and how they spell the period value.

## Decision

The sweep is offered on the four e-Faktur PPN grids — PPN Keluaran, PPN Masukan,
Retur PPN Keluaran, Retur PPN Masukan — and withheld everywhere else (the SPT
and Bukti Potong pages keep their ordinary export menu).

Everything ADR-0018 decided still stands: one Run over every period, codes
derived from the captured request, a per-period summary as the completeness
evidence, a filename named for the year, a shared dedupe set. What changes is
how the two filters are found on a grid that was never measured:

- The measured names win outright (`TaxInvoicePeriod`, `TaxInvoiceYear`).
- Otherwise a filter is accepted only on **two signals together**: a name that
  says period/masa (or year/tahun) and a value in the measured format. The
  format half is not decoration — `TaxInvoiceNumber`'s value
  (`010.000-26.00000012`) also ends in a month-looking pair, so a value-only
  match would sweep twelve invoice numbers and call it a year.
- A credit-named filter (`PeriodCredit`, `YearCredit`) is never taken for
  either, because PPN Masukan's request may carry the credit period alongside
  the document period and sweeping by it would return twelve coherent months of
  the **wrong** period.
- The year may also arrive as a body field (`TaxYear`/`Year`/`Tahun`) — the same
  three spellings the retur grids' filename hint already reads from the same
  requests. The field is carried through every sweep request untouched, so the
  year stays pinned either way.
- A period filter whose value is in no known format stops the sweep with a
  message that says the filter was not recognised — never a sweep of one month
  twelve times, and never a file named for a month it does not hold.

The scope guard lives in `batchScopeError`, next to the readers it protects, so
it is pure and unit-tested rather than discovered on a portal.

## Consequences

- The unmeasured grids work when their filters sit inside the measured family.
  If one does not, the feature is **unavailable and says so** — and that refusal
  is itself the measurement: a report of it names the grid whose format
  `periodPrefix` must learn next, which is a bounded change with tests around it.
- A false accept is possible in principle: a period-named filter whose value
  matches the family but which the endpoint ignores. Its failure is visible
  rather than silent. The first period would then return the whole result and
  the other eleven nothing, so the per-period summary flags eleven "masa tanpa
  baris" and the completion notice drops its clean-success wording; the shared
  dedupe set means the file still holds no duplicated rows (ADR-0016/0018).
- The manual portal loop must now include a batch run on each newly gated grid.
  Until that is recorded, "works on PPN Masukan and Retur" rests on the guard,
  not on a measurement — the same position ADR-0018 was in before its own
  measurement, except the refusal path was built first this time.
- The menu item's presence and the sweep's own scope guard are deliberately two
  doors. The item is offered wherever the pages could support a sweep; whether
  THIS captured request can be swept is answered later, from the request itself.
