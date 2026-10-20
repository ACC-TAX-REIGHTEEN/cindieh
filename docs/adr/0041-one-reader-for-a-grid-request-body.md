# A Grid request's body is read by one module

Every grid request the portal sends carries its filters in one array:

```
{ Filters: [ { PropertyName, Value, MatchMode, CaseSensitive, AsString } ], First, Rows, ... }
```

Four modules read that shape and two write it, each with its own tolerance for
the spelling:

| Reader | How it read the body | How it found the period |
|---|---|---|
| `scrape-batch.ts` | `body["Filters"]`, `PropertyName` only | the **measured** name (`TaxInvoicePeriod`) |
| `page-context.ts` | `body.Filters \|\| body.filters`, `PropertyName \|\| propertyName` | a **hint** — the first name containing "period" or "masa" |
| `scraper-xhr-patches.ts` | `"Filters" in parsed ? "Filters" : "filters"` | — (writes) |
| `scraper-xhr.ts` | the same probe, written again | — (writes) |

The two writers built the same filter entry in two places:
`{ PropertyName, Value, MatchMode, CaseSensitive: false, AsString: false }`.

The two READERS disagreed about the answer that matters, and the disagreement
had a consequence. The sweep's SCOPE finds the tax period by its measured name;
the FILE's NAME found it by a hint — the first filter whose lowercased name
**contains** "period" or "masa". A body carrying `TaxInvoicePeriodStatus`
before `TaxInvoicePeriod` therefore named the file after the status while the
rows came from the period. That is the name-hint door ADR-0019 closed for the
scope, still open for the name.

The casing difference was not academic either: a body spelling itself
`filters`/`propertyName` was invisible to `scrape-batch.ts` (the sweep refused
it as "no period filter") and visible to `page-context.ts` (the filename hint
read it fine) — the same body, two different answers.

Decision:

1. **`grid-request.ts` owns the body's shape.** One tolerant reader for the
   filter list (`Filters` or `filters`), one tolerant reader for an entry
   (`PropertyName` or `propertyName`, `Value` or `value`), and one canonical
   filter-entry builder for both writers.
2. **A body is answered under the key it was read from.** `filtersKeyOf` is the
   one place that decides, because the two writers disagreed: one fell back to
   `filters` for a body with no `Filters` key, the other to `Filters` for a body
   that would not parse. A filter written under the key the portal did not send
   is a filter the portal never receives — which for a period means the same
   month requested twelve times.
3. **A filter is found by its WHOLE name.** `findFilter` matches a full name, in
   any case, and `filterValueOf` takes the first of a declared list the body
   carries. The list (`GRID_FILTER_NAMES`) is the priority, so a grid carrying
   both a specific name and a general one takes the specific one.
4. **The names are a table of whole names, and the measured one is checked
   against it.** `MEASURED_SWEEP_FILTERS` stays where the measurement discipline
   keeps it, and a test asserts that a measured period and year name are among
   the names the file is read from — so the scope's answer and the file's answer
   cannot drift apart about the same body.

The rule that carries the weight is the third one, because it decides which way
a wrong name fails. A name the table does not know fails **safe**: the hint
finds nothing and the file takes its period from the rows it holds, which is
the better answer anyway. A name that merely *resembles* a known one fails
**unsafe** — it names the file after a filter the rows never came from. So the
table is whole names, and the substring match is gone.

The measurement table itself is untouched: only PPN Keluaran has a row, the
other three e-Faktur grids still refuse the year-wide export, and a grid with
no row is given no guess. The other grids' names are in `GRID_FILTER_NAMES` for
the FILE's name only — a grid with no measured row has no scope either, so
there is nothing for a name to disagree with.

Consequences:

- The four readers and the two writers are one module, and the shape is
  described once. A rename of a filter entry's field is one edit.
- The file's name can no longer come from a filter the rows did not come from.
- A body spelling its filters `filters` is read the same way by every reader,
  and the sweep's override is written back under the key the body used.
- `grid-request.ts` is 100% covered, and the rules it holds — the exact-name
  lookup, the key the body is answered under, the tolerance for the spellings —
  are unit tested rather than pinned through four callers.

Status: accepted.
