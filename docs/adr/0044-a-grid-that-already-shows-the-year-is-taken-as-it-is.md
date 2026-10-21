# A grid that already shows the year is taken as it is

The year-wide export asks a grid for one tax period at a time, and rewrites the
portal's own period filter to do it. That needs the request to CARRY that
filter — and on some grids it does not, because **the portal only sends it when
a month is actually selected**.

A grid with little data shows a whole year by default: the Wajib Pajak has
fewer rows than the portal's own default period would cover, so the filter is
left empty and the request carries only `TaxInvoiceYear`. Measured on all four
e-Faktur PPN grids: the three with plenty of data always send the period
filter; the one with little data sends it only when a month is chosen.

The year-wide export refused that case — "the request has no period filter" —
which was the safe answer and a useless one: **the grid was already showing
the year**. The portal had done the work, and the refusal threw away a finished
answer, telling the user to pick a month only so the extension could ask the
portal for the year one month at a time.

Decision:

1. **The scope of a batch request has THREE answers**, not two: `sweep`, `year`,
   or `refused`. `scrape-batch.ts`'s `batchScope` owns all three, so the one
   place that knows the measured table also knows what the request allows.
2. **`year`: the request carries no period filter and a readable year.** The
   portal is not filtering by month, so the grid is showing what it offers for
   that year — and what it shows IS the year. It is taken as it is, in ONE
   ordinary export, and the file is named for the YEAR.
3. **Nothing is asked of the endpoint that has not been measured.** No filter is
   injected, no period code is invented, no MatchMode is guessed: the twelve
   codes the sweep would derive are simply not needed, and the portal's own
   view is the evidence (ADR-0043's discipline, applied to the scope).
4. **`refused` is kept for what is genuinely not a year:** a grid with no
   measured row (ADR-0019), a period filter whose value the sweep cannot read,
   or no year to name the file by. A file called for one month that holds a year
   is worse than no name at all.

The sweep itself is unchanged. A grid that IS filtered by month is still asked
for one month at a time, and the per-masa counts that come back are still the
completeness evidence.

Consequences:

- On a grid showing a whole year, "Ekspor 1 Tahun (12 Masa)" produces the
  year's rows in one export named for the year (`FPM-2026.xlsx`) — the same
  file the sweep would have produced, without the twelve requests.
- The panel's report for that run is an ordinary export's report: a row count,
  not a per-masa list. The per-masa counts belong to the sweep; a year view has
  one page set, and the months the rows actually carry are what a recap would
  show (the per-masa recap).
- A stopped year view keeps nothing, like any ordinary export: there are no
  per-masa counts to resume from. The sweep's salvage (ADR-0020) belongs to the
  sweep.
- **The residual risk, stated plainly:** the check reads the REQUEST's filters.
  A grid restricted by some other filter the extension does not recognise would
  be taken as the year. The measured evidence says the portal expresses its
  month restriction in the period filter — on all four grids — and the sweep's
  log line names every filter the request carried, so an unknown filter would
  show up there. The rows' own months are the proof, and the recap is what will
  show them.
- A grid with no measured row is refused either way: the table is what says
  where a grid keeps its period, and nothing in this request can change that.

The measurement discipline is untouched: this ADR changes what happens to a
request that carries no period filter, and nothing about how a period filter is
read, written, or measured.

Status: accepted.
