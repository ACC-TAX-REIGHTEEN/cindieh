# Comparer session state lives in comparer-logic; ui-comparer is the panel's view

`comparer-logic.ts` owns the `ComparerSession` object (created via
`createComparerSession()`) and the comparison orchestration — `runComparison`,
`rerunComparison`, and `prepareComparison` (the "Periksa" decision tree).
`ui-comparer.ts` holds no module-level session `let`s: it takes
`createComparerSession()`'s result directly.

The session factory existed but was dead code (its consumer ignored it and kept
8 module-level `let`s). Do not move comparison flow logic back into the view;
the decision tree (daily-date validation ordering, re-run-when-results-exist,
scrape-first) is pinned by tests in comparer-logic.

## What the view legitimately owns

The view is a presentation layer, not a thin one. It may derive presentation
from session state — column schema, CSS classes, which panel regions are
visible, how many results a page holds — without that being a violation of the
decision above. Only *flow* — what to run, in what order, under which
preconditions — belongs in `comparer-logic`.

## Amendment 2026-10-02: the "thin view" description no longer holds

An earlier version of this ADR described `ui-comparer.ts` as a thin view that
"only builds DOM, wires events, and renders session state". That was accurate
when written (2026-08-13), when the file stood at 783 lines and hosted one tab.
It is no longer:

| Region | Lines |
|---|---|
| `injectComparerModal` — DOM for **both** tabs | 573 |
| `renderCheckerResults` — checker table renderer | 199 |
| `renderResults` — comparer table renderer | 174 |
| **total** | **1.283** |

The drift has one cause: `9247efb` added the Pengecekan Keakuratan Nilai tab,
which brought `checker-logic.ts` as its pure half and roughly doubled the view
into a two-tab panel. At 1.283 lines the file is the largest module in the
project and 12.4% of all source code. The decision above was not violated — the
session split still holds — but the description was, so anyone reading it now
gets a materially wrong picture of the module.

Two further corrections:

- **The panel hosts two tabs, and `checker-logic.ts` has no ADR.** It is the
  same session/flow/pure split `comparer-logic.ts` was written for, applied
  again; the rule applies to it verbatim.
- **"Renders session state" undersells the renderers.** They derive the column
  schema, not just the markup: `getColClass` and `getCheckerColClass` decided
  each column's CSS class, and the comparer header list was a nine-way rotation
  that had to stay in lockstep with two separate cell arrays and a `numCols`
  index list. That was derived layout logic living inside a view.

## Resolution: the column schema moved out (2026-10-02)

The open work above is done. `result-columns.ts` now declares both grids as
lists of `ResultColumn<T>` — label, CSS class, numeric flag, and the cell
value — and the renderers only consume them. The four index-coupled artifacts
per grid collapsed into one declarative list, the duplicated pagination block
became a single `appendPagination`, and the class-by-header-name sniffing
(`headerName.includes("NL")`) is now an explicit `wide` flag.

`ui-comparer.ts` is 1.121 lines, down from 1.283. Its own branch percentage went
**down** (41.15% to 34.15%), which is the point worth stating plainly: the
partially-covered ternary branches left the file, so the uncovered remainder —
`injectComparerModal`'s 573 lines of DOM building and the event wiring — is now
what that percentage is made of. The schema those branches computed is now at
100% on all four metrics, and the global average rose from 82.53/74.78/77.88/
84.17 to 83.23/75.34/78.72/84.97, which is why the ratchet floors moved up.

Two behaviours were preserved deliberately rather than tidied away:

- The comparer's Status cell shows `getStatusLabel(...)` while the checker's
  shows the raw status. Both are pinned by tests.
- The checker labels its difference columns from the SESSION's benchmark but
  resolves each cell's difference from the ROW's benchmark. Every row in a run
  comes from one `checkAllRowsAccuracy` call so they agree; the asymmetry is
  kept so the table survives that ceasing to be true.

Behaviour was proven unchanged rather than argued: the rendered matrix (labels,
`th` class, `td` class, cell text) was captured for all five grid variants
before and after, and the two captures are byte-identical.

What remains untested in the view is `injectComparerModal` — real DOM
construction, not derivation — and it is the next target.

Status: accepted. Amended to match the two-tab panel; the column-schema
resolution is recorded above.