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
  schema, not just the markup: `getColClass` and `getCheckerColClass` decide
  each column's CSS class, and the comparer header list is a nine-way rotation
  that must stay in lockstep with two separate cell arrays and a `numCols`
  index list. That is derived layout logic living inside a view.

## Consequence, and the direction

The consequence is measurable. `pnpm test:coverage` puts `ui-comparer.ts` at
**41.15% branch** coverage, against a global average of 74.78% and a 72%
ratchet floor. Among the modules the existing suites reach it is the worst by a
wide margin: `ui.ts` (58.94%) and `popup.ts` (61.11%) are next. Only
`shortcuts.ts` sits lower, and that is because nothing imports it at all rather
than because it is broadly under-tested. The untested code in this file is
concentrated in exactly the renderers this ADR misdescribed.

So the amendment is descriptive first: a future reader should know where the
risk is. The open work it points at is to lift the column-schema derivation out
of the renderers into pure exported helpers with their own tests, which is the
same move that fixed this file's session state in the first place. That work is
not required before this ADR's rule is obeyed — but it is what would make the
original "thin view" description true again.

Status: accepted. Amended to match the two-tab panel.